import { prisma } from '../db';
import { randomUUID } from 'crypto';

// ─── Get highlights for a user's profile ───
export const getUserHighlights = async (req: any, res: any) => {
  const { userId } = req.params;

  try {
    const highlights: any[] = await prisma.$queryRaw`
      SELECT h.*, 
        (SELECT COUNT(*)::int FROM "StoryHighlightItem" WHERE "highlightId" = h.id) as "itemCount"
      FROM "StoryHighlight" h
      WHERE h."userId" = ${userId}
      ORDER BY h.position ASC
    `;

    // Get first item (cover) for each highlight
    for (const h of highlights) {
      const items: any[] = await prisma.$queryRaw`
        SELECT * FROM "StoryHighlightItem" 
        WHERE "highlightId" = ${h.id} 
        ORDER BY position ASC LIMIT 1
      `;
      h.items = items;
      h._count = { items: h.itemCount };
    }

    res.json(highlights);
  } catch (e: any) {
    console.error('getUserHighlights error:', e);
    res.status(500).json({ error: e.message });
  }
};

// ─── Get single highlight with all items ───
export const getHighlightDetail = async (req: any, res: any) => {
  const { highlightId } = req.params;

  try {
    const highlights: any[] = await prisma.$queryRaw`
      SELECT h.*, u.id as "user_id", u.username as "user_username", u."profilePicture" as "user_profilePicture"
      FROM "StoryHighlight" h
      JOIN "User" u ON u.id = h."userId"
      WHERE h.id = ${highlightId}
      LIMIT 1
    `;

    if (highlights.length === 0) return res.status(404).json({ error: 'Highlight not found' });

    const highlight = highlights[0];
    const items: any[] = await prisma.$queryRaw`
      SELECT * FROM "StoryHighlightItem" 
      WHERE "highlightId" = ${highlightId} 
      ORDER BY position ASC
    `;

    res.json({
      ...highlight,
      items,
      user: { id: highlight.user_id, username: highlight.user_username, profilePicture: highlight.user_profilePicture },
    });
  } catch (e: any) {
    console.error('getHighlightDetail error:', e);
    res.status(500).json({ error: e.message });
  }
};

// ─── Create a new highlight ───
export const createHighlight = async (req: any, res: any) => {
  const userId = req.user.id;
  const { title, coverUrl, storyIds } = req.body;

  if (!title) return res.status(400).json({ error: 'Title is required' });

  try {
    // Get max position
    const posResult: any[] = await prisma.$queryRaw`
      SELECT COALESCE(MAX(position), 0) as "maxPos" 
      FROM "StoryHighlight" 
      WHERE "userId" = ${userId}
    `;
    const nextPosition = (posResult[0]?.maxPos || 0) + 1;

    // Create highlight
    const highlightId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "StoryHighlight" (id, "userId", title, "coverUrl", position, "createdAt", "updatedAt")
      VALUES (${highlightId}, ${userId}, ${title}, ${coverUrl || null}, ${nextPosition}, NOW(), NOW())
    `;

    // Add stories as items
    if (storyIds && Array.isArray(storyIds) && storyIds.length > 0) {
      const stories = await prisma.story.findMany({
        where: { id: { in: storyIds }, userId },
        select: { id: true, mediaUrl: true },
      });

      for (let i = 0; i < stories.length; i++) {
        const itemId = randomUUID();
        await prisma.$executeRaw`
          INSERT INTO "StoryHighlightItem" (id, "highlightId", "storyId", "mediaUrl", position, "createdAt")
          VALUES (${itemId}, ${highlightId}, ${stories[i].id}, ${stories[i].mediaUrl}, ${i}, NOW())
        `;
      }
    }

    // Return created highlight with items
    const items: any[] = await prisma.$queryRaw`
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
  } catch (e: any) {
    console.error('createHighlight error:', e);
    res.status(500).json({ error: e.message });
  }
};

// ─── Update highlight (title, cover) ───
export const updateHighlight = async (req: any, res: any) => {
  const userId = req.user.id;
  const { highlightId } = req.params;
  const { title, coverUrl } = req.body;

  try {
    const highlights: any[] = await prisma.$queryRaw`
      SELECT * FROM "StoryHighlight" WHERE id = ${highlightId} LIMIT 1
    `;
    if (highlights.length === 0) return res.status(404).json({ error: 'Not found' });
    if (highlights[0].userId !== userId) return res.status(403).json({ error: 'Forbidden' });

    const newTitle = title !== undefined ? title : highlights[0].title;
    const newCover = coverUrl !== undefined ? coverUrl : highlights[0].coverUrl;

    await prisma.$executeRaw`
      UPDATE "StoryHighlight" 
      SET title = ${newTitle}, "coverUrl" = ${newCover}, "updatedAt" = NOW()
      WHERE id = ${highlightId}
    `;

    const items: any[] = await prisma.$queryRaw`
      SELECT * FROM "StoryHighlightItem" WHERE "highlightId" = ${highlightId} ORDER BY position ASC
    `;

    res.json({ ...highlights[0], title: newTitle, coverUrl: newCover, items });
  } catch (e: any) {
    console.error('updateHighlight error:', e);
    res.status(500).json({ error: e.message });
  }
};

// ─── Delete highlight ───
export const deleteHighlight = async (req: any, res: any) => {
  const userId = req.user.id;
  const { highlightId } = req.params;

  try {
    const highlights: any[] = await prisma.$queryRaw`
      SELECT * FROM "StoryHighlight" WHERE id = ${highlightId} LIMIT 1
    `;
    if (highlights.length === 0) return res.status(404).json({ error: 'Not found' });
    if (highlights[0].userId !== userId) return res.status(403).json({ error: 'Forbidden' });

    // Delete items first (cascade should handle it, but explicit is safer)
    await prisma.$executeRaw`DELETE FROM "StoryHighlightItem" WHERE "highlightId" = ${highlightId}`;
    await prisma.$executeRaw`DELETE FROM "StoryHighlight" WHERE id = ${highlightId}`;

    res.json({ success: true });
  } catch (e: any) {
    console.error('deleteHighlight error:', e);
    res.status(500).json({ error: e.message });
  }
};

// ─── Add stories to existing highlight ───
export const addToHighlight = async (req: any, res: any) => {
  const userId = req.user.id;
  const { highlightId } = req.params;
  const { storyIds, mediaUrls } = req.body;

  try {
    const highlights: any[] = await prisma.$queryRaw`
      SELECT * FROM "StoryHighlight" WHERE id = ${highlightId} LIMIT 1
    `;
    if (highlights.length === 0) return res.status(404).json({ error: 'Not found' });
    if (highlights[0].userId !== userId) return res.status(403).json({ error: 'Forbidden' });

    // Get max position
    const posResult: any[] = await prisma.$queryRaw`
      SELECT COALESCE(MAX(position), 0) as "maxPos" 
      FROM "StoryHighlightItem" 
      WHERE "highlightId" = ${highlightId}
    `;
    let nextPos = (posResult[0]?.maxPos || 0) + 1;

    // Add from story IDs
    if (storyIds && Array.isArray(storyIds)) {
      const stories = await prisma.story.findMany({
        where: { id: { in: storyIds }, userId },
        select: { id: true, mediaUrl: true },
      });
      for (const story of stories) {
        const itemId = randomUUID();
        await prisma.$executeRaw`
          INSERT INTO "StoryHighlightItem" (id, "highlightId", "storyId", "mediaUrl", position, "createdAt")
          VALUES (${itemId}, ${highlightId}, ${story.id}, ${story.mediaUrl}, ${nextPos}, NOW())
        `;
        nextPos++;
      }
    }

    // Add from direct media URLs (for archived stories)
    if (mediaUrls && Array.isArray(mediaUrls)) {
      for (const url of mediaUrls) {
        const itemId = randomUUID();
        await prisma.$executeRaw`
          INSERT INTO "StoryHighlightItem" (id, "highlightId", "storyId", "mediaUrl", position, "createdAt")
          VALUES (${itemId}, ${highlightId}, ${null}, ${url}, ${nextPos}, NOW())
        `;
        nextPos++;
      }
    }

    // Return updated highlight
    const items: any[] = await prisma.$queryRaw`
      SELECT * FROM "StoryHighlightItem" WHERE "highlightId" = ${highlightId} ORDER BY position ASC
    `;

    res.json({ ...highlights[0], items, _count: { items: items.length } });
  } catch (e: any) {
    console.error('addToHighlight error:', e);
    res.status(500).json({ error: e.message });
  }
};

// ─── Remove item from highlight ───
export const removeFromHighlight = async (req: any, res: any) => {
  const userId = req.user.id;
  const { highlightId, itemId } = req.params;

  try {
    const highlights: any[] = await prisma.$queryRaw`
      SELECT * FROM "StoryHighlight" WHERE id = ${highlightId} LIMIT 1
    `;
    if (highlights.length === 0) return res.status(404).json({ error: 'Not found' });
    if (highlights[0].userId !== userId) return res.status(403).json({ error: 'Forbidden' });

    await prisma.$executeRaw`DELETE FROM "StoryHighlightItem" WHERE id = ${itemId}`;
    res.json({ success: true });
  } catch (e: any) {
    console.error('removeFromHighlight error:', e);
    res.status(500).json({ error: e.message });
  }
};
