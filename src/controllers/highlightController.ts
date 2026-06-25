import { prisma } from '../db';

// ─── Get highlights for a user's profile ───
export const getUserHighlights = async (req: any, res: any) => {
  const { userId } = req.params;

  try {
    const highlights = await (prisma as any).storyHighlight.findMany({
      where: { userId },
      include: {
        items: {
          orderBy: { position: 'asc' },
          take: 1, // just first item for cover fallback
        },
        _count: { select: { items: true } },
      },
      orderBy: { position: 'asc' },
    });

    res.json(highlights);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// ─── Get single highlight with all items ───
export const getHighlightDetail = async (req: any, res: any) => {
  const { highlightId } = req.params;

  try {
    const highlight = await (prisma as any).storyHighlight.findUnique({
      where: { id: highlightId },
      include: {
        items: { orderBy: { position: 'asc' } },
        user: { select: { id: true, username: true, profilePicture: true } },
      },
    });

    if (!highlight) return res.status(404).json({ error: 'Highlight not found' });
    res.json(highlight);
  } catch (e: any) {
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
    const lastHighlight = await (prisma as any).storyHighlight.findFirst({
      where: { userId },
      orderBy: { position: 'desc' },
    });
    const nextPosition = (lastHighlight?.position || 0) + 1;

    // Create highlight
    const highlight = await (prisma as any).storyHighlight.create({
      data: {
        userId,
        title,
        coverUrl: coverUrl || null,
        position: nextPosition,
      },
    });

    // Add stories as items
    if (storyIds && Array.isArray(storyIds) && storyIds.length > 0) {
      // Fetch stories to get their media URLs
      const stories = await prisma.story.findMany({
        where: { id: { in: storyIds }, userId },
        select: { id: true, mediaUrl: true },
      });

      const items = stories.map((story, index) => ({
        highlightId: highlight.id,
        storyId: story.id,
        mediaUrl: story.mediaUrl,
        position: index,
      }));

      await (prisma as any).storyHighlightItem.createMany({ data: items });
    }

    // Return with items
    const result = await (prisma as any).storyHighlight.findUnique({
      where: { id: highlight.id },
      include: { items: { orderBy: { position: 'asc' } }, _count: { select: { items: true } } },
    });

    res.status(201).json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// ─── Update highlight (title, cover) ───
export const updateHighlight = async (req: any, res: any) => {
  const userId = req.user.id;
  const { highlightId } = req.params;
  const { title, coverUrl } = req.body;

  try {
    const highlight = await (prisma as any).storyHighlight.findUnique({ where: { id: highlightId } });
    if (!highlight) return res.status(404).json({ error: 'Not found' });
    if (highlight.userId !== userId) return res.status(403).json({ error: 'Forbidden' });

    const updated = await (prisma as any).storyHighlight.update({
      where: { id: highlightId },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(coverUrl !== undefined ? { coverUrl } : {}),
      },
      include: { items: { orderBy: { position: 'asc' } } },
    });

    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// ─── Delete highlight ───
export const deleteHighlight = async (req: any, res: any) => {
  const userId = req.user.id;
  const { highlightId } = req.params;

  try {
    const highlight = await (prisma as any).storyHighlight.findUnique({ where: { id: highlightId } });
    if (!highlight) return res.status(404).json({ error: 'Not found' });
    if (highlight.userId !== userId) return res.status(403).json({ error: 'Forbidden' });

    await (prisma as any).storyHighlight.delete({ where: { id: highlightId } });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// ─── Add stories to existing highlight ───
export const addToHighlight = async (req: any, res: any) => {
  const userId = req.user.id;
  const { highlightId } = req.params;
  const { storyIds, mediaUrls } = req.body;

  try {
    const highlight = await (prisma as any).storyHighlight.findUnique({ where: { id: highlightId } });
    if (!highlight) return res.status(404).json({ error: 'Not found' });
    if (highlight.userId !== userId) return res.status(403).json({ error: 'Forbidden' });

    // Get max position in this highlight
    const lastItem = await (prisma as any).storyHighlightItem.findFirst({
      where: { highlightId },
      orderBy: { position: 'desc' },
    });
    let nextPos = (lastItem?.position || 0) + 1;

    const items: any[] = [];

    // Add from story IDs (copies media URL from story)
    if (storyIds && Array.isArray(storyIds)) {
      const stories = await prisma.story.findMany({
        where: { id: { in: storyIds }, userId },
        select: { id: true, mediaUrl: true },
      });
      for (const story of stories) {
        items.push({ highlightId, storyId: story.id, mediaUrl: story.mediaUrl, position: nextPos++ });
      }
    }

    // Add from direct media URLs (for archived stories)
    if (mediaUrls && Array.isArray(mediaUrls)) {
      for (const url of mediaUrls) {
        items.push({ highlightId, storyId: null, mediaUrl: url, position: nextPos++ });
      }
    }

    if (items.length > 0) {
      await (prisma as any).storyHighlightItem.createMany({ data: items });
    }

    const updated = await (prisma as any).storyHighlight.findUnique({
      where: { id: highlightId },
      include: { items: { orderBy: { position: 'asc' } }, _count: { select: { items: true } } },
    });

    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// ─── Remove item from highlight ───
export const removeFromHighlight = async (req: any, res: any) => {
  const userId = req.user.id;
  const { highlightId, itemId } = req.params;

  try {
    const highlight = await (prisma as any).storyHighlight.findUnique({ where: { id: highlightId } });
    if (!highlight) return res.status(404).json({ error: 'Not found' });
    if (highlight.userId !== userId) return res.status(403).json({ error: 'Forbidden' });

    await (prisma as any).storyHighlightItem.delete({ where: { id: itemId } });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};
