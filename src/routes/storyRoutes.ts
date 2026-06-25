import { Router } from "express";
import {
    commentOnStory,
    createStory,
    deleteStory,
    getStoryActivity,
    getStoryFeed,
    getUserStories,
    reactToStory,
    viewStory,
    voteStoryPoll
} from "../controllers/storyController";
import { authenticateJWT } from "../middleware/auth";

const router = Router();

router.post("/create", authenticateJWT as any, createStory as any);
router.get("/feed", authenticateJWT as any, getStoryFeed as any);
router.get("/user/:userId", authenticateJWT as any, getUserStories as any);

// Story Archive — all user's stories (expired + active), paginated
router.get("/archive", authenticateJWT as any, async (req: any, res: any) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const prisma = (await import('../config/db')).default;
    const cursor = req.query.cursor as string | undefined;
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
      stories: results.map((s: any) => ({
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
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Hide/Unhide story from specific user (MUST be before /:storyId routes)
router.post("/hide-from/:userId", authenticateJWT as any, async (req: any, res: any) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { userId } = req.params;
  try {
    const prisma = (await import('../config/db')).default;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const current: string[] = (user as any)?.hiddenStoryFrom || [];
    if (!current.includes(userId)) {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { hiddenStoryFrom: [...current, userId] } as any,
      });
    }
    res.json({ success: true, hidden: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/unhide-from/:userId", authenticateJWT as any, async (req: any, res: any) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { userId } = req.params;
  try {
    const prisma = (await import('../config/db')).default;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const current: string[] = (user as any)?.hiddenStoryFrom || [];
    await prisma.user.update({
      where: { id: req.user.id },
      data: { hiddenStoryFrom: current.filter(id => id !== userId) } as any,
    });
    res.json({ success: true, hidden: false });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Get list of users hidden from stories (for settings)
router.get("/hidden-from-list", authenticateJWT as any, async (req: any, res: any) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const prisma = (await import('../config/db')).default;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const hiddenIds: string[] = (user as any)?.hiddenStoryFrom || [];
    if (hiddenIds.length === 0) return res.json([]);
    const users = await prisma.user.findMany({
      where: { id: { in: hiddenIds } },
      select: { id: true, username: true, displayName: true, profilePicture: true },
    });
    res.json(users);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Story-specific routes (with :storyId param)
router.post("/:storyId/view", authenticateJWT as any, viewStory as any);
router.post("/:storyId/react", authenticateJWT as any, reactToStory as any);
router.post("/:storyId/comment", authenticateJWT as any, commentOnStory as any);
router.get("/:storyId/activity", authenticateJWT as any, getStoryActivity as any);
router.delete("/:storyId", authenticateJWT as any, deleteStory as any);
router.post("/:storyId/vote", authenticateJWT as any, voteStoryPoll as any);

export default router;
