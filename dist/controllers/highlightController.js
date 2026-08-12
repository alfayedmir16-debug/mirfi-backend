"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeFromHighlight = exports.addToHighlight = exports.deleteHighlight = exports.updateHighlight = exports.createHighlight = exports.getHighlightDetail = exports.getUserHighlights = void 0;
const db_1 = require("../db");
const crypto_1 = require("crypto");
// ─── Get highlights for a user's profile ───
const getUserHighlights = async (req, res) => {
    const { userId } = req.params;
    try {
        const highlights = await db_1.prisma.$queryRaw `
      SELECT h.*, 
        (SELECT COUNT(*)::int FROM "StoryHighlightItem" WHERE "highlightId" = h.id) as "itemCount"
      FROM "StoryHighlight" h
      WHERE h."userId" = ${userId}
      ORDER BY h.position ASC
    `;
        // Get first item (cover) for each highlight
        for (const h of highlights) {
            const items = await db_1.prisma.$queryRaw `
        SELECT * FROM "StoryHighlightItem" 
        WHERE "highlightId" = ${h.id} 
        ORDER BY position ASC LIMIT 1
      `;
            h.items = items;
            h._count = { items: h.itemCount };
        }
        res.json(highlights);
    }
    catch (e) {
        console.error('getUserHighlights error:', e);
        res.status(500).json({ error: e.message });
    }
};
exports.getUserHighlights = getUserHighlights;
// ─── Get single highlight with all items ───
const getHighlightDetail = async (req, res) => {
    const { highlightId } = req.params;
    try {
        const highlights = await db_1.prisma.$queryRaw `
      SELECT h.*, u.id as "user_id", u.username as "user_username", u."profilePicture" as "user_profilePicture"
      FROM "StoryHighlight" h
      JOIN "User" u ON u.id = h."userId"
      WHERE h.id = ${highlightId}
      LIMIT 1
    `;
        if (highlights.length === 0)
            return res.status(404).json({ error: 'Highlight not found' });
        const highlight = highlights[0];
        const items = await db_1.prisma.$queryRaw `
      SELECT * FROM "StoryHighlightItem" 
      WHERE "highlightId" = ${highlightId} 
      ORDER BY position ASC
    `;
        res.json({
            ...highlight,
            items,
            user: { id: highlight.user_id, username: highlight.user_username, profilePicture: highlight.user_profilePicture },
        });
    }
    catch (e) {
        console.error('getHighlightDetail error:', e);
        res.status(500).json({ error: e.message });
    }
};
exports.getHighlightDetail = getHighlightDetail;
// ─── Create a new highlight ───
const createHighlight = async (req, res) => {
    const userId = req.user.id;
    const { title, coverUrl, storyIds } = req.body;
    if (!title)
        return res.status(400).json({ error: 'Title is required' });
    try {
        // Get max position
        const posResult = await db_1.prisma.$queryRaw `
      SELECT COALESCE(MAX(position), 0) as "maxPos" 
      FROM "StoryHighlight" 
      WHERE "userId" = ${userId}
    `;
        const nextPosition = (posResult[0]?.maxPos || 0) + 1;
        // Create highlight
        const highlightId = (0, crypto_1.randomUUID)();
        await db_1.prisma.$executeRaw `
      INSERT INTO "StoryHighlight" (id, "userId", title, "coverUrl", position, "createdAt", "updatedAt")
      VALUES (${highlightId}, ${userId}, ${title}, ${coverUrl || null}, ${nextPosition}, NOW(), NOW())
    `;
        // Add stories as items
        if (storyIds && Array.isArray(storyIds) && storyIds.length > 0) {
            // Check which stories are already in ANY highlight (prevent duplicates across all highlights)
            const alreadyHighlighted = await db_1.prisma.$queryRaw `
        SELECT "storyId" FROM "StoryHighlightItem" 
        WHERE "storyId" = ANY(${storyIds}::text[])
      `;
            const alreadySet = new Set(alreadyHighlighted.map((r) => r.storyId));
            const stories = await db_1.prisma.story.findMany({
                where: { id: { in: storyIds.filter((sid) => !alreadySet.has(sid)) }, userId },
                select: { id: true, mediaUrl: true },
            });
            // Max 50 items per highlight
            const toAdd = stories.slice(0, 50);
            for (let i = 0; i < toAdd.length; i++) {
                const itemId = (0, crypto_1.randomUUID)();
                await db_1.prisma.$executeRaw `
          INSERT INTO "StoryHighlightItem" (id, "highlightId", "storyId", "mediaUrl", position, "createdAt")
          VALUES (${itemId}, ${highlightId}, ${toAdd[i].id}, ${toAdd[i].mediaUrl}, ${i}, NOW())
        `;
            }
        }
        // Return created highlight with items
        const items = await db_1.prisma.$queryRaw `
      SELECT * FROM "StoryHighlightItem" 
      WHERE "highlightId" = ${highlightId} 
      ORDER BY position ASC
    `;
        res.status(201).json({
            id: highlightId,
            userId,
            title,
            coverUrl: coverUrl || null,
            position: nextPosition,
            items,
            _count: { items: items.length },
        });
    }
    catch (e) {
        console.error('createHighlight error:', e);
        res.status(500).json({ error: e.message });
    }
};
exports.createHighlight = createHighlight;
// ─── Update highlight (title, cover) ───
const updateHighlight = async (req, res) => {
    const userId = req.user.id;
    const { highlightId } = req.params;
    const { title, coverUrl } = req.body;
    try {
        const highlights = await db_1.prisma.$queryRaw `
      SELECT * FROM "StoryHighlight" WHERE id = ${highlightId} LIMIT 1
    `;
        if (highlights.length === 0)
            return res.status(404).json({ error: 'Not found' });
        if (highlights[0].userId !== userId)
            return res.status(403).json({ error: 'Forbidden' });
        const newTitle = title !== undefined ? title : highlights[0].title;
        const newCover = coverUrl !== undefined ? coverUrl : highlights[0].coverUrl;
        await db_1.prisma.$executeRaw `
      UPDATE "StoryHighlight" 
      SET title = ${newTitle}, "coverUrl" = ${newCover}, "updatedAt" = NOW()
      WHERE id = ${highlightId}
    `;
        const items = await db_1.prisma.$queryRaw `
      SELECT * FROM "StoryHighlightItem" WHERE "highlightId" = ${highlightId} ORDER BY position ASC
    `;
        res.json({ ...highlights[0], title: newTitle, coverUrl: newCover, items });
    }
    catch (e) {
        console.error('updateHighlight error:', e);
        res.status(500).json({ error: e.message });
    }
};
exports.updateHighlight = updateHighlight;
// ─── Delete highlight ───
const deleteHighlight = async (req, res) => {
    const userId = req.user.id;
    const { highlightId } = req.params;
    try {
        const highlights = await db_1.prisma.$queryRaw `
      SELECT * FROM "StoryHighlight" WHERE id = ${highlightId} LIMIT 1
    `;
        if (highlights.length === 0)
            return res.status(404).json({ error: 'Not found' });
        if (highlights[0].userId !== userId)
            return res.status(403).json({ error: 'Forbidden' });
        // Delete items first (cascade should handle it, but explicit is safer)
        await db_1.prisma.$executeRaw `DELETE FROM "StoryHighlightItem" WHERE "highlightId" = ${highlightId}`;
        await db_1.prisma.$executeRaw `DELETE FROM "StoryHighlight" WHERE id = ${highlightId}`;
        res.json({ success: true });
    }
    catch (e) {
        console.error('deleteHighlight error:', e);
        res.status(500).json({ error: e.message });
    }
};
exports.deleteHighlight = deleteHighlight;
// ─── Add stories to existing highlight ───
const addToHighlight = async (req, res) => {
    const userId = req.user.id;
    const { highlightId } = req.params;
    const { storyIds, mediaUrls } = req.body;
    try {
        const highlights = await db_1.prisma.$queryRaw `
      SELECT * FROM "StoryHighlight" WHERE id = ${highlightId} LIMIT 1
    `;
        if (highlights.length === 0)
            return res.status(404).json({ error: 'Not found' });
        if (highlights[0].userId !== userId)
            return res.status(403).json({ error: 'Forbidden' });
        // Get current item count for 50-item limit
        const countResult = await db_1.prisma.$queryRaw `
      SELECT COUNT(*)::int as count FROM "StoryHighlightItem" WHERE "highlightId" = ${highlightId}
    `;
        const currentCount = countResult[0]?.count || 0;
        const remainingSlots = Math.max(50 - currentCount, 0);
        if (remainingSlots === 0) {
            return res.status(400).json({ error: 'Highlight is full (max 50 stories)' });
        }
        // Get max position
        const posResult = await db_1.prisma.$queryRaw `
      SELECT COALESCE(MAX(position), 0) as "maxPos" 
      FROM "StoryHighlightItem" 
      WHERE "highlightId" = ${highlightId}
    `;
        let nextPos = (posResult[0]?.maxPos || 0) + 1;
        let added = 0;
        // Add from story IDs (with duplicate check)
        if (storyIds && Array.isArray(storyIds) && added < remainingSlots) {
            // Check which are already highlighted anywhere
            const alreadyHighlighted = await db_1.prisma.$queryRaw `
        SELECT "storyId" FROM "StoryHighlightItem" 
        WHERE "storyId" = ANY(${storyIds}::text[])
      `;
            const alreadySet = new Set(alreadyHighlighted.map((r) => r.storyId));
            const stories = await db_1.prisma.story.findMany({
                where: { id: { in: storyIds.filter((sid) => !alreadySet.has(sid)) }, userId },
                select: { id: true, mediaUrl: true },
            });
            for (const story of stories) {
                if (added >= remainingSlots)
                    break;
                const itemId = (0, crypto_1.randomUUID)();
                await db_1.prisma.$executeRaw `
          INSERT INTO "StoryHighlightItem" (id, "highlightId", "storyId", "mediaUrl", position, "createdAt")
          VALUES (${itemId}, ${highlightId}, ${story.id}, ${story.mediaUrl}, ${nextPos}, NOW())
        `;
                nextPos++;
                added++;
            }
        }
        // Add from direct media URLs (for archived stories)
        if (mediaUrls && Array.isArray(mediaUrls)) {
            for (const url of mediaUrls) {
                if (added >= remainingSlots)
                    break;
                const itemId = (0, crypto_1.randomUUID)();
                await db_1.prisma.$executeRaw `
          INSERT INTO "StoryHighlightItem" (id, "highlightId", "storyId", "mediaUrl", position, "createdAt")
          VALUES (${itemId}, ${highlightId}, ${null}, ${url}, ${nextPos}, NOW())
        `;
                nextPos++;
                added++;
            }
        }
        // Return updated highlight
        const items = await db_1.prisma.$queryRaw `
      SELECT * FROM "StoryHighlightItem" WHERE "highlightId" = ${highlightId} ORDER BY position ASC
    `;
        res.json({ ...highlights[0], items, _count: { items: items.length } });
    }
    catch (e) {
        console.error('addToHighlight error:', e);
        res.status(500).json({ error: e.message });
    }
};
exports.addToHighlight = addToHighlight;
// ─── Remove item from highlight ───
const removeFromHighlight = async (req, res) => {
    const userId = req.user.id;
    const { highlightId, itemId } = req.params;
    try {
        const highlights = await db_1.prisma.$queryRaw `
      SELECT * FROM "StoryHighlight" WHERE id = ${highlightId} LIMIT 1
    `;
        if (highlights.length === 0)
            return res.status(404).json({ error: 'Not found' });
        if (highlights[0].userId !== userId)
            return res.status(403).json({ error: 'Forbidden' });
        await db_1.prisma.$executeRaw `DELETE FROM "StoryHighlightItem" WHERE id = ${itemId}`;
        res.json({ success: true });
    }
    catch (e) {
        console.error('removeFromHighlight error:', e);
        res.status(500).json({ error: e.message });
    }
};
exports.removeFromHighlight = removeFromHighlight;
