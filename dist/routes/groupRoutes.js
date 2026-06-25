"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const groupController_1 = require("../controllers/groupController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// Get my groups
router.get("/", auth_1.authenticateJWT, groupController_1.getMyGroups);
// Create group
router.post("/", auth_1.authenticateJWT, groupController_1.createGroup);
// Get group details
router.get("/:id", auth_1.authenticateJWT, groupController_1.getGroup);
// Update group
router.put("/:id", auth_1.authenticateJWT, groupController_1.updateGroup);
// Send message to group
router.post("/:id/messages", auth_1.authenticateJWT, groupController_1.sendGroupMessage);
// Get group messages
router.get("/:id/messages", auth_1.authenticateJWT, groupController_1.getGroupMessages);
// React to group message
router.post("/messages/:messageId/react", auth_1.authenticateJWT, groupController_1.reactToGroupMessage);
// Remove group message reaction
router.delete("/messages/:messageId/react", auth_1.authenticateJWT, groupController_1.removeGroupMessageReaction);
// Edit group message
router.post("/messages/:messageId/edit", auth_1.authenticateJWT, groupController_1.editGroupMessage);
// Delete group message for me
router.post("/messages/:messageId/delete-for-me", auth_1.authenticateJWT, groupController_1.deleteGroupMessageForMe);
// Unsend group message
router.post("/messages/:messageId/unsend", auth_1.authenticateJWT, groupController_1.unsendGroupMessage);
// Pin group message
router.post("/messages/:messageId/pin", auth_1.authenticateJWT, groupController_1.pinGroupMessage);
// Unpin group message
router.post("/messages/:messageId/unpin", auth_1.authenticateJWT, groupController_1.unpinGroupMessage);
// Add members
router.post("/:id/members", auth_1.authenticateJWT, groupController_1.addGroupMember);
// Remove member
router.delete("/:id/members", auth_1.authenticateJWT, groupController_1.removeGroupMember);
// Leave group
router.post("/:id/leave", auth_1.authenticateJWT, groupController_1.leaveGroup);
// Delete group
router.delete("/:id", auth_1.authenticateJWT, groupController_1.deleteGroup);
// Polls
router.get("/:id/polls", auth_1.authenticateJWT, groupController_1.getPolls);
router.post("/:id/polls", auth_1.authenticateJWT, groupController_1.createPoll);
router.post("/polls/:pollId/vote", auth_1.authenticateJWT, groupController_1.votePoll);
exports.default = router;
