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

export default router;