import { Router } from "express";
import {
    acceptRequest,
    blockUser,
    cancelScheduledMessage,
    declineRequest,
    deleteChatForMe,
    deleteForMe,
    editMessage,
    getChatHistory,
    getMuteStatus,
    getRooms,
    getScheduledMessages,
    getSharedMedia,
    initiateRoom,
    markSeen,
    muteChat,
    pinMessage,
    reactToMessage,
    reportUser,
    sendMessage,
    toggleVanishMode,
    unblockUser,
    unpinMessage,
    unsendMessage,
} from "../controllers/chatController";
import { uploadMiddleware } from "../controllers/storageController";
import { authenticateJWT } from "../middleware/auth";

const router = Router();

// Room management
router.post("/rooms/init", authenticateJWT as any, initiateRoom as any);
router.get("/rooms", authenticateJWT as any, getRooms as any);

// Messaging
router.post("/send", authenticateJWT as any, uploadMiddleware.single("file") as any, sendMessage as any);
router.get("/chat/:roomId", authenticateJWT as any, getChatHistory as any);
router.post("/:roomId/seen", authenticateJWT as any, markSeen as any);

// Message actions
router.delete("/:messageId", authenticateJWT as any, unsendMessage as any);
router.post("/:messageId/delete-for-me", authenticateJWT as any, deleteForMe as any);
router.put("/:messageId/edit", authenticateJWT as any, editMessage as any);
router.post("/:messageId/pin", authenticateJWT as any, pinMessage as any);
router.post("/:messageId/unpin", authenticateJWT as any, unpinMessage as any);

// Request management
router.post("/requests/:roomId/accept", authenticateJWT as any, acceptRequest as any);
router.delete("/requests/:roomId/decline", authenticateJWT as any, declineRequest as any);

// Block management
router.post("/block/:userId", authenticateJWT as any, blockUser as any);
router.delete("/block/:userId", authenticateJWT as any, unblockUser as any);

// Mute
router.post("/rooms/:roomId/mute", authenticateJWT as any, muteChat as any);
router.get("/rooms/:roomId/mute", authenticateJWT as any, getMuteStatus as any);

// Delete chat for me
router.post("/rooms/:roomId/delete-for-me", authenticateJWT as any, deleteChatForMe as any);

// Shared media
router.get("/rooms/:roomId/media", authenticateJWT as any, getSharedMedia as any);

// Report user
router.post("/report/:userId", authenticateJWT as any, reportUser as any);

// Reactions
router.post("/:messageId/react", authenticateJWT as any, reactToMessage as any);

// Vanish mode
router.post("/rooms/:roomId/vanish", authenticateJWT as any, toggleVanishMode as any);

// Scheduled messages
router.get("/rooms/:roomId/scheduled", authenticateJWT as any, getScheduledMessages as any);
router.delete("/scheduled/:messageId", authenticateJWT as any, cancelScheduledMessage as any);

export default router;
