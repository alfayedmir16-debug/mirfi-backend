"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.unblockUser = exports.cancelScheduledMessage = exports.getScheduledMessages = exports.blockUser = exports.toggleVanishMode = exports.reactToMessage = exports.reportUser = exports.getSharedMedia = exports.deleteChatForMe = exports.getMuteStatus = exports.muteChat = exports.unpinMessage = exports.pinMessage = exports.editMessage = exports.deleteForMe = exports.unsendMessage = exports.markSeen = exports.declineRequest = exports.acceptRequest = exports.getChatHistory = exports.getRooms = exports.sendMessage = exports.initiateRoom = void 0;
const db_1 = require("../db");
const socketHandler_1 = require("../utils/socketHandler");
// ──────────────────────────────────────────────
// Helper: get or create a ChatRoom with privacy
// ──────────────────────────────────────────────
async function getOrCreateChatRoom(senderId, recipientId) {
    // 1. Block check
    const blocked = await db_1.prisma.block.findFirst({
        where: {
            OR: [
                { blockerId: senderId, blockedId: recipientId },
                { blockerId: recipientId, blockedId: senderId },
            ],
        },
    });
    if (blocked)
        return { room: null, error: "Cannot message this user", status: 403 };
    // 2. Existing room (either direction)
    const existing = await db_1.prisma.chatRoom.findFirst({
        where: {
            OR: [
                { user1Id: senderId, user2Id: recipientId },
                { user1Id: recipientId, user2Id: senderId },
            ],
        },
    });
    if (existing)
        return { room: existing };
    // 3. Check recipient privacy settings
    const recipient = await db_1.prisma.user.findUnique({
        where: { id: recipientId },
        select: { isPrivate: true, messagePrivacy: true }
    });
    if (!recipient)
        return { room: null, error: "Recipient not found", status: 404 };
    const senderFollowsRecipient = await db_1.prisma.follow.findFirst({
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
        }
        else {
            return { room: null, error: "You must follow this private account to message them.", status: 403 };
        }
    }
    // Rule 3: If recipient's account is public
    else {
        if (recipient.messagePrivacy === 'EVERYONE') {
            canMessage = true;
            // It's a request if the sender doesn't follow the recipient
            isRequest = !senderFollowsRecipient;
        }
        else if (recipient.messagePrivacy === 'FOLLOWERS') {
            if (senderFollowsRecipient) {
                canMessage = true;
                isRequest = false; // Direct message if sender is a follower
            }
            else {
                return { room: null, error: "This user only accepts messages from followers.", status: 403 };
            }
        }
    }
    if (!canMessage) {
        // This case should ideally not be hit due to the logic above, but as a fallback.
        return { room: null, error: "You cannot message this user.", status: 403 };
    }
    // 4. Create the room
    const newRoom = await db_1.prisma.chatRoom.create({
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
async function assertRoomAccess(senderId, recipientId) {
    const result = await getOrCreateChatRoom(senderId, recipientId);
    return result;
}
// ──────────────────────────────────────────────
// Initiate a room (called before first message)
// ──────────────────────────────────────────────
const initiateRoom = async (req, res) => {
    try {
        const senderId = req.user.id;
        const { recipientId } = req.body;
        if (!recipientId)
            return res.status(400).json({ error: "recipientId is required" });
        const { room, error, status } = await assertRoomAccess(senderId, recipientId);
        if (error)
            return res.status(status || 403).json({ error });
        res.json(room);
    }
    catch (e) {
        console.error("Initiate Room Error:", e);
        res.status(500).json({ error: e.message || "Failed to initiate room" });
    }
};
exports.initiateRoom = initiateRoom;
// ──────────────────────────────────────────────
// Send a message (auto-creates room if needed)
// ──────────────────────────────────────────────
const sendMessage = async (req, res) => {
    try {
        const senderId = req.user.id;
        const { recipientId, text, type, mediaUrl, postId, storyId, replyToId, audioDuration, scheduledAt } = req.body;
        if (!recipientId)
            return res.status(400).json({ error: "recipientId is required" });
        // Get or create room with privacy check
        const { room, error, status: errStatus } = await assertRoomAccess(senderId, recipientId);
        if (error)
            return res.status(errStatus || 403).json({ error });
        // Vanish mode: if either user has it on, mark message as vanish
        const fullRoom = await db_1.prisma.chatRoom.findUnique({ where: { id: room.id }, select: { vanishMode: true } });
        const isVanish = (fullRoom?.vanishMode || []).length > 0;
        const message = await db_1.prisma.message.create({
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
            },
            include: {
                sender: { select: { id: true, username: true, displayName: true, profilePicture: true } },
                replyTo: { select: { id: true, text: true, type: true, sender: { select: { id: true, username: true, displayName: true } } } },
            },
        });
        // Update room timestamp + restore deleted chat if sender had deleted it
        const freshRoom = await db_1.prisma.chatRoom.findUnique({ where: { id: room.id }, select: { deletedFor: true } });
        const updateData = { updatedAt: new Date() };
        if (freshRoom?.deletedFor?.includes(senderId)) {
            updateData.deletedFor = freshRoom.deletedFor.filter((uid) => uid !== senderId);
        }
        await db_1.prisma.chatRoom.update({ where: { id: room.id }, data: updateData });
        // Broadcast via Socket.IO if online
        try {
            const io = req.app.get("io");
            if (io) {
                const recipientId = room.user1Id === senderId ? room.user2Id : room.user1Id;
                if ((0, socketHandler_1.isUserOnline)(recipientId)) {
                    io.to(`user:${recipientId}`).emit("new_message", message);
                    await db_1.prisma.message.update({ where: { id: message.id }, data: { status: "DELIVERED" } });
                    message.status = "DELIVERED";
                    io.to(`user:${senderId}`).emit("message_delivered", { messageId: message.id });
                }
            }
        }
        catch (_) { }
        // Notification + push
        try {
            const msgType = type === "post_share" ? "shared a post" : type === "reel_share" ? "shared a reel" : mediaUrl ? "sent an image" : text ? `"${text.substring(0, 60)}${text.length > 60 ? "..." : ""}"` : "sent a message";
            await db_1.prisma.notification.create({
                data: { userId: recipientId, senderId, type: "message", text: msgType },
            });
            const { sendPushNotification } = await Promise.resolve().then(() => __importStar(require("../utils/pushNotifications")));
            const sender = await db_1.prisma.user.findUnique({ where: { id: senderId }, select: { username: true, displayName: true, profilePicture: true } });
            if (sender) {
                const richText = text ? text.substring(0, 200) : mediaUrl ? "📸 Photo" : "sent a message";
                sendPushNotification(recipientId, sender.displayName || sender.username, richText, {
                    type: "message",
                    senderId,
                    senderName: sender.displayName || sender.username,
                    senderAvatar: sender.profilePicture,
                    messageText: text || "",
                });
            }
        }
        catch (_) { }
        res.json(message);
    }
    catch (e) {
        console.error("Send Message Error:", e);
        res.status(500).json({ error: e.message || "Failed to send message" });
    }
};
exports.sendMessage = sendMessage;
// ──────────────────────────────────────────────
// List all my rooms (split by primary / requests)
// ──────────────────────────────────────────────
const getRooms = async (req, res) => {
    try {
        const userId = req.user.id;
        const rooms = await db_1.prisma.chatRoom.findMany({
            where: { OR: [{ user1Id: userId }, { user2Id: userId }], NOT: { deletedFor: { has: userId } } },
            include: {
                user1: { select: { id: true, username: true, displayName: true, profilePicture: true } },
                user2: { select: { id: true, username: true, displayName: true, profilePicture: true } },
                messages: { orderBy: { createdAt: "desc" }, take: 1 },
                // Unread count: number of messages not sent by me with status != SEEN
            },
            orderBy: { updatedAt: "desc" },
        });
        const enriched = await Promise.all(rooms.map(async (room) => {
            const partner = room.user1Id === userId ? room.user2 : room.user1;
            const unreadCount = await db_1.prisma.message.count({
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
        }));
        const primary = enriched.filter((r) => r.isAccepted || (r.isRequest === false));
        const requests = enriched.filter((r) => r.isRequest);
        res.json({ primary, requests });
    }
    catch (e) {
        console.error("Get Rooms Error:", e);
        res.status(500).json({ error: e.message || "Failed to get rooms" });
    }
};
exports.getRooms = getRooms;
// ──────────────────────────────────────────────
// Chat history for a specific room
// ──────────────────────────────────────────────
const getChatHistory = async (req, res) => {
    try {
        const userId = req.user.id;
        const { roomId } = req.params;
        const room = await db_1.prisma.chatRoom.findUnique({ where: { id: roomId } });
        if (!room)
            return res.status(404).json({ error: "Room not found" });
        if (room.user1Id !== userId && room.user2Id !== userId) {
            return res.status(403).json({ error: "Not a participant" });
        }
        // If user deleted this chat, only show messages after the deletion timestamp
        const deletedAt = (room.deletedFor || []).includes(userId) ? null : room.deletedForAt;
        const afterDate = deletedAt || undefined;
        const messages = await db_1.prisma.message.findMany({
            where: { roomId, ...(afterDate ? { createdAt: { gt: afterDate } } : {}) },
            orderBy: { createdAt: "asc" },
            include: {
                sender: { select: { id: true, username: true, displayName: true, profilePicture: true } },
                reactions: { include: { user: { select: { id: true, username: true } } } },
                replyTo: { select: { id: true, text: true, type: true, sender: { select: { id: true, username: true, displayName: true } } } },
            },
        });
        // Filter out soft-deleted messages and vanished-seen messages
        const filtered = messages.filter((m) => {
            if ((m.deletedFor || []).includes(userId))
                return false;
            // Vanish: if I am recipient and I already saw it, hide
            if (m.isVanish && m.senderId !== userId && m.seenAt)
                return false;
            return true;
        });
        res.json(filtered);
    }
    catch (e) {
        console.error("Get Chat History Error:", e);
        res.status(500).json({ error: e.message || "Failed to get chat history" });
    }
};
exports.getChatHistory = getChatHistory;
// ──────────────────────────────────────────────
// Accept a message request
// ──────────────────────────────────────────────
const acceptRequest = async (req, res) => {
    try {
        const userId = req.user.id;
        const { roomId } = req.params;
        const room = await db_1.prisma.chatRoom.findUnique({ where: { id: roomId } });
        if (!room)
            return res.status(404).json({ error: "Room not found" });
        if (room.user2Id !== userId)
            return res.status(403).json({ error: "Only the recipient can accept" });
        const updated = await db_1.prisma.chatRoom.update({
            where: { id: roomId },
            data: { isAccepted: true },
        });
        res.json(updated);
    }
    catch (e) {
        console.error("Accept Request Error:", e);
        res.status(500).json({ error: e.message || "Failed to accept request" });
    }
};
exports.acceptRequest = acceptRequest;
// ──────────────────────────────────────────────
// Decline / delete a message request
// ──────────────────────────────────────────────
const declineRequest = async (req, res) => {
    try {
        const userId = req.user.id;
        const { roomId } = req.params;
        const room = await db_1.prisma.chatRoom.findUnique({ where: { id: roomId } });
        if (!room)
            return res.status(404).json({ error: "Room not found" });
        if (room.user2Id !== userId)
            return res.status(403).json({ error: "Only the recipient can decline" });
        await db_1.prisma.message.deleteMany({ where: { roomId } });
        await db_1.prisma.chatRoom.delete({ where: { id: roomId } });
        res.json({ success: true });
    }
    catch (e) {
        console.error("Decline Request Error:", e);
        res.status(500).json({ error: e.message || "Failed to decline request" });
    }
};
exports.declineRequest = declineRequest;
// ──────────────────────────────────────────────
// Mark all messages in a room as SEEN
// ──────────────────────────────────────────────
const markSeen = async (req, res) => {
    try {
        const userId = req.user.id;
        const { roomId } = req.params;
        await db_1.prisma.message.updateMany({
            where: { roomId, senderId: { not: userId }, status: { not: "SEEN" } },
            data: { status: "SEEN" },
        });
        res.json({ success: true });
    }
    catch (e) {
        console.error("Mark Seen Error:", e);
        res.status(500).json({ error: e.message || "Failed to mark as seen" });
    }
};
exports.markSeen = markSeen;
// ──────────────────────────────────────────────
// Unsend (delete) a message — sender only
// ──────────────────────────────────────────────
const unsendMessage = async (req, res) => {
    try {
        const userId = req.user.id;
        const { messageId } = req.params;
        const msg = await db_1.prisma.message.findUnique({
            where: { id: messageId },
            include: { room: true },
        });
        if (!msg)
            return res.status(404).json({ error: "Message not found" });
        if (msg.senderId !== userId)
            return res.status(403).json({ error: "Only the sender can unsend" });
        const recipientId = msg.room.user1Id === userId ? msg.room.user2Id : msg.room.user1Id;
        await db_1.prisma.message.delete({ where: { id: messageId } });
        // Broadcast to both parties
        try {
            const io = req.app.get("io");
            if (io) {
                io.to(`user:${userId}`).emit("message_removed", { messageId });
                io.to(`user:${recipientId}`).emit("message_removed", { messageId });
            }
        }
        catch (_) { }
        res.json({ success: true });
    }
    catch (e) {
        console.error("Unsend Message Error:", e);
        res.status(500).json({ error: e.message || "Failed to unsend message" });
    }
};
exports.unsendMessage = unsendMessage;
// ──────────────────────────────────────────────
// Delete for me (soft delete — hide only for sender)
// ──────────────────────────────────────────────
const deleteForMe = async (req, res) => {
    try {
        const userId = req.user.id;
        const { messageId } = req.params;
        const msg = await db_1.prisma.message.findUnique({ where: { id: messageId } });
        if (!msg)
            return res.status(404).json({ error: "Message not found" });
        await db_1.prisma.message.update({
            where: { id: messageId },
            data: { deletedFor: { push: userId } },
        });
        res.json({ success: true });
    }
    catch (e) {
        console.error("Delete For Me Error:", e);
        res.status(500).json({ error: e.message || "Failed to delete message" });
    }
};
exports.deleteForMe = deleteForMe;
// ──────────────────────────────────────────────
// Edit message (within 15 min)
// ──────────────────────────────────────────────
const editMessage = async (req, res) => {
    try {
        const userId = req.user.id;
        const { messageId } = req.params;
        const { text } = req.body;
        if (!text?.trim())
            return res.status(400).json({ error: "Text is required" });
        const msg = await db_1.prisma.message.findUnique({ where: { id: messageId } });
        if (!msg)
            return res.status(404).json({ error: "Message not found" });
        if (msg.senderId !== userId)
            return res.status(403).json({ error: "Only sender can edit" });
        const elapsed = Date.now() - new Date(msg.createdAt).getTime();
        if (elapsed > 15 * 60 * 1000) {
            return res.status(403).json({ error: "Can only edit within 15 minutes" });
        }
        const updated = await db_1.prisma.message.update({
            where: { id: messageId },
            data: { text, edited: true, editedAt: new Date() },
            include: { sender: { select: { id: true, username: true, displayName: true, profilePicture: true } } },
        });
        // Broadcast edit
        try {
            const io = req.app.get("io");
            if (io) {
                const room = await db_1.prisma.chatRoom.findUnique({ where: { id: msg.roomId } });
                if (room) {
                    const recipientId = room.user1Id === userId ? room.user2Id : room.user1Id;
                    io.to(`user:${recipientId}`).emit("message_edited", updated);
                    io.to(`user:${userId}`).emit("message_edited", updated);
                }
            }
        }
        catch (_) { }
        res.json(updated);
    }
    catch (e) {
        console.error("Edit Message Error:", e);
        res.status(500).json({ error: e.message || "Failed to edit message" });
    }
};
exports.editMessage = editMessage;
// ──────────────────────────────────────────────
// Pin a message
// ──────────────────────────────────────────────
const pinMessage = async (req, res) => {
    try {
        const userId = req.user.id;
        const { messageId } = req.params;
        const msg = await db_1.prisma.message.findUnique({
            where: { id: messageId },
            include: { room: true },
        });
        if (!msg)
            return res.status(404).json({ error: "Message not found" });
        if (msg.room.user1Id !== userId && msg.room.user2Id !== userId) {
            return res.status(403).json({ error: "Not in this room" });
        }
        // Unpin any other pinned message in this room first
        await db_1.prisma.message.updateMany({
            where: { roomId: msg.roomId, isPinned: true },
            data: { isPinned: false, pinnedAt: null },
        });
        const updated = await db_1.prisma.message.update({
            where: { id: messageId },
            data: { isPinned: true, pinnedAt: new Date() },
            include: { sender: { select: { id: true, username: true, displayName: true, profilePicture: true } } },
        });
        res.json(updated);
    }
    catch (e) {
        console.error("Pin Message Error:", e);
        res.status(500).json({ error: e.message || "Failed to pin message" });
    }
};
exports.pinMessage = pinMessage;
// ──────────────────────────────────────────────
// Unpin message
// ──────────────────────────────────────────────
const unpinMessage = async (req, res) => {
    try {
        const userId = req.user.id;
        const { messageId } = req.params;
        const msg = await db_1.prisma.message.findUnique({ where: { id: messageId } });
        if (!msg)
            return res.status(404).json({ error: "Message not found" });
        const updated = await db_1.prisma.message.update({
            where: { id: messageId },
            data: { isPinned: false, pinnedAt: null },
        });
        res.json(updated);
    }
    catch (e) {
        console.error("Unpin Message Error:", e);
        res.status(500).json({ error: e.message || "Failed to unpin message" });
    }
};
exports.unpinMessage = unpinMessage;
// ──────────────────────────────────────────────
// Mute chat (messages / calls / both)
// ──────────────────────────────────────────────
const muteChat = async (req, res) => {
    try {
        const userId = req.user.id;
        const { roomId } = req.params;
        const { muteMessages, muteCalls } = req.body;
        const room = await db_1.prisma.chatRoom.findUnique({ where: { id: roomId } });
        if (!room)
            return res.status(404).json({ error: "Room not found" });
        const addToSet = (arr, id) => arr.includes(id) ? arr : [...arr, id];
        const removeFromSet = (arr, id) => arr.filter(x => x !== id);
        const updatedRoom = await db_1.prisma.chatRoom.update({
            where: { id: roomId },
            data: {
                mutedMessages: muteMessages ? addToSet(room.mutedMessages, userId) : removeFromSet(room.mutedMessages, userId),
                mutedCalls: muteCalls ? addToSet(room.mutedCalls, userId) : removeFromSet(room.mutedCalls, userId),
            },
        });
        res.json({ mutedMessages: updatedRoom.mutedMessages.includes(userId), mutedCalls: updatedRoom.mutedCalls.includes(userId) });
    }
    catch (e) {
        res.status(500).json({ error: e.message || "Failed to mute" });
    }
};
exports.muteChat = muteChat;
// ──────────────────────────────────────────────
// Get mute status for current user in a room
// ──────────────────────────────────────────────
const getMuteStatus = async (req, res) => {
    try {
        const userId = req.user.id;
        const { roomId } = req.params;
        const room = await db_1.prisma.chatRoom.findUnique({ where: { id: roomId } });
        if (!room)
            return res.status(404).json({ error: "Room not found" });
        res.json({
            mutedMessages: room.mutedMessages.includes(userId),
            mutedCalls: room.mutedCalls.includes(userId),
        });
    }
    catch (e) {
        res.status(500).json({ error: e.message || "Failed to get mute status" });
    }
};
exports.getMuteStatus = getMuteStatus;
// ──────────────────────────────────────────────
// Delete chat for me (soft-delete my copy)
// ──────────────────────────────────────────────
const deleteChatForMe = async (req, res) => {
    try {
        const userId = req.user.id;
        const { roomId } = req.params;
        const room = await db_1.prisma.chatRoom.findUnique({ where: { id: roomId } });
        if (!room)
            return res.status(404).json({ error: "Room not found" });
        if (room.user1Id !== userId && room.user2Id !== userId)
            return res.status(403).json({ error: "Not in this room" });
        const already = (room.deletedFor || []).includes(userId);
        if (!already) {
            await db_1.prisma.chatRoom.update({
                where: { id: roomId },
                data: { deletedFor: [...(room.deletedFor || []), userId], deletedForAt: new Date() },
            });
        }
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ error: e.message || "Failed to delete chat" });
    }
};
exports.deleteChatForMe = deleteChatForMe;
// ──────────────────────────────────────────────
// Get shared media for a room
// ──────────────────────────────────────────────
const getSharedMedia = async (req, res) => {
    try {
        const { roomId } = req.params;
        const { tab = 'media' } = req.query; // media | links | reels
        let typeFilter;
        if (tab === 'media')
            typeFilter = { in: ['image', 'video'] };
        else if (tab === 'links')
            typeFilter = 'link';
        else if (tab === 'reels')
            typeFilter = 'reel_share';
        const messages = await db_1.prisma.message.findMany({
            where: { roomId, type: typeFilter },
            orderBy: { createdAt: 'desc' },
            take: 60,
            select: { id: true, type: true, mediaUrl: true, text: true, createdAt: true, postId: true },
        });
        res.json(messages);
    }
    catch (e) {
        res.status(500).json({ error: e.message || "Failed to get media" });
    }
};
exports.getSharedMedia = getSharedMedia;
// ──────────────────────────────────────────────
// Report a user
// ──────────────────────────────────────────────
const reportUser = async (req, res) => {
    try {
        const reporterId = req.user.id;
        const { userId: reportedId } = req.params;
        const { category, description, mediaUrls } = req.body;
        if (!category)
            return res.status(400).json({ error: "Category is required" });
        // Store as a support ticket
        await db_1.prisma.supportTicket.create({
            data: {
                userId: reporterId,
                category: `Report User: ${category}`,
                description: `Reported User ID: ${reportedId}\n${description || ''}`,
                images: mediaUrls || [],
            },
        });
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ error: e.message || "Failed to report" });
    }
};
exports.reportUser = reportUser;
// ──────────────────────────────────────────────
// Toggle a reaction on a message (one per user per message)
// ──────────────────────────────────────────────
const reactToMessage = async (req, res) => {
    try {
        const userId = req.user.id;
        const { messageId } = req.params;
        const { emoji } = req.body;
        if (!emoji)
            return res.status(400).json({ error: "emoji is required" });
        const message = await db_1.prisma.message.findUnique({ where: { id: messageId } });
        if (!message)
            return res.status(404).json({ error: "Message not found" });
        // Check existing reaction
        const existing = await db_1.prisma.messageReaction.findUnique({
            where: { messageId_userId: { messageId, userId } },
        });
        let result;
        if (existing && existing.emoji === emoji) {
            // Same emoji again → remove
            await db_1.prisma.messageReaction.delete({ where: { id: existing.id } });
            result = { removed: true, messageId, userId, emoji };
        }
        else if (existing) {
            // Different emoji → update
            result = await db_1.prisma.messageReaction.update({
                where: { id: existing.id }, data: { emoji },
            });
            result = { ...result, messageId };
        }
        else {
            result = await db_1.prisma.messageReaction.create({
                data: { messageId, userId, emoji },
            });
            result = { ...result, messageId };
        }
        // Notify other side via socket
        try {
            const io = req.app.get("io");
            const room = await db_1.prisma.chatRoom.findUnique({ where: { id: message.roomId } });
            if (io && room) {
                const otherId = room.user1Id === userId ? room.user2Id : room.user1Id;
                io.to(`user:${otherId}`).emit("message_reaction", result);
                io.to(`user:${userId}`).emit("message_reaction", result);
            }
        }
        catch { }
        // Push notification to message sender (only on new reaction, not removal/update)
        if (!existing || (existing && existing.emoji !== emoji)) {
            try {
                const senderId = message.senderId;
                if (senderId !== userId) {
                    const { sendPushNotification } = await Promise.resolve().then(() => __importStar(require("../utils/pushNotifications")));
                    const reactor = await db_1.prisma.user.findUnique({ where: { id: userId }, select: { username: true, displayName: true } });
                    sendPushNotification(senderId, reactor?.displayName || reactor?.username || 'Someone', `reacted ${emoji} to your message`, { type: 'message_reaction', senderId: userId });
                }
            }
            catch (_) { }
        }
        res.json(result);
    }
    catch (e) {
        console.error("React Error:", e);
        res.status(500).json({ error: e.message || "Failed to react" });
    }
};
exports.reactToMessage = reactToMessage;
// ──────────────────────────────────────────────
// Toggle vanish mode for current user in a room
// ──────────────────────────────────────────────
const toggleVanishMode = async (req, res) => {
    try {
        const userId = req.user.id;
        const { roomId } = req.params;
        const room = await db_1.prisma.chatRoom.findUnique({ where: { id: roomId } });
        if (!room)
            return res.status(404).json({ error: "Room not found" });
        const list = room.vanishMode || [];
        const enabled = list.includes(userId);
        const newList = enabled ? list.filter(x => x !== userId) : [...list, userId];
        await db_1.prisma.chatRoom.update({
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
        }
        catch { }
        res.json({ vanishMode: !enabled });
    }
    catch (e) {
        res.status(500).json({ error: e.message || "Failed to toggle vanish mode" });
    }
};
exports.toggleVanishMode = toggleVanishMode;
// ──────────────────────────────────────────────
// Block a user
// ──────────────────────────────────────────────
const blockUser = async (req, res) => {
    try {
        const blockerId = req.user.id;
        const { userId: blockedId } = req.params;
        if (blockerId === blockedId)
            return res.status(400).json({ error: "Cannot block yourself" });
        const existing = await db_1.prisma.block.findUnique({
            where: { blockerId_blockedId: { blockerId, blockedId } },
        });
        if (existing)
            return res.json(existing);
        const block = await db_1.prisma.block.create({
            data: { blockerId, blockedId },
        });
        // Remove follow relationships in both directions
        await db_1.prisma.follow.deleteMany({
            where: {
                OR: [
                    { followerId: blockerId, followingId: blockedId },
                    { followerId: blockedId, followingId: blockerId },
                ],
            },
        });
        // Delete any existing chat room between them
        const room = await db_1.prisma.chatRoom.findFirst({
            where: {
                OR: [
                    { user1Id: blockerId, user2Id: blockedId },
                    { user1Id: blockedId, user2Id: blockerId },
                ],
            },
        });
        if (room) {
            await db_1.prisma.message.deleteMany({ where: { roomId: room.id } });
            await db_1.prisma.chatRoom.delete({ where: { id: room.id } });
        }
        res.json(block);
    }
    catch (e) {
        console.error("Block User Error:", e);
        res.status(500).json({ error: e.message || "Failed to block user" });
    }
};
exports.blockUser = blockUser;
// ──────────────────────────────────────────────
// Unblock a user
// ──────────────────────────────────────────────
// ─── Get scheduled messages for a room ───
const getScheduledMessages = async (req, res) => {
    try {
        const userId = req.user.id;
        const { roomId } = req.params;
        const msgs = await db_1.prisma.message.findMany({
            where: { roomId, senderId: userId, status: 'SCHEDULED' },
            orderBy: { scheduledAt: 'asc' },
        });
        res.json(msgs);
    }
    catch (e) {
        res.status(500).json({ error: e.message || 'Failed to get scheduled messages' });
    }
};
exports.getScheduledMessages = getScheduledMessages;
// ─── Cancel (delete) a scheduled message ───
const cancelScheduledMessage = async (req, res) => {
    try {
        const userId = req.user.id;
        const { messageId } = req.params;
        const msg = await db_1.prisma.message.findUnique({ where: { id: messageId } });
        if (!msg || msg.senderId !== userId)
            return res.status(403).json({ error: 'Not allowed' });
        if (msg.status !== 'SCHEDULED')
            return res.status(400).json({ error: 'Message already sent' });
        await db_1.prisma.message.delete({ where: { id: messageId } });
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ error: e.message || 'Failed to cancel message' });
    }
};
exports.cancelScheduledMessage = cancelScheduledMessage;
const unblockUser = async (req, res) => {
    try {
        const blockerId = req.user.id;
        const { userId: blockedId } = req.params;
        await db_1.prisma.block.deleteMany({
            where: { blockerId, blockedId },
        });
        res.json({ success: true });
    }
    catch (e) {
        console.error("Unblock User Error:", e);
        res.status(500).json({ error: e.message || "Failed to unblock user" });
    }
};
exports.unblockUser = unblockUser;
