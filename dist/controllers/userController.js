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
exports.updateMessagePrivacy = exports.getBlockList = exports.updateLastSeen = exports.updateCloseFriends = exports.getCloseFriends = exports.setDisappearingTimer = exports.toggleOnlineStatus = exports.updatePushToken = exports.getUnreadNotificationCount = exports.markAllNotificationsRead = exports.markNotificationRead = exports.deleteNotification = exports.getNotifications = exports.getUserProfile = exports.searchUsers = exports.getFollowing = exports.getFollowers = exports.declineFollowRequest = exports.getPendingFollowRequests = exports.acceptFollowRequest = exports.toggleFollow = void 0;
const db_1 = require("../db");
// Toggle follow/unfollow a user
const toggleFollow = async (req, res) => {
    try {
        const followerId = req.user.id;
        const { followingId } = req.body;
        if (!followingId) {
            return res.status(400).json({ error: "followingId is required" });
        }
        if (followerId === followingId) {
            return res.status(400).json({ error: "You cannot follow yourself" });
        }
        const targetUser = await db_1.prisma.user.findUnique({
            where: { id: followingId },
        });
        if (!targetUser) {
            return res.status(404).json({ error: "Target user not found" });
        }
        const existingFollow = await db_1.prisma.follow.findUnique({
            where: {
                followerId_followingId: {
                    followerId,
                    followingId,
                },
            },
        });
        if (existingFollow) {
            await db_1.prisma.follow.delete({
                where: {
                    followerId_followingId: {
                        followerId,
                        followingId,
                    },
                },
            });
            return res.json({ followed: false, message: "Unfollowed successfully" });
        }
        else {
            const status = targetUser.isPrivate ? "pending" : "accepted";
            await db_1.prisma.follow.create({
                data: {
                    followerId,
                    followingId,
                    status,
                },
            });
            // Create follow notification for public accounts
            if (status === "accepted") {
                try {
                    await db_1.prisma.notification.create({
                        data: {
                            userId: followingId,
                            senderId: followerId,
                            type: "follow",
                            text: "started following you",
                        },
                    });
                    const { sendPushNotification } = await Promise.resolve().then(() => __importStar(require('../utils/pushNotifications')));
                    const sender = await db_1.prisma.user.findUnique({ where: { id: followerId }, select: { username: true, displayName: true, profilePicture: true } });
                    sendPushNotification(followingId, sender?.displayName || sender?.username || 'Someone', 'started following you', { type: 'follow', senderId: followerId, senderName: sender?.displayName || sender?.username, senderAvatar: sender?.profilePicture });
                }
                catch (notifErr) {
                    console.error("Failed to create follow notification:", notifErr);
                }
            }
            return res.json({
                followed: true,
                status,
                message: status === "pending" ? "Follow request sent" : "Followed successfully"
            });
        }
    }
    catch (e) {
        console.error("Toggle Follow Error:", e);
        res.status(500).json({ error: e.message || "Failed to toggle follow status" });
    }
};
exports.toggleFollow = toggleFollow;
// Accept follower request (for private accounts)
const acceptFollowRequest = async (req, res) => {
    try {
        const userId = req.user.id;
        const { followerId } = req.body;
        if (!followerId) {
            return res.status(400).json({ error: "followerId is required" });
        }
        const follow = await db_1.prisma.follow.findUnique({
            where: {
                followerId_followingId: {
                    followerId,
                    followingId: userId,
                },
            },
        });
        if (!follow) {
            return res.status(404).json({ error: "Follow request not found" });
        }
        await db_1.prisma.follow.update({
            where: {
                followerId_followingId: {
                    followerId,
                    followingId: userId,
                },
            },
            data: {
                status: "accepted",
            },
        });
        try {
            await db_1.prisma.notification.create({
                data: {
                    userId: follow.followerId,
                    senderId: userId,
                    type: "follow_accepted",
                    text: "accepted your follow request",
                },
            });
            const { sendPushNotification } = await Promise.resolve().then(() => __importStar(require('../utils/pushNotifications')));
            const sender = await db_1.prisma.user.findUnique({ where: { id: userId }, select: { username: true, displayName: true, profilePicture: true } });
            sendPushNotification(follow.followerId, sender?.displayName || sender?.username || 'Someone', 'accepted your follow request', { type: 'follow_accepted', senderId: userId, senderName: sender?.displayName || sender?.username, senderAvatar: sender?.profilePicture });
        }
        catch (notifErr) {
            console.error("Failed to create follow acceptance notification:", notifErr);
        }
        res.json({ success: true, message: "Follow request accepted" });
    }
    catch (e) {
        console.error("Accept Follow Request Error:", e);
        res.status(500).json({ error: e.message || "Failed to accept follow request" });
    }
};
exports.acceptFollowRequest = acceptFollowRequest;
// Retrieve pending follow requests
const getPendingFollowRequests = async (req, res) => {
    try {
        const userId = req.user.id;
        const requests = await db_1.prisma.follow.findMany({
            where: {
                followingId: userId,
                status: "pending",
            },
            include: {
                follower: {
                    select: {
                        id: true,
                        username: true,
                        displayName: true,
                        profilePicture: true,
                        bio: true,
                    },
                },
            },
        });
        res.json(requests.map(r => r.follower));
    }
    catch (e) {
        console.error("Get Pending Follow Requests Error:", e);
        res.status(500).json({ error: e.message || "Failed to retrieve pending follow requests" });
    }
};
exports.getPendingFollowRequests = getPendingFollowRequests;
// Decline / Reject follower request (for private accounts)
const declineFollowRequest = async (req, res) => {
    try {
        const userId = req.user.id;
        const { followerId } = req.body;
        if (!followerId) {
            return res.status(400).json({ error: "followerId is required" });
        }
        const follow = await db_1.prisma.follow.findUnique({
            where: {
                followerId_followingId: {
                    followerId,
                    followingId: userId,
                },
            },
        });
        if (!follow) {
            return res.status(404).json({ error: "Follow request not found" });
        }
        await db_1.prisma.follow.delete({
            where: {
                followerId_followingId: {
                    followerId,
                    followingId: userId,
                },
            },
        });
        res.json({ success: true, message: "Follow request declined" });
    }
    catch (e) {
        console.error("Decline Follow Request Error:", e);
        res.status(500).json({ error: e.message || "Failed to decline follow request" });
    }
};
exports.declineFollowRequest = declineFollowRequest;
// Retrieve followers list
const getFollowers = async (req, res) => {
    try {
        const { userId } = req.params;
        const requesterId = req.user.id;
        // Get all blocked IDs (both directions) for the requester
        const blocks = await db_1.prisma.block.findMany({
            where: { OR: [{ blockerId: requesterId }, { blockedId: requesterId }] },
            select: { blockerId: true, blockedId: true },
        });
        const blockedIds = blocks.map(b => b.blockerId === requesterId ? b.blockedId : b.blockerId);
        const followers = await db_1.prisma.follow.findMany({
            where: {
                followingId: userId,
                status: "accepted",
                followerId: { notIn: blockedIds },
            },
            include: {
                follower: {
                    select: {
                        id: true,
                        username: true,
                        displayName: true,
                        profilePicture: true,
                        bio: true,
                    },
                },
            },
        });
        res.json(followers.map(f => f.follower));
    }
    catch (e) {
        console.error("Get Followers Error:", e);
        res.status(500).json({ error: e.message || "Failed to retrieve followers list" });
    }
};
exports.getFollowers = getFollowers;
// Retrieve following list
const getFollowing = async (req, res) => {
    try {
        const { userId } = req.params;
        const requesterId = req.user.id;
        // Get all blocked IDs (both directions) for the requester
        const blocks = await db_1.prisma.block.findMany({
            where: { OR: [{ blockerId: requesterId }, { blockedId: requesterId }] },
            select: { blockerId: true, blockedId: true },
        });
        const blockedIds = blocks.map(b => b.blockerId === requesterId ? b.blockedId : b.blockerId);
        const following = await db_1.prisma.follow.findMany({
            where: {
                followerId: userId,
                status: "accepted",
                followingId: { notIn: blockedIds },
            },
            include: {
                following: {
                    select: {
                        id: true,
                        username: true,
                        displayName: true,
                        profilePicture: true,
                        bio: true,
                    },
                },
            },
        });
        res.json(following.map(f => f.following));
    }
    catch (e) {
        console.error("Get Following Error:", e);
        res.status(500).json({ error: e.message || "Failed to retrieve following list" });
    }
};
exports.getFollowing = getFollowing;
// Search users by query string
const searchUsers = async (req, res) => {
    try {
        const { q } = req.query;
        const loggedInUserId = req.user.id;
        if (!q) {
            return res.json([]);
        }
        // Get IDs that are blocked in either direction
        const blocks = await db_1.prisma.block.findMany({
            where: {
                OR: [
                    { blockerId: loggedInUserId },
                    { blockedId: loggedInUserId },
                ],
            },
            select: { blockerId: true, blockedId: true },
        });
        const blockedIds = blocks.map(b => b.blockerId === loggedInUserId ? b.blockedId : b.blockerId);
        const users = await db_1.prisma.user.findMany({
            where: {
                AND: [
                    {
                        OR: [
                            { username: { contains: q, mode: "insensitive" } },
                            { displayName: { contains: q, mode: "insensitive" } },
                        ],
                    },
                    { id: { notIn: [...blockedIds, loggedInUserId] } },
                ],
            },
            select: {
                id: true,
                username: true,
                displayName: true,
                profilePicture: true,
                bio: true,
                isVerified: true,
            },
            take: 20,
        });
        res.json(users);
    }
    catch (e) {
        console.error("Search Users Error:", e);
        res.status(500).json({ error: e.message || "Failed to perform user search" });
    }
};
exports.searchUsers = searchUsers;
// Get User Profile with details and follow status relative to logged-in user
const getUserProfile = async (req, res) => {
    try {
        const loggedInUserId = req.user.id;
        const { targetIdOrUsername } = req.params;
        // Try finding by username first, then by UUID id
        let user = await db_1.prisma.user.findFirst({
            where: {
                OR: [
                    { username: targetIdOrUsername },
                    { id: targetIdOrUsername },
                ],
            },
        });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        // Fetch counts
        const postsCount = await db_1.prisma.post.count({
            where: { userId: user.id },
        });
        const followersCount = await db_1.prisma.follow.count({
            where: { followingId: user.id, status: "accepted" },
        });
        const followingCount = await db_1.prisma.follow.count({
            where: { followerId: user.id, status: "accepted" },
        });
        // Check relationship from logged-in user to this user
        let followStatus = null; // null = not following
        let isBlocked = false; // current user blocked target
        let isBlockedBy = false; // target blocked current user
        if (loggedInUserId !== user.id) {
            const [follow, blockByMe, blockByThem] = await Promise.all([
                db_1.prisma.follow.findUnique({
                    where: {
                        followerId_followingId: {
                            followerId: loggedInUserId,
                            followingId: user.id,
                        },
                    },
                }),
                db_1.prisma.block.findUnique({
                    where: { blockerId_blockedId: { blockerId: loggedInUserId, blockedId: user.id } },
                }),
                db_1.prisma.block.findUnique({
                    where: { blockerId_blockedId: { blockerId: user.id, blockedId: loggedInUserId } },
                }),
            ]);
            if (follow) {
                followStatus = follow.status; // "pending" or "accepted"
            }
            isBlocked = !!blockByMe;
            isBlockedBy = !!blockByThem;
        }
        // If this user has blocked the requester, return almost nothing
        if (isBlockedBy) {
            return res.json({
                id: user.id,
                username: user.username,
                displayName: user.displayName || user.username,
                profilePicture: null,
                bio: null,
                isPrivate: true,
                isVerified: false,
                isOwnProfile: false,
                isBlocked: false,
                isBlockedBy: true,
                followStatus: null,
                stats: { posts: 0, followers: 0, following: 0 },
            });
        }
        res.json({
            id: user.id,
            username: user.username,
            displayName: user.displayName || user.username,
            profilePicture: user.profilePicture,
            bio: user.bio,
            gender: user.gender,
            isPrivate: user.isPrivate,
            isVerified: user.isVerified,
            lastSeen: user.lastSeen,
            hideOnlineStatus: user.hideOnlineStatus,
            createdAt: user.createdAt,
            stats: {
                posts: postsCount,
                followers: followersCount,
                following: followingCount,
            },
            followStatus, // null, "pending", or "accepted"
            isOwnProfile: loggedInUserId === user.id,
            isBlocked, // current user has blocked this profile
            isBlockedBy, // this profile has blocked current user
        });
    }
    catch (e) {
        console.error("Get User Profile Error:", e);
        res.status(500).json({ error: e.message || "Failed to retrieve user profile" });
    }
};
exports.getUserProfile = getUserProfile;
// Retrieve notifications for the logged-in user
const getNotifications = async (req, res) => {
    try {
        const userId = req.user.id;
        const notifications = await db_1.prisma.notification.findMany({
            where: {
                userId,
            },
            orderBy: {
                createdAt: "desc",
            },
            take: 50,
        });
        // Fetch sender details for each notification
        const senderIds = Array.from(new Set(notifications.map((n) => n.senderId)));
        const senders = await db_1.prisma.user.findMany({
            where: {
                id: { in: senderIds },
            },
            select: {
                id: true,
                username: true,
                displayName: true,
                profilePicture: true,
            },
        });
        const senderMap = new Map(senders.map(s => [s.id, s]));
        const result = notifications.map((n) => {
            const sender = senderMap.get(n.senderId);
            return {
                id: n.id,
                userId: n.userId,
                senderId: n.senderId,
                type: n.type,
                text: n.text || "interacted with your profile",
                postId: n.postId,
                storyId: n.storyId,
                createdAt: n.createdAt,
                isRead: n.isRead,
                itemType: 'notification', // Format for UI Activity List compat
                user: {
                    username: sender?.username || "user",
                    profilePicture: sender?.profilePicture || "https://via.placeholder.com/150",
                    displayName: sender?.displayName || sender?.username || "User",
                },
            };
        });
        res.json(result);
    }
    catch (e) {
        console.error("Get Notifications Error:", e);
        res.status(500).json({ error: e.message || "Failed to retrieve notifications" });
    }
};
exports.getNotifications = getNotifications;
// Delete notification for the logged-in user
const deleteNotification = async (req, res) => {
    try {
        const userId = req.user.id;
        const { notificationId } = req.body;
        if (!notificationId) {
            return res.status(400).json({ error: "notificationId is required" });
        }
        await db_1.prisma.notification.deleteMany({
            where: {
                id: notificationId,
                userId,
            },
        });
        res.json({ success: true, message: "Notification deleted" });
    }
    catch (e) {
        console.error("Delete Notification Error:", e);
        res.status(500).json({ error: e.message || "Failed to delete notification" });
    }
};
exports.deleteNotification = deleteNotification;
// Mark a single notification as read
const markNotificationRead = async (req, res) => {
    try {
        const userId = req.user.id;
        const { notificationId } = req.body;
        await db_1.prisma.notification.updateMany({
            where: { id: notificationId, userId },
            data: { isRead: true },
        });
        res.json({ success: true });
    }
    catch (e) {
        console.error("Mark Notification Read Error:", e);
        res.status(500).json({ error: e.message || "Failed to mark notification as read" });
    }
};
exports.markNotificationRead = markNotificationRead;
// Mark all notifications as read
const markAllNotificationsRead = async (req, res) => {
    try {
        await db_1.prisma.notification.updateMany({
            where: { userId: req.user.id, isRead: false },
            data: { isRead: true },
        });
        res.json({ success: true });
    }
    catch (e) {
        console.error("Mark All Notifications Read Error:", e);
        res.status(500).json({ error: e.message || "Failed to mark all notifications as read" });
    }
};
exports.markAllNotificationsRead = markAllNotificationsRead;
// Get unread notification count
const getUnreadNotificationCount = async (req, res) => {
    try {
        const count = await db_1.prisma.notification.count({
            where: { userId: req.user.id, isRead: false },
        });
        res.json({ count });
    }
    catch (e) {
        console.error("Get Unread Count Error:", e);
        res.status(500).json({ error: e.message || "Failed to get unread count" });
    }
};
exports.getUnreadNotificationCount = getUnreadNotificationCount;
// Update push token
const updatePushToken = async (req, res) => {
    try {
        const { pushToken } = req.body;
        if (!pushToken) {
            return res.status(400).json({ error: "pushToken is required" });
        }
        await db_1.prisma.user.update({
            where: { id: req.user.id },
            data: { pushToken },
        });
        res.json({ success: true });
    }
    catch (e) {
        console.error("Update Push Token Error:", e);
        res.status(500).json({ error: e.message || "Failed to update push token" });
    }
};
exports.updatePushToken = updatePushToken;
// Toggle hide online status
const toggleOnlineStatus = async (req, res) => {
    try {
        const user = await db_1.prisma.user.findUnique({ where: { id: req.user.id }, select: { hideOnlineStatus: true } });
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        const updated = await db_1.prisma.user.update({
            where: { id: req.user.id },
            data: { hideOnlineStatus: !user.hideOnlineStatus },
            select: { hideOnlineStatus: true },
        });
        res.json({ hideOnlineStatus: updated.hideOnlineStatus });
    }
    catch (e) {
        console.error('Toggle online status error:', e);
        res.status(500).json({ error: e.message || 'Failed to toggle online status' });
    }
};
exports.toggleOnlineStatus = toggleOnlineStatus;
// ─── Disappearing messages timer ───
const setDisappearingTimer = async (req, res) => {
    try {
        const { timer } = req.body; // null | "24h" | "7d"
        if (timer !== null && !['24h', '7d'].includes(timer)) {
            return res.status(400).json({ error: 'Invalid timer value' });
        }
        const updated = await db_1.prisma.user.update({
            where: { id: req.user.id },
            data: { disappearingMsgTimer: timer },
            select: { disappearingMsgTimer: true },
        });
        res.json(updated);
    }
    catch (e) {
        res.status(500).json({ error: e.message || 'Failed to set timer' });
    }
};
exports.setDisappearingTimer = setDisappearingTimer;
// ─── Close friends ───
const getCloseFriends = async (req, res) => {
    try {
        const user = await db_1.prisma.user.findUnique({
            where: { id: req.user.id },
            select: { closeFriends: true },
        });
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        const friends = await db_1.prisma.user.findMany({
            where: { id: { in: user.closeFriends } },
            select: { id: true, username: true, displayName: true, profilePicture: true },
        });
        res.json(friends);
    }
    catch (e) {
        res.status(500).json({ error: e.message || 'Failed to get close friends' });
    }
};
exports.getCloseFriends = getCloseFriends;
const updateCloseFriends = async (req, res) => {
    try {
        const { closeFriends } = req.body; // string[]
        if (!Array.isArray(closeFriends))
            return res.status(400).json({ error: 'closeFriends must be an array' });
        await db_1.prisma.user.update({
            where: { id: req.user.id },
            data: { closeFriends },
        });
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ error: e.message || 'Failed to update close friends' });
    }
};
exports.updateCloseFriends = updateCloseFriends;
// ─── Update lastSeen ───
const updateLastSeen = async (req, res) => {
    try {
        await db_1.prisma.user.update({
            where: { id: req.user.id },
            data: { lastSeen: new Date() },
        });
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ error: e.message || 'Failed to update last seen' });
    }
};
exports.updateLastSeen = updateLastSeen;
// ─── Block list ───
const getBlockList = async (req, res) => {
    try {
        const blocks = await db_1.prisma.block.findMany({
            where: { blockerId: req.user.id },
            include: {
                blocked: { select: { id: true, username: true, displayName: true, profilePicture: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json(blocks.map((b) => b.blocked));
    }
    catch (e) {
        res.status(500).json({ error: e.message || 'Failed to get block list' });
    }
};
exports.getBlockList = getBlockList;
// Update message privacy setting
const updateMessagePrivacy = async (req, res) => {
    try {
        const { privacy } = req.body;
        if (!privacy || !['EVERYONE', 'FOLLOWERS'].includes(privacy)) {
            return res.status(400).json({ error: "Invalid privacy setting. Must be EVERYONE or FOLLOWERS." });
        }
        await db_1.prisma.user.update({
            where: { id: req.user.id },
            data: { messagePrivacy: privacy },
        });
        res.json({ success: true, message: `Message privacy updated to ${privacy}` });
    }
    catch (e) {
        console.error("Update Message Privacy Error:", e);
        res.status(500).json({ error: e.message || "Failed to update message privacy" });
    }
};
exports.updateMessagePrivacy = updateMessagePrivacy;
