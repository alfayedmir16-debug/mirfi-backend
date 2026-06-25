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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isUserVisiblyOnline = exports.isUserOnline = exports.setupSocket = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = __importDefault(require("../config/db"));
const onlineUsers = new Map(); // userId → Set<socketId>
const setupSocket = (io) => {
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (!token)
            return next(new Error("No token provided"));
        try {
            const user = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET || "mirfi_super_secret_jwt_token_2026_key_abc123");
            socket.user = user;
            next();
        }
        catch {
            next(new Error("Invalid token"));
        }
    });
    io.on("connection", async (socket) => {
        const userId = socket.user.id;
        // Track online (always track internally, but respect hideOnlineStatus for broadcasts)
        if (!onlineUsers.has(userId))
            onlineUsers.set(userId, new Set());
        onlineUsers.get(userId).add(socket.id);
        // Join personal room
        socket.join(`user:${userId}`);
        // Update lastSeen on connect
        try {
            await db_1.default.user.update({ where: { id: userId }, data: { lastSeen: new Date() } });
        }
        catch { }
        // Broadcast online only if user hasn't hidden their status
        try {
            const userPref = await db_1.default.user.findUnique({ where: { id: userId }, select: { hideOnlineStatus: true } });
            if (!userPref?.hideOnlineStatus) {
                socket.broadcast.emit("user_online", { userId });
            }
        }
        catch {
            socket.broadcast.emit("user_online", { userId });
        }
        // ─── send_message ───
        socket.on("send_message", async (data) => {
            try {
                const message = await db_1.default.message.create({
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
                const room = await db_1.default.chatRoom.findUnique({ where: { id: data.roomId } });
                if (room) {
                    const recipientId = room.user1Id === userId ? room.user2Id : room.user1Id;
                    // Update room timestamp
                    await db_1.default.chatRoom.update({ where: { id: data.roomId }, data: { updatedAt: new Date() } });
                    // If recipient online → push real-time + DELIVERED
                    if (onlineUsers.has(recipientId)) {
                        io.to(`user:${recipientId}`).emit("new_message", message);
                        await db_1.default.message.update({ where: { id: message.id }, data: { status: "DELIVERED" } });
                        io.to(`user:${userId}`).emit("message_delivered", { messageId: message.id });
                    }
                    // Notification + push for offline (skip if messages muted)
                    try {
                        const roomForMute = await db_1.default.chatRoom.findUnique({ where: { id: data.roomId }, select: { mutedMessages: true } });
                        const isMsgMuted = roomForMute?.mutedMessages?.includes(recipientId);
                        const msgType = data.type === "post_share" ? "shared a post" : data.type === "reel_share" ? "shared a reel" : data.mediaUrl ? "sent an image" : data.text ? `"${data.text.substring(0, 60)}${data.text.length > 60 ? "..." : ""}"` : "sent a message";
                        await db_1.default.notification.create({
                            data: { userId: recipientId, senderId: userId, type: "message", text: msgType },
                        });
                        if (!isMsgMuted) {
                            const { sendPushNotification } = await Promise.resolve().then(() => __importStar(require("./pushNotifications")));
                            const sender = await db_1.default.user.findUnique({ where: { id: userId }, select: { username: true } });
                            if (sender) {
                                sendPushNotification(recipientId, sender.username, msgType, { type: "message", senderId: userId });
                            }
                        }
                    }
                    catch (_) { }
                }
                socket.emit("message_sent", message);
            }
            catch (e) {
                console.error("Socket send_message error:", e);
                socket.emit("message_error", { error: "Failed to send message" });
            }
        });
        // ─── typing ───
        socket.on("typing_start", async ({ roomId }) => {
            const room = await db_1.default.chatRoom.findUnique({ where: { id: roomId } });
            if (room) {
                const recipientId = room.user1Id === userId ? room.user2Id : room.user1Id;
                io.to(`user:${recipientId}`).emit("user_typing", { roomId, userId, isTyping: true });
            }
        });
        socket.on("typing_stop", async ({ roomId }) => {
            const room = await db_1.default.chatRoom.findUnique({ where: { id: roomId } });
            if (room) {
                const recipientId = room.user1Id === userId ? room.user2Id : room.user1Id;
                io.to(`user:${recipientId}`).emit("user_typing", { roomId, userId, isTyping: false });
            }
        });
        // ─── mark_seen ───
        socket.on("mark_seen", async ({ roomId }) => {
            try {
                await db_1.default.message.updateMany({
                    where: { roomId, senderId: { not: userId }, status: { not: "SEEN" } },
                    data: { status: "SEEN" },
                });
                // Vanish messages: stamp seenAt and broadcast removal so both UIs hide them
                const vanishMsgs = await db_1.default.message.findMany({
                    where: { roomId, senderId: { not: userId }, isVanish: true, seenAt: null },
                    select: { id: true, senderId: true },
                });
                if (vanishMsgs.length > 0) {
                    await db_1.default.message.updateMany({
                        where: { id: { in: vanishMsgs.map((m) => m.id) } },
                        data: { seenAt: new Date() },
                    });
                    // Notify both sides — give a small delay so recipient briefly sees content
                    setTimeout(() => {
                        vanishMsgs.forEach((m) => {
                            io.to(`user:${userId}`).emit("message_removed", { messageId: m.id });
                            io.to(`user:${m.senderId}`).emit("message_removed", { messageId: m.id });
                        });
                    }, 5000);
                }
                io.to(`room:${roomId}`).emit("messages_seen", { roomId, seenBy: userId });
            }
            catch (e) {
                console.error("Socket mark_seen error:", e);
            }
        });
        // ─── unsend_message ───
        socket.on("unsend_message", async ({ messageId }) => {
            try {
                const msg = await db_1.default.message.findUnique({ where: { id: messageId } });
                if (!msg || msg.senderId !== userId)
                    return;
                await db_1.default.message.delete({ where: { id: messageId } });
                const room = await db_1.default.chatRoom.findUnique({ where: { id: msg.roomId } });
                if (room) {
                    const recipientId = room.user1Id === userId ? room.user2Id : room.user1Id;
                    io.to(`user:${userId}`).emit("message_removed", { messageId });
                    io.to(`user:${recipientId}`).emit("message_removed", { messageId });
                }
            }
            catch (e) {
                console.error("Socket unsend_message error:", e);
            }
        });
        // ─── call signaling ───
        socket.on("call_user", async ({ recipientId, callType, channel, callerName, callerAvatar }) => {
            try {
                // Find the room between caller and recipient to check mute
                const room = await db_1.default.chatRoom.findFirst({
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
            }
            catch {
                io.to(`user:${recipientId}`).emit("incoming_call", {
                    callerId: userId, callType, channel, callerName, callerAvatar,
                });
            }
            // Push notification for incoming call (background/killed app)
            try {
                const { sendPushNotification } = await Promise.resolve().then(() => __importStar(require('../utils/pushNotifications')));
                sendPushNotification(recipientId, callerName || 'Incoming Call', `${callType === 'video' ? 'Video' : 'Voice'} call`, {
                    type: 'incoming_call',
                    callerId: userId,
                    callerName,
                    callerAvatar,
                    callType,
                    channel,
                });
            }
            catch (_) { }
        });
        socket.on("call_accepted", ({ callerId, channel }) => {
            io.to(`user:${callerId}`).emit("call_accepted", { channel });
        });
        socket.on("call_declined", ({ callerId }) => {
            io.to(`user:${callerId}`).emit("call_declined");
        });
        socket.on("call_ended", ({ recipientId }) => {
            io.to(`user:${recipientId}`).emit("call_ended");
        });
        // ─── request_accepted (broadcast from secondary action) ───
        socket.on("request_accepted", async ({ roomId }) => {
            try {
                const room = await db_1.default.chatRoom.findUnique({ where: { id: roomId } });
                if (room && room.user2Id === userId) {
                    // Notify user1 that their request was accepted
                    io.to(`user:${room.user1Id}`).emit("request_accepted", { roomId });
                }
            }
            catch (e) {
                console.error("Socket request_accepted error:", e);
            }
        });
        // ─── disconnect ───
        socket.on("disconnect", async () => {
            try {
                await db_1.default.user.update({ where: { id: userId }, data: { lastSeen: new Date() } });
            }
            catch { }
            const sockets = onlineUsers.get(userId);
            if (sockets) {
                sockets.delete(socket.id);
                if (sockets.size === 0) {
                    onlineUsers.delete(userId);
                    try {
                        const userPref = await db_1.default.user.findUnique({ where: { id: userId }, select: { hideOnlineStatus: true } });
                        if (!userPref?.hideOnlineStatus) {
                            socket.broadcast.emit("user_offline", { userId });
                        }
                    }
                    catch {
                        socket.broadcast.emit("user_offline", { userId });
                    }
                }
            }
        });
    });
};
exports.setupSocket = setupSocket;
// Helper to check if user is online (for REST endpoints)
// Note: internally checks map only — REST callers (chatController) should also
// check hideOnlineStatus if they want to respect privacy before showing presence.
const isUserOnline = (userId) => {
    return onlineUsers.has(userId) && onlineUsers.get(userId).size > 0;
};
exports.isUserOnline = isUserOnline;
// Presence-aware check: returns false if user hides their online status
const isUserVisiblyOnline = async (userId) => {
    if (!(0, exports.isUserOnline)(userId))
        return false;
    try {
        const user = await db_1.default.user.findUnique({ where: { id: userId }, select: { hideOnlineStatus: true } });
        return !user?.hideOnlineStatus;
    }
    catch {
        return true;
    }
};
exports.isUserVisiblyOnline = isUserVisiblyOnline;
