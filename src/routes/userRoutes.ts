import { Router } from "express";
import { blockUser, unblockUser } from "../controllers/chatController";
import {
    acceptFollowRequest,
    declineFollowRequest,
    deleteNotification,
    getBlockList,
    getCloseFriends,
    getFollowers,
    getFollowing,
    getNotifications,
    getPendingFollowRequests,
    getUnreadNotificationCount,
    getUserProfile,
    markAllNotificationsRead,
    markNotificationRead,
    searchUsers,
    setDisappearingTimer,
    toggleFollow,
    toggleOnlineStatus,
    updateCloseFriends,
    updateLastSeen,
    updateMessagePrivacy,
    updatePushToken,
} from "../controllers/userController";
import { authenticateJWT } from "../middleware/auth";

const router = Router();

router.post("/follow", authenticateJWT as any, toggleFollow as any);
router.post("/follow/accept", authenticateJWT as any, acceptFollowRequest as any);
router.post("/follow/decline", authenticateJWT as any, declineFollowRequest as any);
router.get("/follow/requests", authenticateJWT as any, getPendingFollowRequests as any);
router.get("/notifications", authenticateJWT as any, getNotifications as any);
router.post("/notifications/delete", authenticateJWT as any, deleteNotification as any);
router.post("/notifications/read", authenticateJWT as any, markNotificationRead as any);
router.post("/notifications/read-all", authenticateJWT as any, markAllNotificationsRead as any);
router.get("/notifications/unread-count", authenticateJWT as any, getUnreadNotificationCount as any);
router.post("/push-token", authenticateJWT as any, updatePushToken as any);
router.get("/followers/:userId", authenticateJWT as any, getFollowers as any);
router.get("/following/:userId", authenticateJWT as any, getFollowing as any);
router.get("/search", authenticateJWT as any, searchUsers as any);
router.put("/privacy", authenticateJWT as any, updateMessagePrivacy as any);
router.post("/online-status/toggle", authenticateJWT as any, toggleOnlineStatus as any);
router.get("/profile/:targetIdOrUsername", authenticateJWT as any, getUserProfile as any);
router.post("/disappearing-timer", authenticateJWT as any, setDisappearingTimer as any);
router.get("/close-friends", authenticateJWT as any, getCloseFriends as any);
router.put("/close-friends", authenticateJWT as any, updateCloseFriends as any);
router.post("/last-seen", authenticateJWT as any, updateLastSeen as any);
router.get("/blocks", authenticateJWT as any, getBlockList as any);
router.post("/block/:userId", authenticateJWT as any, blockUser as any);
router.delete("/block/:userId", authenticateJWT as any, unblockUser as any);

// ─── People You May Know (Suggestions) ───
router.get("/suggestions", authenticateJWT as any, async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const prisma = (await import('../config/db')).default;

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
    let mutualSuggestions: any[] = [];
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
        mutualSuggestions = mutualSuggestions.map((u: any) => ({
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

    const popularFormatted = popularUsers.map((u: any) => ({
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

    const newFormatted = newUsers.map((u: any) => ({ ...u, reason: 'new' }));

    // Combine and shuffle for variety on each refresh
    const all = [...mutualSuggestions, ...popularFormatted, ...newFormatted];
    // Shuffle array
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    const suggestions = all.slice(0, 15);

    res.json(suggestions);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;