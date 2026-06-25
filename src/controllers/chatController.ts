import { prisma } from '../db';
import { isUserOnline } from "../utils/socketHandler";

// ──────────────────────────────────────────────
// Helper: get or create a ChatRoom with privacy
// ──────────────────────────────────────────────
async function getOrCreateChatRoom(senderId: string, recipientId: string) {
  // 1. Block check
  const blocked = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: senderId, blockedId: recipientId },
        { blockerId: recipientId, blockedId: senderId },
      ],
    },
  });
  if (blocked) return { room: null, error: "Cannot message this user", status: 403 };

  // 2. Existing room (either direction)
  const existing = await prisma.chatRoom.findFirst({
    where: {
      OR: [
        { user1Id: senderId, user2Id: recipientId },
        { user1Id: recipientId, user2Id: senderId },
      ],
    },
  });
  if (existing) return { room: existing };

  // 3. Check recipient privacy settings
  const recipient = await prisma.user.findUnique({ 
    where: { id: recipientId }, 
    select: { isPrivate: true, messagePrivacy: true } 
  });
  if (!recipient) return { room: null, error: "Recipient not found", status: 404 };

  const senderFollowsRecipient = await prisma.follow.findFirst({
    where: { followerId: senderId, followingId: recipientId, status: "accepted" },
  });

  let canMessage = false;
  let isRequest = true;

  // Rule 1: If accounts are already chatting, they can always message. (Handled by "existing" check)

  // Rule 2: If recipient's account is private, sender MUST follow them.
  if (recipient.isPrivate) {
    if (senderFollowsRecipient) {
      canMessage = true;
      isRequest = false; // Direct message if following a private account
    } else {
      return { room: null, error: "You must follow this private account to message them.", status: 403 };
    }
  } 
  // Rule 3: If recipient's account is public
  else {
    if (recipient.messagePrivacy === 'EVERYONE') {
      canMessage = true;
      // It's a request if the sender doesn't follow the recipient
      isRequest = !senderFollowsRecipient;
    } else if (recipient.messagePrivacy === 'FOLLOWERS') {
      if (senderFollowsRecipient) {
        canMessage = true;
        isRequest = false; // Direct message if sender is a follower
      } else {
        return { room: null, error: "This user only accepts messages from followers.", status: 403 };
      }
    }
  }

  if (!canMessage) {
    // This case should ideally not be hit due to the logic above, but as a fallback.
    return { room: null, error: "You cannot message this user.", status: 403 };
  }

  // 4. Create the room
  const newRoom = await prisma.chatRoom.create({
    data: {
      user1Id: senderId,
      user2Id: recipientId,
      isAccepted: !isRequest, // isAccepted is true if it's NOT a request
    },
    include: {
      user1: { select: { id: true, username: true, displayName: true, profilePicture: true } },
      user2: { select: { id: true, username: true, displayName: true, profilePicture: true } },
    },
  });

  return { room: newRoom };
}

async function assertRoomAccess(senderId: string, recipientId: string): Promise<{ room: any; error?: string; status?: number }> {
  const result = await getOrCreateChatRoom(senderId, recipientId);
  return result;
}

// ──────────────────────────────────────────────
// Initiate a room (called before first message)
// ──────────────────────────────────────────────
export const initiateRoom = async (req: any, res: any) => {
  try {
    const senderId = req.user.id;
    const { recipientId } = req.body;
    if (!recipientId) return res.status(400).json({ error: "recipientId is required" });

    const { room, error, status } = await assertRoomAccess(senderId, recipientId);
    if (error) return res.status(status || 403).json({ error });

    res.json(room);
  } catch (e: any) {
    console.error("Initiate Room Error:", e);
    res.status(500).json({ error: e.message || "Failed to initiate room" });
  }
};

// ──────────────────────────────────────────────
// Send a message (auto-creates room if needed)
// ──────────────────────────────────────────────
export const sendMessage = async (req: any, res: any) => {
  try {
    const senderId = req.user.id;
    const { recipientId, text, type, mediaUrl, postId, storyId, replyToId, audioDuration, scheduledAt, isEncrypted, encryptedData } = req.body;

    if (!recipientId) return res.status(400).json({ error: "recipientId is required" });

    // Get or create room with privacy check
    const { room, error, status: errStatus } = await assertRoomAccess(senderId, recipientId);
    if (error) return res.status(errStatus || 403).json({ error });

    // Vanish mode: if either user has it on, mark message as vanish
    const fullRoom = await (prisma.chatRoom as any).findUnique({ where: { id: room.id }, select: { vanishMode: true } });
    const isVanish = (fullRoom?.vanishMode || []).length > 0;

    const message = await prisma.message.create({
      data: {
        roomId: room.id,
        senderId,
        text: text || null,
        type: type || "text",
        mediaUrl: mediaUrl || null,
        postId: postId || null,
        storyId: storyId || null,
        replyToId: replyToId || null,
        audioDuration: audioDuration ? Number(audioDuration) : null,
        isVanish,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        status: scheduledAt ? "SCHEDULED" : "SENT",
        isEncrypted: isEncrypted || false,
        encryptedData: encryptedData || null,
      } as any,
      include: {
        sender: { select: { id: true, username: true, displayName: true, profilePicture: true } },
        replyTo: { select: { id: true, text: true, type: true, sender: { select: { id: true, username: true, displayName: true } } } },
      } as any,
    });

    // Update room timestamp + restore deleted chat if sender had deleted it
    const freshRoom = await (prisma.chatRoom as any).findUnique({ where: { id: room.id }, select: { deletedFor: true } });
    const updateData: any = { updatedAt: new Date() };
    if (freshRoom?.deletedFor?.includes(senderId)) {
      updateData.deletedFor = freshRoom.deletedFor.filter((uid: string) => uid !== senderId);
    }
    await (prisma.chatRoom as any).update({ where: { id: room.id }, data: updateData });

    // Broadcast via Socket.IO if online
    try {
      const io = req.app.get("io");
      if (io) {
        const recipientId = room.user1Id === senderId ? room.user2Id : room.user1Id;
        if (isUserOnline(recipientId)) {
          io.to(`user:${recipientId}`).emit("new_message", message);
          await prisma.message.update({ where: { id: message.id }, data: { status: "DELIVERED" } });
          message.status = "DELIVERED";
          io.to(`user:${senderId}`).emit("message_delivered", { messageId: message.id });
        }
      }
    } catch (_) {}

    // Notification + push
    try {
      const isEncMsg = isEncrypted || false;
      const msgType = type === "post_share" ? "shared a post" : type === "reel_share" ? "shared a reel" : mediaUrl ? "sent an image" : isEncMsg ? "🔒 Encrypted message" : text ? `"${text.substring(0, 60)}${text.length > 60 ? "..." : ""}"` : "sent a message";
      await prisma.notification.create({
        data: { userId: recipientId, senderId, type: "message", text: msgType },
      });
      const { sendPushNotification } = await import("../utils/pushNotifications");
      const sender = await prisma.user.findUnique({ where: { id: senderId }, select: { username: true, displayName: true, profilePicture: true } });
      if (sender) {
        const richText = isEncMsg ? "🔒 Encrypted message" : text ? text.substring(0, 200) : mediaUrl ? "📸 Photo" : "sent a message";
        sendPushNotification(
          recipientId,
          sender.displayName || sender.username,
          richText,
          {
            type: "message",
            senderId,
            senderName: sender.displayName || sender.username,
            senderAvatar: sender.profilePicture,
            messageText: isEncMsg ? "" : text || "",
          }
        );
      }
    } catch (_) {}

    res.json(message);
  } catch (e: any) {
    console.error("Send Message Error:", e);
    res.status(500).json({ error: e.message || "Failed to send message" });
  }
};

// ──────────────────────────────────────────────
// List all my rooms (split by primary / requests)
// ──────────────────────────────────────────────
export const getRooms = async (req: any, res: any) => {
  try {
    const userId = req.user.id;

    const rooms = await (prisma.chatRoom as any).findMany({
      where: { OR: [{ user1Id: userId }, { user2Id: userId }], NOT: { deletedFor: { has: userId } } },
      include: {
        user1: { select: { id: true, username: true, displayName: true, profilePicture: true } },
        user2: { select: { id: true, username: true, displayName: true, profilePicture: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
        // Unread count: number of messages not sent by me with status != SEEN
      },
      orderBy: { updatedAt: "desc" },
    });

    const enriched = await Promise.all(
      rooms.map(async (room: any) => {
        const partner = room.user1Id === userId ? room.user2 : room.user1;
        const unreadCount = await prisma.message.count({
          where: { roomId: room.id, senderId: { not: userId }, status: { not: "SEEN" } },
        });
        // Check online status
        return {
          id: room.id,
          partner,
          isAccepted: room.isAccepted,
          isRequest: !room.isAccepted && room.user2Id === userId,
          lastMessage: room.messages[0] || null,
          unreadCount,
          createdAt: room.createdAt,
          updatedAt: room.updatedAt,
        };
      })
    );

    const primary = enriched.filter((r: any) => r.isAccepted || (r.isRequest === false));
    const requests = enriched.filter((r: any) => r.isRequest);

    res.json({ primary, requests });
  } catch (e: any) {
    console.error("Get Rooms Error:", e);
    res.status(500).json({ error: e.message || "Failed to get rooms" });
  }
};

// ──────────────────────────────────────────────
// Chat history for a specific room
// ──────────────────────────────────────────────
export const getChatHistory = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;

    const room = await (prisma.chatRoom as any).findUnique({ where: { id: roomId } });
    if (!room) return res.status(404).json({ error: "Room not found" });
    if (room.user1Id !== userId && room.user2Id !== userId) {
      return res.status(403).json({ error: "Not a participant" });
    }

    // If user deleted this chat, only show messages after the deletion timestamp
    const deletedAt = (room.deletedFor || []).includes(userId) ? null : room.deletedForAt;
    const afterDate = deletedAt || undefined;

    const messages = await prisma.message.findMany({
      where: { roomId, ...(afterDate ? { createdAt: { gt: afterDate } } : {}) },
      orderBy: { createdAt: "asc" },
      include: {
        sender: { select: { id: true, username: true, displayName: true, profilePicture: true } },
        reactions: { include: { user: { select: { id: true, username: true } } } },
        replyTo: { select: { id: true, text: true, type: true, sender: { select: { id: true, username: true, displayName: true } } } },
      } as any,
    });

    // Filter out soft-deleted messages and vanished-seen messages
    const filtered = messages.filter((m: any) => {
      if ((m.deletedFor || []).includes(userId)) return false;
      // Vanish: if I am recipient and I already saw it, hide
      if (m.isVanish && m.senderId !== userId && m.seenAt) return false;
      return true;
    });

    res.json(filtered);
  } catch (e: any) {
    console.error("Get Chat History Error:", e);
    res.status(500).json({ error: e.message || "Failed to get chat history" });
  }
};

// ──────────────────────────────────────────────
// Accept a message request
// ──────────────────────────────────────────────
export const acceptRequest = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;

    const room = await prisma.chatRoom.findUnique({ where: { id: roomId } });
    if (!room) return res.status(404).json({ error: "Room not found" });
    if (room.user2Id !== userId) return res.status(403).json({ error: "Only the recipient can accept" });

    const updated = await prisma.chatRoom.update({
      where: { id: roomId },
      data: { isAccepted: true },
    });

    res.json(updated);
  } catch (e: any) {
    console.error("Accept Request Error:", e);
    res.status(500).json({ error: e.message || "Failed to accept request" });
  }
};

// ──────────────────────────────────────────────
// Decline / delete a message request
// ──────────────────────────────────────────────
export const declineRequest = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;

    const room = await prisma.chatRoom.findUnique({ where: { id: roomId } });
    if (!room) return res.status(404).json({ error: "Room not found" });
    if (room.user2Id !== userId) return res.status(403).json({ error: "Only the recipient can decline" });

    await prisma.message.deleteMany({ where: { roomId } });
    await prisma.chatRoom.delete({ where: { id: roomId } });

    res.json({ success: true });
  } catch (e: any) {
    console.error("Decline Request Error:", e);
    res.status(500).json({ error: e.message || "Failed to decline request" });
  }
};

// ──────────────────────────────────────────────
// Mark all messages in a room as SEEN
// ──────────────────────────────────────────────
export const markSeen = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;

    await prisma.message.updateMany({
      where: { roomId, senderId: { not: userId }, status: { not: "SEEN" } },
      data: { status: "SEEN" },
    });

    res.json({ success: true });
  } catch (e: any) {
    console.error("Mark Seen Error:", e);
    res.status(500).json({ error: e.message || "Failed to mark as seen" });
  }
};

// ──────────────────────────────────────────────
// Unsend (delete) a message — sender only
// ──────────────────────────────────────────────
export const unsendMessage = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;

    const msg = await prisma.message.findUnique({
      where: { id: messageId },
      include: { room: true },
    });
    if (!msg) return res.status(404).json({ error: "Message not found" });
    if (msg.senderId !== userId) return res.status(403).json({ error: "Only the sender can unsend" });

    const recipientId = msg.room.user1Id === userId ? msg.room.user2Id : msg.room.user1Id;

    await prisma.message.delete({ where: { id: messageId } });

    // Broadcast to both parties
    try {
      const io = req.app.get("io");
      if (io) {
        io.to(`user:${userId}`).emit("message_removed", { messageId });
        io.to(`user:${recipientId}`).emit("message_removed", { messageId });
      }
    } catch (_) {}

    res.json({ success: true });
  } catch (e: any) {
    console.error("Unsend Message Error:", e);
    res.status(500).json({ error: e.message || "Failed to unsend message" });
  }
};

// ──────────────────────────────────────────────
// Delete for me (soft delete — hide only for sender)
// ──────────────────────────────────────────────
export const deleteForMe = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;

    const msg = await prisma.message.findUnique({ where: { id: messageId } });
    if (!msg) return res.status(404).json({ error: "Message not found" });

    await prisma.message.update({
      where: { id: messageId },
      data: { deletedFor: { push: userId } },
    });

    res.json({ success: true });
  } catch (e: any) {
    console.error("Delete For Me Error:", e);
    res.status(500).json({ error: e.message || "Failed to delete message" });
  }
};

// ──────────────────────────────────────────────
// Edit message (within 15 min)
// ──────────────────────────────────────────────
export const editMessage = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;
    const { text } = req.body;

    if (!text?.trim()) return res.status(400).json({ error: "Text is required" });

    const msg = await prisma.message.findUnique({ where: { id: messageId } });
    if (!msg) return res.status(404).json({ error: "Message not found" });
    if (msg.senderId !== userId) return res.status(403).json({ error: "Only sender can edit" });

    const elapsed = Date.now() - new Date(msg.createdAt).getTime();
    if (elapsed > 15 * 60 * 1000) {
      return res.status(403).json({ error: "Can only edit within 15 minutes" });
    }

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { text, edited: true, editedAt: new Date() },
      include: { sender: { select: { id: true, username: true, displayName: true, profilePicture: true } } },
    });

    // Broadcast edit
    try {
      const io = req.app.get("io");
      if (io) {
        const room = await prisma.chatRoom.findUnique({ where: { id: msg.roomId } });
        if (room) {
          const recipientId = room.user1Id === userId ? room.user2Id : room.user1Id;
          io.to(`user:${recipientId}`).emit("message_edited", updated);
          io.to(`user:${userId}`).emit("message_edited", updated);
        }
      }
    } catch (_) {}

    res.json(updated);
  } catch (e: any) {
    console.error("Edit Message Error:", e);
    res.status(500).json({ error: e.message || "Failed to edit message" });
  }
};

// ──────────────────────────────────────────────
// Pin a message
// ──────────────────────────────────────────────
export const pinMessage = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;

    const msg = await prisma.message.findUnique({
      where: { id: messageId },
      include: { room: true },
    });
    if (!msg) return res.status(404).json({ error: "Message not found" });
    if (msg.room.user1Id !== userId && msg.room.user2Id !== userId) {
      return res.status(403).json({ error: "Not in this room" });
    }

    // Unpin any other pinned message in this room first
    await prisma.message.updateMany({
      where: { roomId: msg.roomId, isPinned: true },
      data: { isPinned: false, pinnedAt: null },
    });

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { isPinned: true, pinnedAt: new Date() },
      include: { sender: { select: { id: true, username: true, displayName: true, profilePicture: true } } },
    });

    res.json(updated);
  } catch (e: any) {
    console.error("Pin Message Error:", e);
    res.status(500).json({ error: e.message || "Failed to pin message" });
  }
};

// ──────────────────────────────────────────────
// Unpin message
// ──────────────────────────────────────────────
export const unpinMessage = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;

    const msg = await prisma.message.findUnique({ where: { id: messageId } });
    if (!msg) return res.status(404).json({ error: "Message not found" });

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { isPinned: false, pinnedAt: null },
    });

    res.json(updated);
  } catch (e: any) {
    console.error("Unpin Message Error:", e);
    res.status(500).json({ error: e.message || "Failed to unpin message" });
  }
};

// ──────────────────────────────────────────────
// Mute chat (messages / calls / both)
// ──────────────────────────────────────────────
export const muteChat = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;
    const { muteMessages, muteCalls }: { muteMessages: boolean; muteCalls: boolean } = req.body;

    const room = await (prisma.chatRoom as any).findUnique({ where: { id: roomId } });
    if (!room) return res.status(404).json({ error: "Room not found" });

    const addToSet = (arr: string[], id: string) => arr.includes(id) ? arr : [...arr, id];
    const removeFromSet = (arr: string[], id: string) => arr.filter(x => x !== id);

    const updatedRoom = await (prisma.chatRoom as any).update({
      where: { id: roomId },
      data: {
        mutedMessages: muteMessages ? addToSet(room.mutedMessages, userId) : removeFromSet(room.mutedMessages, userId),
        mutedCalls: muteCalls ? addToSet(room.mutedCalls, userId) : removeFromSet(room.mutedCalls, userId),
      },
    });

    res.json({ mutedMessages: updatedRoom.mutedMessages.includes(userId), mutedCalls: updatedRoom.mutedCalls.includes(userId) });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to mute" });
  }
};

// ──────────────────────────────────────────────
// Get mute status for current user in a room
// ──────────────────────────────────────────────
export const getMuteStatus = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;

    const room = await (prisma.chatRoom as any).findUnique({ where: { id: roomId } });
    if (!room) return res.status(404).json({ error: "Room not found" });

    res.json({
      mutedMessages: room.mutedMessages.includes(userId),
      mutedCalls: room.mutedCalls.includes(userId),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to get mute status" });
  }
};

// ──────────────────────────────────────────────
// Delete chat for me (soft-delete my copy)
// ──────────────────────────────────────────────
export const deleteChatForMe = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;

    const room = await (prisma.chatRoom as any).findUnique({ where: { id: roomId } });
    if (!room) return res.status(404).json({ error: "Room not found" });
    if (room.user1Id !== userId && room.user2Id !== userId) return res.status(403).json({ error: "Not in this room" });

    const already = (room.deletedFor || []).includes(userId);
    if (!already) {
      await (prisma.chatRoom as any).update({
        where: { id: roomId },
        data: { deletedFor: [...(room.deletedFor || []), userId], deletedForAt: new Date() },
      });
    }

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to delete chat" });
  }
};

// ──────────────────────────────────────────────
// Get shared media for a room
// ──────────────────────────────────────────────
export const getSharedMedia = async (req: any, res: any) => {
  try {
    const { roomId } = req.params;
    const { tab = 'media' } = req.query; // media | links | reels

    let typeFilter: any;
    if (tab === 'media') typeFilter = { in: ['image', 'video'] };
    else if (tab === 'links') typeFilter = 'link';
    else if (tab === 'reels') typeFilter = 'reel_share';

    const messages = await prisma.message.findMany({
      where: { roomId, type: typeFilter },
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: { id: true, type: true, mediaUrl: true, text: true, createdAt: true, postId: true },
    });

    res.json(messages);
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to get media" });
  }
};

// ──────────────────────────────────────────────
// Report a user
// ──────────────────────────────────────────────
export const reportUser = async (req: any, res: any) => {
  try {
    const reporterId = req.user.id;
    const { userId: reportedId } = req.params;
    const { category, description, mediaUrls }: { category: string; description?: string; mediaUrls?: string[] } = req.body;

    if (!category) return res.status(400).json({ error: "Category is required" });

    // Store as a support ticket
    await prisma.supportTicket.create({
      data: {
        userId: reporterId,
        category: `Report User: ${category}`,
        description: `Reported User ID: ${reportedId}\n${description || ''}`,
        images: mediaUrls || [],
      },
    });

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to report" });
  }
};

// ──────────────────────────────────────────────
// Toggle a reaction on a message (one per user per message)
// ──────────────────────────────────────────────
export const reactToMessage = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;
    const { emoji }: { emoji: string } = req.body;

    if (!emoji) return res.status(400).json({ error: "emoji is required" });

    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message) return res.status(404).json({ error: "Message not found" });

    // Check existing reaction
    const existing = await (prisma as any).messageReaction.findUnique({
      where: { messageId_userId: { messageId, userId } },
    });

    let result;
    if (existing && existing.emoji === emoji) {
      // Same emoji again → remove
      await (prisma as any).messageReaction.delete({ where: { id: existing.id } });
      result = { removed: true, messageId, userId, emoji };
    } else if (existing) {
      // Different emoji → update
      result = await (prisma as any).messageReaction.update({
        where: { id: existing.id }, data: { emoji },
      });
      result = { ...result, messageId };
    } else {
      result = await (prisma as any).messageReaction.create({
        data: { messageId, userId, emoji },
      });
      result = { ...result, messageId };
    }

    // Notify other side via socket
    try {
      const io = req.app.get("io");
      const room = await prisma.chatRoom.findUnique({ where: { id: message.roomId } });
      if (io && room) {
        const otherId = room.user1Id === userId ? room.user2Id : room.user1Id;
        io.to(`user:${otherId}`).emit("message_reaction", result);
        io.to(`user:${userId}`).emit("message_reaction", result);
      }
    } catch {}

    // Push notification to message sender (only on new reaction, not removal/update)
    if (!existing || (existing && existing.emoji !== emoji)) {
      try {
        const senderId = message.senderId;
        if (senderId !== userId) {
          const { sendPushNotification } = await import("../utils/pushNotifications");
          const reactor = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, displayName: true } });
          sendPushNotification(
            senderId,
            reactor?.displayName || reactor?.username || 'Someone',
            `reacted ${emoji} to your message`,
            { type: 'message_reaction', senderId: userId }
          );
        }
      } catch (_) {}
    }

    res.json(result);
  } catch (e: any) {
    console.error("React Error:", e);
    res.status(500).json({ error: e.message || "Failed to react" });
  }
};

// ──────────────────────────────────────────────
// Toggle vanish mode for current user in a room
// ──────────────────────────────────────────────
export const toggleVanishMode = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;

    const room = await (prisma.chatRoom as any).findUnique({ where: { id: roomId } });
    if (!room) return res.status(404).json({ error: "Room not found" });

    const list: string[] = room.vanishMode || [];
    const enabled = list.includes(userId);
    const newList = enabled ? list.filter(x => x !== userId) : [...list, userId];

    await (prisma.chatRoom as any).update({
      where: { id: roomId }, data: { vanishMode: newList },
    });

    // Notify other side
    try {
      const io = req.app.get("io");
      const otherId = room.user1Id === userId ? room.user2Id : room.user1Id;
      if (io) {
        io.to(`user:${otherId}`).emit("vanish_mode_changed", { roomId, userId, enabled: !enabled });
        io.to(`user:${userId}`).emit("vanish_mode_changed", { roomId, userId, enabled: !enabled });
      }
    } catch {}

    res.json({ vanishMode: !enabled });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to toggle vanish mode" });
  }
};

// ──────────────────────────────────────────────
// Block a user
// ──────────────────────────────────────────────
export const blockUser = async (req: any, res: any) => {
  try {
    const blockerId = req.user.id;
    const { userId: blockedId } = req.params;

    if (blockerId === blockedId) return res.status(400).json({ error: "Cannot block yourself" });

    const existing = await prisma.block.findUnique({
      where: { blockerId_blockedId: { blockerId, blockedId } },
    });
    if (existing) return res.json(existing);

    const block = await prisma.block.create({
      data: { blockerId, blockedId },
    });

    // Remove follow relationships in both directions
    await prisma.follow.deleteMany({
      where: {
        OR: [
          { followerId: blockerId, followingId: blockedId },
          { followerId: blockedId, followingId: blockerId },
        ],
      },
    });

    // Delete any existing chat room between them
    const room = await prisma.chatRoom.findFirst({
      where: {
        OR: [
          { user1Id: blockerId, user2Id: blockedId },
          { user1Id: blockedId, user2Id: blockerId },
        ],
      },
    });
    if (room) {
      await prisma.message.deleteMany({ where: { roomId: room.id } });
      await prisma.chatRoom.delete({ where: { id: room.id } });
    }

    res.json(block);
  } catch (e: any) {
    console.error("Block User Error:", e);
    res.status(500).json({ error: e.message || "Failed to block user" });
  }
};

// ──────────────────────────────────────────────
// Unblock a user
// ──────────────────────────────────────────────
// ─── Get scheduled messages for a room ───
export const getScheduledMessages = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { roomId } = req.params;
    const msgs = await (prisma.message as any).findMany({
      where: { roomId, senderId: userId, status: 'SCHEDULED' },
      orderBy: { scheduledAt: 'asc' },
    });
    res.json(msgs);
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to get scheduled messages' });
  }
};

// ─── Cancel (delete) a scheduled message ───
export const cancelScheduledMessage = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;
    const msg = await (prisma.message as any).findUnique({ where: { id: messageId } });
    if (!msg || msg.senderId !== userId) return res.status(403).json({ error: 'Not allowed' });
    if (msg.status !== 'SCHEDULED') return res.status(400).json({ error: 'Message already sent' });
    await prisma.message.delete({ where: { id: messageId } });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to cancel message' });
  }
};

export const unblockUser = async (req: any, res: any) => {
  try {
    const blockerId = req.user.id;
    const { userId: blockedId } = req.params;

    await prisma.block.deleteMany({
      where: { blockerId, blockedId },
    });

    res.json({ success: true });
  } catch (e: any) {
    console.error("Unblock User Error:", e);
    res.status(500).json({ error: e.message || "Failed to unblock user" });
  }
};