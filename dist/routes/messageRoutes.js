"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const chatController_1 = require("../controllers/chatController");
const storageController_1 = require("../controllers/storageController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// Room management
router.post("/rooms/init", auth_1.authenticateJWT, chatController_1.initiateRoom);
router.get("/rooms", auth_1.authenticateJWT, chatController_1.getRooms);
// Messaging
router.post("/send", auth_1.authenticateJWT, storageController_1.uploadMiddleware.single("file"), chatController_1.sendMessage);
router.get("/chat/:roomId", auth_1.authenticateJWT, chatController_1.getChatHistory);
router.post("/:roomId/seen", auth_1.authenticateJWT, chatController_1.markSeen);
// Message actions
router.delete("/:messageId", auth_1.authenticateJWT, chatController_1.unsendMessage);
router.post("/:messageId/delete-for-me", auth_1.authenticateJWT, chatController_1.deleteForMe);
router.put("/:messageId/edit", auth_1.authenticateJWT, chatController_1.editMessage);
router.post("/:messageId/pin", auth_1.authenticateJWT, chatController_1.pinMessage);
router.post("/:messageId/unpin", auth_1.authenticateJWT, chatController_1.unpinMessage);
// Request management
router.post("/requests/:roomId/accept", auth_1.authenticateJWT, chatController_1.acceptRequest);
router.delete("/requests/:roomId/decline", auth_1.authenticateJWT, chatController_1.declineRequest);
// Block management
router.post("/block/:userId", auth_1.authenticateJWT, chatController_1.blockUser);
router.delete("/block/:userId", auth_1.authenticateJWT, chatController_1.unblockUser);
// Mute
router.post("/rooms/:roomId/mute", auth_1.authenticateJWT, chatController_1.muteChat);
router.get("/rooms/:roomId/mute", auth_1.authenticateJWT, chatController_1.getMuteStatus);
// Delete chat for me
router.post("/rooms/:roomId/delete-for-me", auth_1.authenticateJWT, chatController_1.deleteChatForMe);
// Shared media
router.get("/rooms/:roomId/media", auth_1.authenticateJWT, chatController_1.getSharedMedia);
// Report user
router.post("/report/:userId", auth_1.authenticateJWT, chatController_1.reportUser);
// Reactions
router.post("/:messageId/react", auth_1.authenticateJWT, chatController_1.reactToMessage);
// Vanish mode
router.post("/rooms/:roomId/vanish", auth_1.authenticateJWT, chatController_1.toggleVanishMode);
// Scheduled messages
router.get("/rooms/:roomId/scheduled", auth_1.authenticateJWT, chatController_1.getScheduledMessages);
router.delete("/scheduled/:messageId", auth_1.authenticateJWT, chatController_1.cancelScheduledMessage);
exports.default = router;
