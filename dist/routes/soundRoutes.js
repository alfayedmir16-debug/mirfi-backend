"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../config/db"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
/**
 * POST /api/sounds/extract
 * Called after a reel is uploaded — extracts audio and creates a Sound entry
 * Body: { postId, mediaUrl }
 */
router.post('/extract', auth_1.authenticateJWT, async (req, res) => {
    try {
        const userId = req.user.id;
        const { postId, mediaUrl, title } = req.body;
        if (!mediaUrl)
            return res.status(400).json({ error: 'mediaUrl is required' });
        // For now, save the video URL as audio source
        // In production, FFmpeg would extract audio server-side
        // Since Render free tier has limited processing, we'll let the client extract audio
        // OR use the video URL directly (most players can play audio from video files)
        const user = await db_1.default.user.findUnique({ where: { id: userId }, select: { username: true } });
        const soundTitle = title || `Original Sound - @${user?.username || 'user'}`;
        const sound = await db_1.default.sound.create({
            data: {
                title: soundTitle,
                audioUrl: mediaUrl, // Video URL works as audio source
                creatorId: userId,
                postId: postId || null,
                useCount: 1,
            },
        });
        // Link sound to post if postId provided
        if (postId) {
            await db_1.default.post.update({
                where: { id: postId },
                data: { soundId: sound.id },
            }).catch(() => { });
        }
        res.status(201).json(sound);
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
/**
 * GET /api/sounds/trending
 * Returns top sounds by usage count
 */
router.get('/trending', auth_1.authenticateJWT, async (req, res) => {
    try {
        const sounds = await db_1.default.sound.findMany({
            orderBy: { useCount: 'desc' },
            take: 30,
        });
        // Enrich with creator info
        const creatorIds = [...new Set(sounds.map((s) => s.creatorId))];
        const creators = await db_1.default.user.findMany({
            where: { id: { in: creatorIds } },
            select: { id: true, username: true, displayName: true, profilePicture: true },
        });
        const creatorMap = Object.fromEntries(creators.map(c => [c.id, c]));
        const enriched = sounds.map((s) => ({
            ...s,
            creator: creatorMap[s.creatorId] || null,
        }));
        res.json(enriched);
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
/**
 * GET /api/sounds/search?q=query
 * Search sounds by title
 */
router.get('/search', auth_1.authenticateJWT, async (req, res) => {
    try {
        const q = req.query.q;
        if (!q)
            return res.json([]);
        const sounds = await db_1.default.sound.findMany({
            where: { title: { contains: q, mode: 'insensitive' } },
            orderBy: { useCount: 'desc' },
            take: 20,
        });
        const creatorIds = [...new Set(sounds.map((s) => s.creatorId))];
        const creators = await db_1.default.user.findMany({
            where: { id: { in: creatorIds } },
            select: { id: true, username: true, displayName: true },
        });
        const creatorMap = Object.fromEntries(creators.map(c => [c.id, c]));
        res.json(sounds.map((s) => ({ ...s, creator: creatorMap[s.creatorId] || null })));
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
/**
 * GET /api/sounds/:soundId
 * Get sound details + all reels using this sound
 */
router.get('/:soundId', auth_1.authenticateJWT, async (req, res) => {
    try {
        const { soundId } = req.params;
        const sound = await db_1.default.sound.findUnique({ where: { id: soundId } });
        if (!sound)
            return res.status(404).json({ error: 'Sound not found' });
        const creator = await db_1.default.user.findUnique({
            where: { id: sound.creatorId },
            select: { id: true, username: true, displayName: true, profilePicture: true },
        });
        // Get all posts using this sound
        const posts = await db_1.default.post.findMany({
            where: { soundId },
            orderBy: { createdAt: 'desc' },
            take: 30,
            select: { id: true, mediaUrl: true, thumbnailUrl: true, viewCount: true, createdAt: true },
        });
        res.json({ ...sound, creator, posts });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
/**
 * POST /api/sounds/:soundId/use
 * Increment use count when someone creates a reel with this sound
 */
router.post('/:soundId/use', auth_1.authenticateJWT, async (req, res) => {
    try {
        const { soundId } = req.params;
        const { postId } = req.body;
        await db_1.default.sound.update({
            where: { id: soundId },
            data: { useCount: { increment: 1 } },
        });
        // Link sound to the new post
        if (postId) {
            await db_1.default.post.update({
                where: { id: postId },
                data: { soundId },
            }).catch(() => { });
        }
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
exports.default = router;
