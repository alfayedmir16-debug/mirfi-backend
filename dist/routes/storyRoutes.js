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
const storyController_1 = require("../controllers/storyController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.post("/create", auth_1.authenticateJWT, storyController_1.createStory);
router.get("/feed", auth_1.authenticateJWT, storyController_1.getStoryFeed);
router.get("/user/:userId", auth_1.authenticateJWT, storyController_1.getUserStories);
// Get current user's reactions for a batch of stories (used by highlight viewer)
router.post("/my-reactions", auth_1.authenticateJWT, async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { storyIds } = req.body;
        if (!storyIds || !Array.isArray(storyIds) || storyIds.length === 0) {
            return res.json([]);
        }
        const { prisma } = await Promise.resolve().then(() => __importStar(require('../db')));
        const reactions = await prisma.storyReaction.findMany({
            where: { userId: req.user.id, storyId: { in: storyIds } },
            select: { storyId: true, emoji: true },
        });
        res.json(reactions);
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// Story Archive — all user's stories (expired + active), paginated
router.get("/archive", auth_1.authenticateJWT, async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const prisma = (await Promise.resolve().then(() => __importStar(require('../config/db')))).default;
        const cursor = req.query.cursor;
        const limit = 30;
        const stories = await prisma.story.findMany({
            where: { userId: req.user.id },
            orderBy: { createdAt: 'desc' },
            take: limit + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            include: {
                _count: { select: { views: true } },
            },
        });
        const hasMore = stories.length > limit;
        const results = hasMore ? stories.slice(0, limit) : stories;
        const nextCursor = hasMore ? results[results.length - 1].id : null;
        res.json({
            stories: results.map((s) => ({
                id: s.id,
                mediaUrl: s.mediaUrl,
                audience: s.audience,
                createdAt: s.createdAt,
                expiresAt: s.expiresAt,
                isExpired: new Date(s.expiresAt) < new Date(),
                viewCount: s._count.views,
            })),
            nextCursor,
        });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// Hide/Unhide story from specific user (MUST be before /:storyId routes)
router.post("/hide-from/:userId", auth_1.authenticateJWT, async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: 'Unauthorized' });
    const { userId } = req.params;
    try {
        const prisma = (await Promise.resolve().then(() => __importStar(require('../config/db')))).default;
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        const current = user?.hiddenStoryFrom || [];
        if (!current.includes(userId)) {
            await prisma.user.update({
                where: { id: req.user.id },
                data: { hiddenStoryFrom: [...current, userId] },
            });
        }
        res.json({ success: true, hidden: true });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
router.delete("/unhide-from/:userId", auth_1.authenticateJWT, async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: 'Unauthorized' });
    const { userId } = req.params;
    try {
        const prisma = (await Promise.resolve().then(() => __importStar(require('../config/db')))).default;
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        const current = user?.hiddenStoryFrom || [];
        await prisma.user.update({
            where: { id: req.user.id },
            data: { hiddenStoryFrom: current.filter(id => id !== userId) },
        });
        res.json({ success: true, hidden: false });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// Get list of users hidden from stories (for settings)
router.get("/hidden-from-list", auth_1.authenticateJWT, async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const prisma = (await Promise.resolve().then(() => __importStar(require('../config/db')))).default;
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        const hiddenIds = user?.hiddenStoryFrom || [];
        if (hiddenIds.length === 0)
            return res.json([]);
        const users = await prisma.user.findMany({
            where: { id: { in: hiddenIds } },
            select: { id: true, username: true, displayName: true, profilePicture: true },
        });
        res.json(users);
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// Story-specific routes (with :storyId param)
router.post("/:storyId/view", auth_1.authenticateJWT, storyController_1.viewStory);
router.post("/:storyId/react", auth_1.authenticateJWT, storyController_1.reactToStory);
router.post("/:storyId/comment", auth_1.authenticateJWT, storyController_1.commentOnStory);
router.get("/:storyId/activity", auth_1.authenticateJWT, storyController_1.getStoryActivity);
router.delete("/:storyId", auth_1.authenticateJWT, storyController_1.deleteStory);
router.post("/:storyId/vote", auth_1.authenticateJWT, storyController_1.voteStoryPoll);
exports.default = router;
