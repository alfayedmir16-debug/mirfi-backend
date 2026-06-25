import jwt from "jsonwebtoken";
import { Socket, Server as SocketIOServer } from "socket.io";
import prisma from "../config/db";

const onlineUsers = new Map<string, Set<string>>(); // userId → Set<socketId>

export const setupSocket = (io: SocketIOServer) => {
  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("No token provided"));

    try {
      const user = jwt.verify(token, process.env.JWT_SECRET || "mirfi_super_secret_jwt_token_2026_key_abc123") as any;
      (socket as any).user = user;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", async (socket: Socket) => {
    const userId = (socket as any).user.id;

    // Track online (always track internally, but respect hideOnlineStatus for broadcasts)
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId)!.add(socket.id);

    // Join personal room
    socket.join(`user:${userId}`);

    // Update lastSeen on connect
    try { await (prisma.user as any).update({ where: { id: userId }, data: { lastSeen: new Date() } }); } catch {}

    // Broadcast online only if user hasn't hidden their status
    try {
      const userPref = await (prisma.user as any).findUnique({ where: { id: userId }, select: { hideOnlineStatus: true } });
      if (!userPref?.hideOnlineStatus) {
        socket.broadcast.emit("user_online", { userId });
      }
    } catch { socket.broadcast.emit("user_online", { userId }); }

    // ─── send_message ───
    socket.on("send_message", async (data: { roomId: string; text?: string; type?: string; replyToId?: string; mediaUrl?: string; postId?: string }) => {
      try {
        const message = await prisma.message.create({
          data: {
            roomId: data.roomId,
            senderId: userId,
            text: data.text || null,
            type: data.type || "text",
            replyToId: data.replyToId || null,
            mediaUrl: data.mediaUrl || null,
            postId: data.postId || null,
            status: "SENT",
          },
          include: {
            sender: { select: { id: true, username: true, displayName: true, profilePicture: true } },
          },
        });

        // Find recipient
        const room = await prisma.chatRoom.findUnique({ where: { id: data.roomId } });
        if (room) {
          const recipientId = room.user1Id === userId ? room.user2Id : room.user1Id;

          // Update room timestamp
          await prisma.chatRoom.update({ where: { id: data.roomId }, data: { updatedAt: new Date() } });

          // If recipient online → push real-time + DELIVERED
          if (onlineUsers.has(recipientId)) {
            io.to(`user:${recipientId}`).emit("new_message", message);
            await prisma.message.update({ where: { id: message.id }, data: { status: "DELIVERED" } });
            io.to(`user:${userId}`).emit("message_delivered", { messageId: message.id });
          }

          // Notification + push for offline (skip if messages muted)
          try {
            const roomForMute = await (prisma.chatRoom as any).findUnique({ where: { id: data.roomId }, select: { mutedMessages: true } });
            const isMsgMuted = roomForMute?.mutedMessages?.includes(recipientId);
            const msgType = data.type === "post_share" ? "shared a post" : data.type === "reel_share" ? "shared a reel" : data.mediaUrl ? "sent an image" : data.text ? `"${data.text.substring(0, 60)}${data.text.length > 60 ? "..." : ""}"` : "sent a message";
            await prisma.notification.create({
              data: { userId: recipientId, senderId: userId, type: "message", text: msgType },
            });
            if (!isMsgMuted) {
              const { sendPushNotification } = await import("./pushNotifications");
              const sender = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
              if (sender) {
                sendPushNotification(recipientId, sender.username, msgType, { type: "message", senderId: userId });
              }
            }
          } catch (_) {}
        }

        socket.emit("message_sent", message);
      } catch (e) {
        console.error("Socket send_message error:", e);
        socket.emit("message_error", { error: "Failed to send message" });
      }
    });

    // ─── typing ───
    socket.on("typing_start", async ({ roomId }: { roomId: string }) => {
      const room = await prisma.chatRoom.findUnique({ where: { id: roomId } });
      if (room) {
        const recipientId = room.user1Id === userId ? room.user2Id : room.user1Id;
        io.to(`user:${recipientId}`).emit("user_typing", { roomId, userId, isTyping: true });
      }
    });

    socket.on("typing_stop", async ({ roomId }: { roomId: string }) => {
      const room = await prisma.chatRoom.findUnique({ where: { id: roomId } });
      if (room) {
        const recipientId = room.user1Id === userId ? room.user2Id : room.user1Id;
        io.to(`user:${recipientId}`).emit("user_typing", { roomId, userId, isTyping: false });
      }
    });

    // ─── mark_seen ───
    socket.on("mark_seen", async ({ roomId }: { roomId: string }) => {
      try {
        await prisma.message.updateMany({
          where: { roomId, senderId: { not: userId }, status: { not: "SEEN" } },
          data: { status: "SEEN" },
        });

        // Vanish messages: stamp seenAt and broadcast removal so both UIs hide them
        const vanishMsgs = await (prisma.message as any).findMany({
          where: { roomId, senderId: { not: userId }, isVanish: true, seenAt: null },
          select: { id: true, senderId: true },
        });
        if (vanishMsgs.length > 0) {
          await (prisma.message as any).updateMany({
            where: { id: { in: vanishMsgs.map((m: any) => m.id) } },
            data: { seenAt: new Date() },
          });
          // Notify both sides — give a small delay so recipient briefly sees content
          setTimeout(() => {
            vanishMsgs.forEach((m: any) => {
              io.to(`user:${userId}`).emit("message_removed", { messageId: m.id });
              io.to(`user:${m.senderId}`).emit("message_removed", { messageId: m.id });
            });
          }, 5000);
        }

        io.to(`room:${roomId}`).emit("messages_seen", { roomId, seenBy: userId });
      } catch (e) {
        console.error("Socket mark_seen error:", e);
      }
    });

    // ─── unsend_message ───
    socket.on("unsend_message", async ({ messageId }: { messageId: string }) => {
      try {
        const msg = await prisma.message.findUnique({ where: { id: messageId } });
        if (!msg || msg.senderId !== userId) return;

        await prisma.message.delete({ where: { id: messageId } });

        const room = await prisma.chatRoom.findUnique({ where: { id: msg.roomId } });
        if (room) {
          const recipientId = room.user1Id === userId ? room.user2Id : room.user1Id;
          io.to(`user:${userId}`).emit("message_removed", { messageId });
          io.to(`user:${recipientId}`).emit("message_removed", { messageId });
        }
      } catch (e) {
        console.error("Socket unsend_message error:", e);
      }
    });

    // ─── call signaling ───
    socket.on("call_user", async ({ recipientId, callType, channel, callerName, callerAvatar }: {
      recipientId: string; callType: string; channel: string; callerName: string; callerAvatar: string;
    }) => {
      try {
        // Find the room between caller and recipient to check mute
        const room = await (prisma.chatRoom as any).findFirst({
          where: {
            OR: [
              { user1Id: userId, user2Id: recipientId },
              { user1Id: recipientId, user2Id: userId },
            ],
          },
          select: { mutedCalls: true },
        });
        const isCallMuted = room?.mutedCalls?.includes(recipientId);
        if (!isCallMuted) {
          io.to(`user:${recipientId}`).emit("incoming_call", {
            callerId: userId, callType, channel, callerName, callerAvatar,
          });
        }
      } catch {
        io.to(`user:${recipientId}`).emit("incoming_call", {
          callerId: userId, callType, channel, callerName, callerAvatar,
        });
      }

      // Push notification for incoming call (background/killed app)
      try {
        const { sendPushNotification } = await import('../utils/pushNotifications');
        sendPushNotification(
          recipientId,
          callerName || 'Incoming Call',
          `${callType === 'video' ? 'Video' : 'Voice'} call`,
          {
            type: 'incoming_call',
            callerId: userId,
            callerName,
            callerAvatar,
            callType,
            channel,
          }
        );
      } catch (_) {}
    });

    socket.on("call_accepted", ({ callerId, channel }: { callerId: string; channel: string }) => {
      io.to(`user:${callerId}`).emit("call_accepted", { channel });
    });

    socket.on("call_declined", ({ callerId }: { callerId: string }) => {
      io.to(`user:${callerId}`).emit("call_declined");
    });

    socket.on("call_ended", ({ recipientId }: { recipientId: string }) => {
      io.to(`user:${recipientId}`).emit("call_ended");
    });

    // ─── request_accepted (broadcast from secondary action) ───
    socket.on("request_accepted", async ({ roomId }: { roomId: string }) => {
      try {
        const room = await prisma.chatRoom.findUnique({ where: { id: roomId } });
        if (room && room.user2Id === userId) {
          // Notify user1 that their request was accepted
          io.to(`user:${room.user1Id}`).emit("request_accepted", { roomId });
        }
      } catch (e) {
        console.error("Socket request_accepted error:", e);
      }
    });

    // ─── disconnect ───
    socket.on("disconnect", async () => {
      try { await (prisma.user as any).update({ where: { id: userId }, data: { lastSeen: new Date() } }); } catch {}
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          try {
            const userPref = await (prisma.user as any).findUnique({ where: { id: userId }, select: { hideOnlineStatus: true } });
            if (!userPref?.hideOnlineStatus) {
              socket.broadcast.emit("user_offline", { userId });
            }
          } catch { socket.broadcast.emit("user_offline", { userId }); }
        }
      }
    });
  });
};

// Helper to check if user is online (for REST endpoints)
// Note: internally checks map only — REST callers (chatController) should also
// check hideOnlineStatus if they want to respect privacy before showing presence.
export const isUserOnline = (userId: string): boolean => {
  return onlineUsers.has(userId) && onlineUsers.get(userId)!.size > 0;
};

// Presence-aware check: returns false if user hides their online status
export const isUserVisiblyOnline = async (userId: string): Promise<boolean> => {
  if (!isUserOnline(userId)) return false;
  try {
    const user = await (prisma.user as any).findUnique({ where: { id: userId }, select: { hideOnlineStatus: true } });
    return !user?.hideOnlineStatus;
  } catch { return true; }
};
