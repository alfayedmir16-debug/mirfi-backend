import { Router } from "express";
import {
    addGroupMember,
    createGroup,
    createPoll,
    deleteGroup,
    deleteGroupMessageForMe,
    editGroupMessage,
    getGroup,
    getGroupMessages,
    getMyGroups,
    getPolls,
    leaveGroup,
    pinGroupMessage,
    reactToGroupMessage,
    removeGroupMember,
    removeGroupMessageReaction,
    sendGroupMessage,
    unpinGroupMessage,
    unsendGroupMessage,
    updateGroup,
    votePoll
} from "../controllers/groupController";
import { authenticateJWT } from "../middleware/auth";

const router = Router();

// Get my groups
router.get("/", authenticateJWT as any, getMyGroups as any);

// Create group
router.post("/", authenticateJWT as any, createGroup as any);

// Get group details
router.get("/:id", authenticateJWT as any, getGroup as any);

// Update group
router.put("/:id", authenticateJWT as any, updateGroup as any);

// Send message to group
router.post("/:id/messages", authenticateJWT as any, sendGroupMessage as any);

// Get group messages
router.get("/:id/messages", authenticateJWT as any, getGroupMessages as any);

// React to group message
router.post("/messages/:messageId/react", authenticateJWT as any, reactToGroupMessage as any);

// Remove group message reaction
router.delete("/messages/:messageId/react", authenticateJWT as any, removeGroupMessageReaction as any);

// Edit group message
router.post("/messages/:messageId/edit", authenticateJWT as any, editGroupMessage as any);

// Delete group message for me
router.post("/messages/:messageId/delete-for-me", authenticateJWT as any, deleteGroupMessageForMe as any);

// Unsend group message
router.post("/messages/:messageId/unsend", authenticateJWT as any, unsendGroupMessage as any);

// Pin group message
router.post("/messages/:messageId/pin", authenticateJWT as any, pinGroupMessage as any);

// Unpin group message
router.post("/messages/:messageId/unpin", authenticateJWT as any, unpinGroupMessage as any);

// Add members
router.post("/:id/members", authenticateJWT as any, addGroupMember as any);

// Remove member
router.delete("/:id/members", authenticateJWT as any, removeGroupMember as any);

// Leave group
router.post("/:id/leave", authenticateJWT as any, leaveGroup as any);

// Delete group
router.delete("/:id", authenticateJWT as any, deleteGroup as any);

// Polls
router.get("/:id/polls", authenticateJWT as any, getPolls as any);
router.post("/:id/polls", authenticateJWT as any, createPoll as any);
router.post("/polls/:pollId/vote", authenticateJWT as any, votePoll as any);

export default router;
