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
const express_1 = require("express");
const chatController_1 = require("../controllers/chatController");
const userController_1 = require("../controllers/userController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.post("/follow", auth_1.authenticateJWT, userController_1.toggleFollow);
router.post("/follow/accept", auth_1.authenticateJWT, userController_1.acceptFollowRequest);
router.post("/follow/decline", auth_1.authenticateJWT, userController_1.declineFollowRequest);
router.get("/follow/requests", auth_1.authenticateJWT, userController_1.getPendingFollowRequests);
router.get("/notifications", auth_1.authenticateJWT, userController_1.getNotifications);
router.post("/notifications/delete", auth_1.authenticateJWT, userController_1.deleteNotification);
router.post("/notifications/read", auth_1.authenticateJWT, userController_1.markNotificationRead);
router.post("/notifications/read-all", auth_1.authenticateJWT, userController_1.markAllNotificationsRead);
router.get("/notifications/unread-count", auth_1.authenticateJWT, userController_1.getUnreadNotificationCount);
router.post("/push-token", auth_1.authenticateJWT, userController_1.updatePushToken);
router.get("/followers/:userId", auth_1.authenticateJWT, userController_1.getFollowers);
router.get("/following/:userId", auth_1.authenticateJWT, userController_1.getFollowing);
router.get("/search", auth_1.authenticateJWT, userController_1.searchUsers);
router.put("/privacy", auth_1.authenticateJWT, userController_1.updateMessagePrivacy);
router.post("/online-status/toggle", auth_1.authenticateJWT, userController_1.toggleOnlineStatus);
router.get("/profile/:targetIdOrUsername", auth_1.authenticateJWT, userController_1.getUserProfile);
router.post("/disappearing-timer", auth_1.authenticateJWT, userController_1.setDisappearingTimer);
router.get("/close-friends", auth_1.authenticateJWT, userController_1.getCloseFriends);
router.put("/close-friends", auth_1.authenticateJWT, userController_1.updateCloseFriends);
router.post("/last-seen", auth_1.authenticateJWT, userController_1.updateLastSeen);
router.get("/blocks", auth_1.authenticateJWT, userController_1.getBlockList);
router.post("/block/:userId", auth_1.authenticateJWT, chatController_1.blockUser);
router.delete("/block/:userId", auth_1.authenticateJWT, chatController_1.unblockUser);
// ─── People You May Know (Suggestions) ───
router.get("/suggestions", auth_1.authenticateJWT, async (req, res) => {
    try {
        const userId = req.user.id;
        const prisma = (await Promise.resolve().then(() => __importStar(require('../config/db')))).default;
        // Get IDs the user already follows
        const following = await prisma.follow.findMany({
            where: { followerId: userId, status: 'accepted' },
            select: { followingId: true },
        });
        const followingIds = following.map(f => f.followingId);
        // Get blocked IDs
        const blocks = await prisma.block.findMany({
            where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
            select: { blockerId: true, blockedId: true },
        });
        const blockedIds = blocks.map(b => b.blockerId === userId ? b.blockedId : b.blockerId);
        const excludeIds = [...followingIds, ...blockedIds, userId];
        // Strategy 1: Mutual connections (people followed by people you follow)
        let mutualSuggestions = [];
        if (followingIds.length > 0) {
            const mutuals = await prisma.follow.findMany({
                where: {
                    followerId: { in: followingIds },
                    followingId: { notIn: excludeIds },
                    status: 'accepted',
                },
                select: { followingId: true },
                take: 50,
            });
            const mutualIds = [...new Set(mutuals.map(m => m.followingId))].slice(0, 10);
            if (mutualIds.length > 0) {
                mutualSuggestions = await prisma.user.findMany({
                    where: { id: { in: mutualIds } },
                    select: { id: true, username: true, displayName: true, profilePicture: true, isVerified: true },
                });
                // Add mutual count
                mutualSuggestions = mutualSuggestions.map((u) => ({
                    ...u,
                    reason: 'mutual',
                    mutualCount: mutuals.filter(m => m.followingId === u.id).length,
                }));
            }
        }
        // Strategy 2: Popular users (most followers)
        const popularUsers = await prisma.user.findMany({
            where: { id: { notIn: [...excludeIds, ...mutualSuggestions.map(s => s.id)] } },
            select: {
                id: true, username: true, displayName: true, profilePicture: true, isVerified: true,
                _count: { select: { followers: true } },
            },
            orderBy: { followers: { _count: 'desc' } },
            take: 5,
        });
        const popularFormatted = popularUsers.map((u) => ({
            id: u.id, username: u.username, displayName: u.displayName,
            profilePicture: u.profilePicture, isVerified: u.isVerified,
            reason: 'popular', followersCount: u._count.followers,
        }));
        // Strategy 3: New users (joined recently)
        const newUsers = await prisma.user.findMany({
            where: {
                id: { notIn: [...excludeIds, ...mutualSuggestions.map(s => s.id), ...popularFormatted.map(s => s.id)] },
                createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
            },
            select: { id: true, username: true, displayName: true, profilePicture: true, isVerified: true },
            take: 5,
            orderBy: { createdAt: 'desc' },
        });
        const newFormatted = newUsers.map((u) => ({ ...u, reason: 'new' }));
        // Combine and shuffle for variety on each refresh
        const all = [...mutualSuggestions, ...popularFormatted, ...newFormatted];
        // Shuffle array
        for (let i = all.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [all[i], all[j]] = [all[j], all[i]];
        }
        const suggestions = all.slice(0, 15);
        res.json(suggestions);
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
exports.default = router;
