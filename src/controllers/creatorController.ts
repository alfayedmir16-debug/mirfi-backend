import { Request, Response } from 'express';
import prisma from '../config/db';

interface AuthRequest extends Request {
  user?: { id: string };
}

/* ── view a post (increment view count) ── */
export const viewPost = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized.' });

  const postId = req.params.postId as string;
  const userId = req.user.id;
  const { device, country, source } = req.body || {};

  try {
    // Fetch viewer's gender from profile
    const viewer = await (prisma as any).user.findUnique({
      where: { id: userId },
      select: { gender: true },
    });

    const viewerGender = viewer?.gender || null;

    // Check if already viewed by this user in last 24h
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existing = await prisma.postView.findFirst({
      where: { postId, userId, createdAt: { gte: oneDayAgo } },
    });

    if (!existing) {
      await prisma.$transaction([
        prisma.postView.create({
          data: {
            postId,
            userId,
            gender: viewerGender,
            country: country || null,
            device: device || null,
            source: source || null,
          } as any,
        }),
        prisma.post.update({
          where: { id: postId },
          data: { viewCount: { increment: 1 } },
        }),
      ]);
    }

    res.status(200).json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/* ── share a post (increment share count) ── */
export const sharePost = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized.' });

  const { postId } = req.body;

  try {
    await prisma.post.update({
      where: { id: postId },
      data: { shareCount: { increment: 1 } },
    });

    res.status(200).json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/* ── creator analytics by time period ── */
export const getCreatorAnalytics = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized.' });

  const userId = req.user.id;
  const days = parseInt(req.query.days as string) || 28;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    // 1. Total views in period (from PostView model, or viewCount on posts created within period)
    // For accurate time-based: count PostView entries in period for this user's posts
    const totalViews = await prisma.postView.count({
      where: {
        post: { userId },
        createdAt: { gte: since },
      },
    });

    // Views from previous period for comparison
    const prevSince = new Date(Date.now() - days * 2 * 24 * 60 * 60 * 1000);
    const prevViews = await prisma.postView.count({
      where: {
        post: { userId },
        createdAt: { gte: prevSince, lt: since },
      },
    });

    // 2. Net followers in period
    const gainedFollowers = await prisma.follow.count({
      where: { followingId: userId, status: 'accepted', createdAt: { gte: since } },
    });
    const lostFollowers = 0; // soft-unfollow tracking not implemented; assume 0 for now
    const netFollowers = gainedFollowers - lostFollowers;

    const prevGained = await prisma.follow.count({
      where: { followingId: userId, status: 'accepted', createdAt: { gte: prevSince, lt: since } },
    });
    const prevNet = prevGained;

    // 3. Total likes on user's posts in period
    const totalLikes = await prisma.like.count({
      where: {
        post: { userId },
        createdAt: { gte: since },
      },
    });
    const prevLikes = await prisma.like.count({
      where: {
        post: { userId },
        createdAt: { gte: prevSince, lt: since },
      },
    });

    // 4. Total shares
    const totalShares = await prisma.post.aggregate({
      where: { userId },
      _sum: { shareCount: true },
    });
    // For period-based shares, we'd need a PostShare model. For now return total.
    const periodShares = totalShares._sum.shareCount || 0;

    // 5. Current follower count
    const currentFollowers = await prisma.follow.count({
      where: { followingId: userId, status: 'accepted' },
    });

    // 6. Total posts
    const totalPosts = await prisma.post.count({ where: { userId } });

    // 7. Daily breakdown for chart
    const dailyViews = await prisma.$queryRawUnsafe(
      `SELECT DATE("createdAt") as date, COUNT(*) as count
       FROM "PostView"
       WHERE "postId" IN (SELECT id FROM "Post" WHERE "userId" = $1)
         AND "createdAt" >= $2
       GROUP BY DATE("createdAt")
       ORDER BY date ASC`,
      userId, since
    ) as any[];

    // 8. Audience split by gender (from PostView where userId is not null -> join User)
    const genderRaw = await prisma.$queryRawUnsafe(
      `SELECT u.gender, COUNT(*) as count
       FROM "PostView" pv
       JOIN "User" u ON pv."userId" = u.id
       WHERE pv."postId" IN (SELECT id FROM "Post" WHERE "userId" = $1)
         AND pv."createdAt" >= $2
         AND u.gender IS NOT NULL
       GROUP BY u.gender`,
      userId, since
    ) as any[];

    // 9. Top locations (countries from PostView)
    const locationRaw = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(pv.country, 'Unknown') as country, COUNT(*) as count
       FROM "PostView" pv
       WHERE pv."postId" IN (SELECT id FROM "Post" WHERE "userId" = $1)
         AND pv."createdAt" >= $2
       GROUP BY COALESCE(pv.country, 'Unknown')
       ORDER BY count DESC
       LIMIT 5`,
      userId, since
    ) as any[];

    // 10. Device usage
    const deviceRaw = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(pv.device, 'Unknown') as device, COUNT(*) as count
       FROM "PostView" pv
       WHERE pv."postId" IN (SELECT id FROM "Post" WHERE "userId" = $1)
         AND pv."createdAt" >= $2
       GROUP BY COALESCE(pv.device, 'Unknown')`,
      userId, since
    ) as any[];

    // 11. Traffic sources
    const sourceRaw = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(pv.source, 'unknown') as source, COUNT(*) as count
       FROM "PostView" pv
       WHERE pv."postId" IN (SELECT id FROM "Post" WHERE "userId" = $1)
         AND pv."createdAt" >= $2
       GROUP BY COALESCE(pv.source, 'unknown')`,
      userId, since
    ) as any[];

    // 12. Active hours (day of week + hour breakdown)
    const activeHoursRaw = await prisma.$queryRawUnsafe(
      `SELECT EXTRACT(DOW FROM pv."createdAt") as dow,
              EXTRACT(HOUR FROM pv."createdAt") as hr,
              COUNT(*) as count
       FROM "PostView" pv
       WHERE pv."postId" IN (SELECT id FROM "Post" WHERE "userId" = $1)
         AND pv."createdAt" >= $2
       GROUP BY EXTRACT(DOW FROM pv."createdAt"), EXTRACT(HOUR FROM pv."createdAt")
       ORDER BY dow, hr`,
      userId, since
    ) as any[];

    // Engagement rate = (likes + comments + shares) / totalViews * 100
    const totalComments = await prisma.comment.count({
      where: { post: { userId }, createdAt: { gte: since } },
    });
    const engagementRate = totalViews > 0
      ? (((totalLikes + totalComments + periodShares) / totalViews) * 100).toFixed(2)
      : '0.00';
    const prevComments = await prisma.comment.count({
      where: { post: { userId }, createdAt: { gte: prevSince, lt: since } },
    });
    const prevEngagementRate = prevViews > 0
      ? (((prevLikes + prevComments + periodShares) / prevViews) * 100).toFixed(2)
      : '0.00';
    const engagementChange = parseFloat(prevEngagementRate) > 0
      ? (((parseFloat(engagementRate) - parseFloat(prevEngagementRate)) / parseFloat(prevEngagementRate)) * 100).toFixed(1)
      : (parseFloat(engagementRate) > 0 ? '100.0' : '0.0');

    res.status(200).json({
      period: days,
      totalViews,
      prevViews,
      viewsChange: prevViews > 0 ? Math.round(((totalViews - prevViews) / prevViews) * 100) : (totalViews > 0 ? 100 : 0),
      followers: currentFollowers,
      followersGained: gainedFollowers,
      followersLost: lostFollowers,
      netFollowers,
      prevNetFollowers: prevNet,
      followersChange: prevNet > 0 ? Math.round(((netFollowers - prevNet) / prevNet) * 100) : (netFollowers > 0 ? 100 : 0),
      totalLikes,
      prevLikes,
      likesChange: prevLikes > 0 ? Math.round(((totalLikes - prevLikes) / prevLikes) * 100) : (totalLikes > 0 ? 100 : 0),
      totalShares: periodShares,
      totalPosts,
      engagementRate,
      prevEngagementRate,
      engagementChange,
      dailyViews: dailyViews.map((d: any) => ({ date: d.date, count: Number(d.count) })),
      audienceSplit: genderRaw.map((g: any) => ({ gender: g.gender, count: Number(g.count) })),
      topLocations: locationRaw.map((l: any) => ({ country: l.country, count: Number(l.count) })),
      deviceUsage: deviceRaw.map((d: any) => ({ device: d.device, count: Number(d.count) })),
      trafficSources: sourceRaw.map((s: any) => ({ source: s.source, count: Number(s.count) })),
      activeHours: activeHoursRaw.map((a: any) => ({ dow: Number(a.dow), hour: Number(a.hr), count: Number(a.count) })),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/* ── get creator posts for recent content ── */
export const getCreatorPosts = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized.' });

  const userId = req.user.id;
  const limit = parseInt(req.query.limit as string) || 10;

  try {
    const posts = await prisma.post.findMany({
      where: { userId, type: 'reel' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        _count: { select: { likes: true, comments: true } },
      },
    });

    res.status(200).json(
      posts.map((p) => ({
        id: p.id,
        type: p.type,
        mediaUrl: p.mediaUrl,
        thumbnailUrl: p.thumbnailUrl,
        caption: p.caption,
        viewCount: p.viewCount,
        likeCount: p._count.likes,
        commentCount: p._count.comments,
        shareCount: p.shareCount,
        createdAt: p.createdAt,
      }))
    );
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/* ── quick performance stats ── */
export const getQuickPerformance = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized.' });

  const userId = req.user.id;

  try {
    // Today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayViews = await prisma.postView.count({
      where: { post: { userId }, createdAt: { gte: todayStart } },
    });

    // 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const weekViews = await prisma.postView.count({
      where: { post: { userId }, createdAt: { gte: sevenDaysAgo } },
    });

    // 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const monthViews = await prisma.postView.count({
      where: { post: { userId }, createdAt: { gte: thirtyDaysAgo } },
    });

    res.status(200).json({
      today: todayViews,
      week: weekViews,
      month: monthViews,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/* ── achievements / milestones ── */
export const getAchievements = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized.' });

  const userId = req.user.id;

  try {
    const [followers, posts, totalViews, totalLikes] = await Promise.all([
      prisma.follow.count({ where: { followingId: userId, status: 'accepted' } }),
      prisma.post.count({ where: { userId } }),
      prisma.postView.count({ where: { post: { userId } } }),
      prisma.like.count({ where: { post: { userId } } }),
    ]);

    const milestones = [
      { id: 'followers_1k', label: '1K Followers', target: 1000, current: followers, icon: 'people' },
      { id: 'followers_5k', label: '5K Followers', target: 5000, current: followers, icon: 'people' },
      { id: 'followers_10k', label: '10K Followers', target: 10000, current: followers, icon: 'people' },
      { id: 'posts_100', label: '100 Posts', target: 100, current: posts, icon: 'images' },
      { id: 'views_100k', label: '100K Views', target: 100000, current: totalViews, icon: 'eye' },
      { id: 'likes_10k', label: '10K Likes', target: 10000, current: totalLikes, icon: 'heart' },
    ];

    res.status(200).json({ milestones });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/* ── get creator content tab data ── */
export const getCreatorContent = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized.' });

  const userId = req.user.id;

  try {
    // 1. All posts (reels) ordered by date
    const posts = await prisma.post.findMany({
      where: { userId, type: 'reel' },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { likes: true, comments: true, saves: true } },
      },
    });

    // Extract unique posting dates (YYYY-MM-DD)
    const postDates = new Set(
      posts.map((p) => p.createdAt.toISOString().split('T')[0])
    );

    // 2. Calculate current streak
    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Check if posted today; if not, start from yesterday
    let checkDate = new Date(today);
    if (!postDates.has(checkDate.toISOString().split('T')[0])) {
      checkDate.setDate(checkDate.getDate() - 1);
    }
    while (postDates.has(checkDate.toISOString().split('T')[0])) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    }

    // 3. Build 28-day calendar
    const calendar: { date: string; posted: boolean }[] = [];
    for (let i = 27; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      calendar.push({ date: dateStr, posted: postDates.has(dateStr) });
    }

    // 4. Top performing content (last 7 days, by viewCount)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentPosts = posts.filter((p) => p.createdAt >= sevenDaysAgo);
    const topPerforming = recentPosts
      .sort((a, b) => b.viewCount - a.viewCount)
      .slice(0, 3)
      .map((p) => ({
        id: p.id,
        caption: p.caption,
        thumbnailUrl: p.thumbnailUrl,
        viewCount: p.viewCount,
        likeCount: p._count.likes,
        commentCount: p._count.comments,
        createdAt: p.createdAt,
      }));

    // 5. Deep metrics (all-time aggregates)
    const totalViews = posts.reduce((sum, p) => sum + p.viewCount, 0);
    const totalShares = posts.reduce((sum, p) => sum + p.shareCount, 0);
    const totalLikes = posts.reduce((sum, p) => sum + p._count.likes, 0);
    const totalComments = posts.reduce((sum, p) => sum + p._count.comments, 0);
    const totalSaves = posts.reduce((sum, p) => sum + p._count.saves, 0);

    const engagementRate = totalViews > 0
      ? (((totalLikes + totalComments + totalShares) / totalViews) * 100).toFixed(2)
      : '0.00';
    const saveRate = totalViews > 0
      ? ((totalSaves / totalViews) * 100).toFixed(2)
      : '0.00';

    res.status(200).json({
      streak,
      calendar,
      topPerforming,
      deepMetrics: {
        totalReach: totalViews,
        totalWatchTime: Math.round(totalViews * 0.5), // estimate: 30s avg = 0.5 min per view, in minutes
        avgSaveRate: saveRate,
        engagementRate,
        totalComments,
        totalShares,
        totalLikes,
        totalSaves,
        postCount: posts.length,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
