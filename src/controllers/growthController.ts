import { Request, Response } from 'express';
import prisma from '../config/db';

interface AuthRequest extends Request {
  user?: { id: string };
}

export const getCreatorGrowth = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized.' });

  const userId = req.user.id;

  try {
    const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [followers, posts, totalViews, totalLikes, totalShares, totalComments, activeHoursRaw] = await Promise.all([
      prisma.follow.count({ where: { followingId: userId, status: 'accepted' } }),
      prisma.post.count({ where: { userId, type: 'reel' } }),
      prisma.postView.count({ where: { post: { userId } } }),
      prisma.like.count({ where: { post: { userId } } }),
      (prisma as any).post.aggregate({ where: { userId }, _sum: { shareCount: true } }).then((r: any) => r._sum.shareCount || 0),
      prisma.comment.count({ where: { post: { userId } } }),
      (prisma as any).$queryRaw`
        SELECT EXTRACT(DOW FROM "createdAt") AS dow, EXTRACT(HOUR FROM "createdAt") AS hr, COUNT(*) AS cnt
        FROM "PostView"
        WHERE "postId" IN (SELECT id FROM "Post" WHERE "userId" = ${userId})
          AND "createdAt" >= ${since90}
        GROUP BY EXTRACT(DOW FROM "createdAt"), EXTRACT(HOUR FROM "createdAt")
        ORDER BY cnt DESC
        LIMIT 1
      `,
    ]);

    const posts30d = await prisma.post.count({ where: { userId, createdAt: { gte: since30 } } });

    const recentPosts = await prisma.post.findMany({
      where: { userId, type: 'reel', createdAt: { gte: since30 } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const postDates = new Set(recentPosts.map((p) => p.createdAt.toISOString().split('T')[0]));
    let streak = 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let checkDate = new Date(today);
    if (!postDates.has(checkDate.toISOString().split('T')[0])) {
      checkDate.setDate(checkDate.getDate() - 1);
    }
    while (postDates.has(checkDate.toISOString().split('T')[0])) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    }

    const engagementRate = totalViews > 0 ? ((totalLikes + totalComments + totalShares) / totalViews) * 100 : 0;

    const profileScore = Math.min(100, Math.round((followers / 1000) * 100));
    const contentScore = Math.min(100, Math.round((posts / 30) * 100));
    const engagementScore = Math.min(100, Math.round(engagementRate * 10));
    const consistencyScore = Math.min(100, Math.round((streak / 14) * 100));
    const totalScore = Math.round((profileScore + contentScore + engagementScore + consistencyScore) / 4);

    let bestTimeText = 'Post consistently to build audience data';
    if (activeHoursRaw && (activeHoursRaw as any).length > 0) {
      const peak = (activeHoursRaw as any)[0];
      const dowNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      const hour = Number(peak.hr);
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const displayHour = hour % 12 === 0 ? 12 : hour % 12;
      const dow = Number(peak.dow);
      const dayName = dow >= 0 && dow <= 6 ? dowNames[dow] : 'Best day';
      bestTimeText = `${dayName} at ${displayHour}:00 ${ampm} for peak reach`;
    }

    const milestones = [
      { id: 'followers_100', label: '100 Followers', target: 100, current: followers, icon: 'people' },
      { id: 'followers_500', label: '500 Followers', target: 500, current: followers, icon: 'people' },
      { id: 'followers_1k', label: '1K Followers', target: 1000, current: followers, icon: 'people' },
      { id: 'followers_5k', label: '5K Followers', target: 5000, current: followers, icon: 'people' },
      { id: 'followers_10k', label: '10K Followers', target: 10000, current: followers, icon: 'people' },
    ];

    res.status(200).json({
      score: totalScore,
      breakdown: {
        profile: profileScore,
        content: contentScore,
        engagement: engagementScore,
        consistency: consistencyScore,
      },
      bestPostTime: bestTimeText,
      milestones,
      followers,
      posts,
      streak,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
