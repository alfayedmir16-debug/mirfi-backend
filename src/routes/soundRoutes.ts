import { Router } from 'express';
import prisma from '../config/db';
import { authenticateJWT } from '../middleware/auth';

const router = Router();

/**
 * POST /api/sounds/extract
 * Called after a reel is uploaded — extracts audio and creates a Sound entry
 * Body: { postId, mediaUrl }
 */
router.post('/extract', authenticateJWT as any, async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { postId, mediaUrl, title } = req.body;

    if (!mediaUrl) return res.status(400).json({ error: 'mediaUrl is required' });

    // For now, save the video URL as audio source
    // In production, FFmpeg would extract audio server-side
    // Since Render free tier has limited processing, we'll let the client extract audio
    // OR use the video URL directly (most players can play audio from video files)

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    const soundTitle = title || `Original Sound - @${user?.username || 'user'}`;

    const sound = await (prisma as any).sound.create({
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
      await prisma.post.update({
        where: { id: postId },
        data: { soundId: sound.id } as any,
      }).catch(() => {});
    }

    res.status(201).json(sound);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/sounds/trending
 * Returns top sounds by usage count
 */
router.get('/trending', authenticateJWT as any, async (req: any, res: any) => {
  try {
    const sounds = await (prisma as any).sound.findMany({
      orderBy: { useCount: 'desc' },
      take: 30,
    });

    // Enrich with creator info
    const creatorIds = [...new Set(sounds.map((s: any) => s.creatorId))];
    const creators = await prisma.user.findMany({
      where: { id: { in: creatorIds } },
      select: { id: true, username: true, displayName: true, profilePicture: true },
    });
    const creatorMap = Object.fromEntries(creators.map(c => [c.id, c]));

    const enriched = sounds.map((s: any) => ({
      ...s,
      creator: creatorMap[s.creatorId] || null,
    }));

    res.json(enriched);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/sounds/search?q=query
 * Search sounds by title
 */
router.get('/search', authenticateJWT as any, async (req: any, res: any) => {
  try {
    const q = req.query.q as string;
    if (!q) return res.json([]);

    const sounds = await (prisma as any).sound.findMany({
      where: { title: { contains: q, mode: 'insensitive' } },
      orderBy: { useCount: 'desc' },
      take: 20,
    });

    const creatorIds = [...new Set(sounds.map((s: any) => s.creatorId))];
    const creators = await prisma.user.findMany({
      where: { id: { in: creatorIds } },
      select: { id: true, username: true, displayName: true },
    });
    const creatorMap = Object.fromEntries(creators.map(c => [c.id, c]));

    res.json(sounds.map((s: any) => ({ ...s, creator: creatorMap[s.creatorId] || null })));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/sounds/:soundId
 * Get sound details + all reels using this sound
 */
router.get('/:soundId', authenticateJWT as any, async (req: any, res: any) => {
  try {
    const { soundId } = req.params;

    const sound = await (prisma as any).sound.findUnique({ where: { id: soundId } });
    if (!sound) return res.status(404).json({ error: 'Sound not found' });

    const creator = await prisma.user.findUnique({
      where: { id: sound.creatorId },
      select: { id: true, username: true, displayName: true, profilePicture: true },
    });

    // Get all posts using this sound
    const posts = await prisma.post.findMany({
      where: { soundId } as any,
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, mediaUrl: true, thumbnailUrl: true, viewCount: true, createdAt: true },
    });

    res.json({ ...sound, creator, posts });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/sounds/:soundId/use
 * Increment use count when someone creates a reel with this sound
 */
router.post('/:soundId/use', authenticateJWT as any, async (req: any, res: any) => {
  try {
    const { soundId } = req.params;
    const { postId } = req.body;

    await (prisma as any).sound.update({
      where: { id: soundId },
      data: { useCount: { increment: 1 } },
    });

    // Link sound to the new post
    if (postId) {
      await prisma.post.update({
        where: { id: postId },
        data: { soundId } as any,
      }).catch(() => {});
    }

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
