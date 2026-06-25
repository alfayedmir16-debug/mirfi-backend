"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteNote = exports.upsertNote = exports.getMyNote = exports.getNotesFeed = void 0;
const db_1 = __importDefault(require("../config/db"));
// Get notes from people I follow (for display on chat list top)
const getNotesFeed = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        // Get people I follow
        const following = await db_1.default.follow.findMany({
            where: { followerId: userId },
            select: { followingId: true },
        });
        const followingIds = following.map((f) => f.followingId);
        // Get active notes from them (not expired)
        const notes = await db_1.default.note.findMany({
            where: {
                userId: { in: followingIds },
                expiresAt: { gt: new Date() },
            },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        displayName: true,
                        profilePicture: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json(notes);
    }
    catch (e) {
        console.error('getNotesFeed error:', e);
        res.status(500).json({ error: e.message || 'Failed to fetch notes' });
    }
};
exports.getNotesFeed = getNotesFeed;
// Get my current note
const getMyNote = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        const note = await db_1.default.note.findUnique({
            where: { userId },
        });
        res.json(note);
    }
    catch (e) {
        console.error('getMyNote error:', e);
        res.status(500).json({ error: e.message || 'Failed to fetch note' });
    }
};
exports.getMyNote = getMyNote;
// Create or update my note (24h expiry)
const upsertNote = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        const { text, emoji } = req.body;
        if (!text || text.trim().length === 0) {
            return res.status(400).json({ error: 'Note text is required' });
        }
        if (text.length > 60) {
            return res.status(400).json({ error: 'Note text must be 60 characters or less' });
        }
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);
        const note = await db_1.default.note.upsert({
            where: { userId },
            create: {
                userId,
                text: text.trim(),
                emoji: emoji || null,
                expiresAt,
            },
            update: {
                text: text.trim(),
                emoji: emoji || null,
                expiresAt,
            },
        });
        res.json(note);
    }
    catch (e) {
        console.error('upsertNote error:', e);
        res.status(500).json({ error: e.message || 'Failed to save note' });
    }
};
exports.upsertNote = upsertNote;
// Delete my note
const deleteNote = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        await db_1.default.note.delete({
            where: { userId },
        });
        res.json({ success: true });
    }
    catch (e) {
        console.error('deleteNote error:', e);
        res.status(500).json({ error: e.message || 'Failed to delete note' });
    }
};
exports.deleteNote = deleteNote;
