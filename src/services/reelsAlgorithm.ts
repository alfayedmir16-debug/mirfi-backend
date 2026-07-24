/**
 * Instagram-Style Reels Recommendation Algorithm
 * 
 * Scoring Signals (weighted):
 * 1. Engagement Score — likes, comments, shares, saves (weighted differently)
 * 2. Watch Time / Completion — avg watch duration vs video length
 * 3. Trending Velocity — engagement rate in last 2-6 hours
 * 4. User Affinity — how much the viewer interacts with this creator
 * 5. Freshness Decay — newer content gets boost, older content decays
 * 6. Creator Diversity — avoid same creator back-to-back
 * 7. Following Boost — small boost for creators you follow
 * 8. New Creator Boost — creators with <5 reels get discovery push
 */

import { prisma } from '../db';

// ─── Weight Configuration ───
const WEIGHTS = {
  engagement: 0.20,      // 20% — likes, comments, saves, shares
  watchTime: 0.15,       // 15% — avg watch duration / completion rate
  trending: 0.10,        // 10% — velocity of engagement in last few hours
  affinity: 0.10,        // 10% — viewer's history with this creator
  freshness: 0.10,       // 10% — time decay
  contentPreference: 0.35, // 35% — user's content taste (categories, hashtags, creators they engage with most)
};

// Engagement sub-weights
const ENGAGEMENT_WEIGHTS = {
  like: 1.0,
  comment: 3.0,          // Comments = high intent
  save: 4.0,             // Saves = highest value signal
  share: 2.5,
  view: 0.1,
};

// ─── Scoring Functions ───

/**
 * Calculate engagement score for a reel (0-100 normalized)
 */
function calcEngagementScore(reel: any): number {
  const likes = reel._count?.likes || reel.likes?.length || 0;
  const comments = reel._count?.comments || reel.comments?.length || 0;
  const saves = reel._count?.saves || 0;
  const views = reel._count?.postViews || reel.viewCount || 1;
  const shares = reel.shareCount || 0;

  // Engagement rate = weighted actions / views
  const weightedActions = 
    (likes * ENGAGEMENT_WEIGHTS.like) +
    (comments * ENGAGEMENT_WEIGHTS.comment) +
    (saves * ENGAGEMENT_WEIGHTS.save) +
    (shares * ENGAGEMENT_WEIGHTS.share);

  // Normalize: engagement rate (actions per view), capped at 1
  const engagementRate = Math.min(weightedActions / Math.max(views, 1), 1);
  
  // Scale to 0-100
  return engagementRate * 100;
}

/**
 * Calculate watch time score (0-100)
 * Higher if people watch the full reel / re-watch
 * Uses the max watch duration across all viewers as a proxy for video length
 */
function calcWatchTimeScore(avgWatchDuration: number, totalViews: number, maxWatchDuration?: number): number {
  if (totalViews === 0) return 50; // No data = neutral score
  
  // Use max watch duration as proxy for actual video length (someone likely watched it fully)
  // Fallback to 15s if no data available
  const estimatedLength = maxWatchDuration && maxWatchDuration > 3 ? maxWatchDuration : 15;
  
  // Completion rate: how much of the video do people watch on average?
  const completionRate = Math.min(avgWatchDuration / estimatedLength, 2); // Cap at 2x (rewatches)
  
  // Scale: 0 watch = 0, full watch = 70, rewatch = 100
  return Math.min(completionRate * 50, 100);
}

/**
 * Calculate trending velocity (0-100)
 * How fast is engagement growing in the last 2-6 hours?
 */
function calcTrendingScore(recentLikes: number, recentViews: number, ageHours: number): number {
  if (ageHours > 168) return 0; // Older than 7 days = no trending boost
  
  // Velocity = recent engagement per hour
  const recentHours = Math.min(ageHours, 6); // Look at last 6 hours max
  if (recentHours === 0) return 80; // Brand new = high trending potential
  
  const velocity = (recentLikes * 2 + recentViews * 0.1) / recentHours;
  
  // Normalize velocity (10+ likes/hour = viral)
  return Math.min(velocity * 10, 100);
}

/**
 * Calculate user affinity score (0-100)
 * How much does this viewer interact with this creator?
 */
function calcAffinityScore(
  isFollowing: boolean,
  likedCreatorPosts: number,
  commentedCreatorPosts: number,
  viewedCreatorPosts: number
): number {
  let score = 0;
  
  if (isFollowing) score += 30; // Following = base affinity
  
  // Interaction depth
  score += Math.min(likedCreatorPosts * 8, 30);      // Liked their posts (max 30)
  score += Math.min(commentedCreatorPosts * 12, 25); // Commented (max 25)
  score += Math.min(viewedCreatorPosts * 2, 15);     // Viewed (max 15)
  
  return Math.min(score, 100);
}

/**
 * Calculate freshness score (0-100)
 * Exponential decay — newer = higher
 */
function calcFreshnessScore(ageHours: number): number {
  // Half-life of 24 hours: score halves every 24h
  // score = 100 * e^(-0.029 * hours)
  const decayRate = 0.029; // ~24h half-life
  return 100 * Math.exp(-decayRate * ageHours);
}

/**
 * Calculate content preference score (0-100)
 * HEAVILY weighted toward categories the user watches most.
 * The more a user watches a specific category, the higher reels from that category score.
 * 
 * Scoring breakdown (out of 100):
 * - Category match: up to 60 points (dominant signal)
 * - Top creator match: up to 20 points
 * - Hashtag match: up to 20 points
 */
function calcContentPreferenceScore(
  reel: any,
  userCategoryPrefs: Record<string, number>,  // category -> weighted watch count
  userTopCreators: Set<string>,                // creator IDs user engages with most
  userHashtagPrefs: Record<string, number>,    // hashtag -> weighted engagement count
): number {
  let score = 0;

  // Category match — PRIMARY signal (up to 60 points)
  const category = (reel.category || '').toLowerCase();
  if (category && userCategoryPrefs[category]) {
    // Find the max category score to normalize
    const maxCategoryScore = Math.max(...Object.values(userCategoryPrefs), 1);
    // Normalize this category's score relative to the user's top category (0 to 1)
    const categoryStrength = userCategoryPrefs[category] / maxCategoryScore;
    // Scale: top category = 60, second = proportional
    score += categoryStrength * 60;
  }

  // Top creator match (up to 20 points)
  if (userTopCreators.has(reel.userId)) {
    score += 20;
  }

  // Hashtag match (up to 20 points)
  const caption = (reel.caption || '').toLowerCase();
  const hashtags = caption.match(/#(\w+)/g) || [];
  let hashtagScore = 0;
  const maxHashtagPref = Math.max(...Object.values(userHashtagPrefs), 1);
  for (const tag of hashtags) {
    const cleanTag = tag.replace('#', '');
    if (userHashtagPrefs[cleanTag]) {
      const tagStrength = userHashtagPrefs[cleanTag] / maxHashtagPref;
      hashtagScore += tagStrength * 8;
    }
  }
  score += Math.min(hashtagScore, 20);

  return Math.min(score, 100);
}

// ─── Main Algorithm ───

interface AlgorithmInput {
  userId: string;
  limit: number;
  cursor?: string;
  excludeIds?: string[];
}

interface ScoredReel {
  reel: any;
  score: number;
  breakdown: {
    engagement: number;
    watchTime: number;
    trending: number;
    affinity: number;
    freshness: number;
    contentPreference: number;
  };
}

export async function getRecommendedReels({ userId, limit, cursor, excludeIds = [] }: AlgorithmInput) {
  const now = new Date();
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // 1. Get blocked users
  const blocks = await prisma.block.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });
  const blockedIds = blocks.map(b => b.blockerId === userId ? b.blockedId : b.blockerId);

  // 2. Get user's following list
  const following = await prisma.follow.findMany({
    where: { followerId: userId, status: 'accepted' },
    select: { followingId: true },
  });
  const followingIds = following.map(f => f.followingId);

  // 3. Get user's recent interaction history (last 30 days) for affinity
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const userLikes = await prisma.like.findMany({
    where: { userId, createdAt: { gte: thirtyDaysAgo } },
    select: { postId: true },
  });
  const userLikedPostIds = new Set(userLikes.map(l => l.postId));

  // 3b. Build user's content taste profile — WATCH HISTORY is the PRIMARY signal
  // The more a user watches a category, the more reels from that category they see

  // Fetch ALL views by this user (last 30 days) — this is the main preference signal
  const allUserViews = await (prisma as any).postView.findMany({
    where: { userId, createdAt: { gte: thirtyDaysAgo } },
    select: { postId: true, watchDuration: true },
    orderBy: { createdAt: 'desc' },
    take: 500, // Last 500 views for taste profiling
  });

  // Get post details for all viewed reels
  const viewedPostIds = allUserViews.map((v: any) => v.postId);
  const viewedPosts = await (prisma.post as any).findMany({
    where: { id: { in: viewedPostIds }, type: 'reel' },
    select: { id: true, userId: true, category: true, caption: true },
  });

  // Build a map of postId → watchDuration for weighted scoring
  const watchDurationMap: Record<string, number> = {};
  allUserViews.forEach((v: any) => {
    watchDurationMap[v.postId] = v.watchDuration || 1;
  });

  // Category preferences — weighted by watch duration (longer watch = stronger signal)
  const userCategoryPrefs: Record<string, number> = {};
  viewedPosts.forEach((p: any) => {
    const cat = (p.category || '').toLowerCase();
    if (cat) {
      const duration = watchDurationMap[p.id] || 1;
      // Weight: short watch (<3s) = 0.5, normal (3-10s) = 1.0, long (>10s) = 2.0
      const watchWeight = duration < 3 ? 0.5 : duration > 10 ? 2.0 : 1.0;
      userCategoryPrefs[cat] = (userCategoryPrefs[cat] || 0) + watchWeight;
    }
  });

  // Also add likes as a bonus signal (like = strong preference indicator)
  const likedPosts = await (prisma.post as any).findMany({
    where: { id: { in: userLikes.map(l => l.postId) }, type: 'reel' },
    select: { userId: true, category: true, caption: true },
  });
  likedPosts.forEach((p: any) => {
    const cat = (p.category || '').toLowerCase();
    if (cat) userCategoryPrefs[cat] = (userCategoryPrefs[cat] || 0) + 3; // Like = 3x weight boost
  });

  // Top creators (creators user engages with most — top 20)
  const creatorEngagement: Record<string, number> = {};
  viewedPosts.forEach((p: any) => {
    const duration = watchDurationMap[p.id] || 1;
    const watchWeight = duration < 3 ? 0.3 : duration > 10 ? 1.5 : 1.0;
    creatorEngagement[p.userId] = (creatorEngagement[p.userId] || 0) + watchWeight;
  });
  likedPosts.forEach((p: any) => {
    creatorEngagement[p.userId] = (creatorEngagement[p.userId] || 0) + 2;
  });
  const userTopCreators = new Set(
    Object.entries(creatorEngagement)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([id]) => id)
  );

  // Hashtag preferences — also watch-based
  const userHashtagPrefs: Record<string, number> = {};
  viewedPosts.forEach((p: any) => {
    const duration = watchDurationMap[p.id] || 1;
    const watchWeight = duration < 3 ? 0.3 : duration > 10 ? 1.5 : 1.0;
    const tags = ((p.caption || '').match(/#(\w+)/g) || []).map((t: string) => t.replace('#', '').toLowerCase());
    tags.forEach((tag: string) => { userHashtagPrefs[tag] = (userHashtagPrefs[tag] || 0) + watchWeight; });
  });
  likedPosts.forEach((p: any) => {
    const tags = ((p.caption || '').match(/#(\w+)/g) || []).map((t: string) => t.replace('#', '').toLowerCase());
    tags.forEach((tag: string) => { userHashtagPrefs[tag] = (userHashtagPrefs[tag] || 0) + 2; });
  });

  // Determine user's top category (most watched) for priority boost later
  const sortedCategories = Object.entries(userCategoryPrefs).sort((a, b) => b[1] - a[1]);
  const userTopCategory = sortedCategories.length > 0 ? sortedCategories[0][0] : null;
  const userTop3Categories = new Set(sortedCategories.slice(0, 3).map(([cat]) => cat));

  // 4. Fetch candidate reels (larger pool for scoring)
  const candidateCount = Math.max(limit * 8, 40); // Fetch 8x more than needed for ranking
  
  const candidates = await (prisma.post as any).findMany({
    where: {
      type: 'reel',
      userId: { not: userId, notIn: blockedIds },
      id: { notIn: excludeIds },
      isScheduled: false,
      visibility: { in: ['public', 'close_friends'] },
      createdAt: { gte: sevenDaysAgo }, // Only last 7 days for freshness
    },
    take: candidateCount,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { id: true, username: true, displayName: true, profilePicture: true, isVerified: true, closeFriends: true } },
      collabUser: { select: { id: true, username: true, displayName: true, profilePicture: true } },
      likes: { select: { userId: true, createdAt: true } },
      comments: { select: { id: true } },
      postViews: {
        select: { watchDuration: true, userId: true, createdAt: true },
      },
      _count: { select: { likes: true, comments: true, saves: true, postViews: true } },
    },
  });

  // 5. Filter close_friends visibility
  const visibleCandidates = candidates.filter((r: any) => {
    if (r.visibility === 'close_friends') {
      return r.user.closeFriends?.includes(userId);
    }
    return true;
  });

  // 6. Get user's interaction with each creator (batch for affinity)
  const creatorIds = [...new Set(visibleCandidates.map((r: any) => r.userId))];
  
  // Get posts by these creators that user has liked
  const userLikesOnCreators = await prisma.like.findMany({
    where: { userId, post: { userId: { in: creatorIds as string[] } } },
    select: { post: { select: { userId: true } } },
  });
  
  // Count likes per creator
  const likesPerCreator: Record<string, number> = {};
  userLikesOnCreators.forEach((l: any) => {
    const cid = l.post.userId;
    likesPerCreator[cid] = (likesPerCreator[cid] || 0) + 1;
  });

  // Get comments by user on these creators' posts (for affinity)
  const userCommentsOnCreators = await (prisma.comment as any).findMany({
    where: { userId, post: { userId: { in: creatorIds as string[] } } },
    select: { post: { select: { userId: true } } },
  });
  const commentsPerCreator: Record<string, number> = {};
  userCommentsOnCreators.forEach((c: any) => {
    const cid = c.post.userId;
    commentsPerCreator[cid] = (commentsPerCreator[cid] || 0) + 1;
  });

  // Get creator post counts (for new creator boost)
  const creatorPostCounts = await (prisma.post as any).groupBy({
    by: ['userId'],
    where: { userId: { in: creatorIds as string[] }, type: 'reel' },
    _count: { id: true },
  });
  const postCountMap: Record<string, number> = {};
  creatorPostCounts.forEach((c: any) => { postCountMap[c.userId] = c._count.id; });

  // 7. Score each reel
  const scoredReels: ScoredReel[] = visibleCandidates.map((reel: any) => {
    const ageMs = now.getTime() - new Date(reel.createdAt).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);

    // Engagement
    const engagementScore = calcEngagementScore(reel);

    // Watch Time
    const watchDurations = (reel.postViews || [])
      .filter((v: any) => v.watchDuration != null)
      .map((v: any) => v.watchDuration);
    const avgWatch = watchDurations.length > 0
      ? watchDurations.reduce((a: number, b: number) => a + b, 0) / watchDurations.length
      : 5; // Default 5s if no data
    const maxWatch = watchDurations.length > 0 ? Math.max(...watchDurations) : undefined;
    const watchTimeScore = calcWatchTimeScore(avgWatch, reel._count?.postViews || 0, maxWatch);

    // Trending — count recent engagement (last 6h)
    const recentViews = (reel.postViews || []).filter((v: any) => new Date(v.createdAt) >= sixHoursAgo).length;
    // Filter likes by createdAt if available, otherwise estimate from total
    const recentLikes = (reel.likes || []).filter((l: any) => l.createdAt ? new Date(l.createdAt) >= sixHoursAgo : false).length || Math.ceil((reel._count?.likes || 0) * Math.min(6 / Math.max(ageHours, 1), 1));
    const trendingScore = calcTrendingScore(recentLikes, recentViews, ageHours);

    // Affinity
    const isFollowing = followingIds.includes(reel.userId);
    const likedCount = likesPerCreator[reel.userId] || 0;
    const commentedCount = commentsPerCreator[reel.userId] || 0;
    const viewedCount = (reel.postViews || []).filter((v: any) => v.userId === userId).length;
    const affinityScore = calcAffinityScore(isFollowing, likedCount, commentedCount, viewedCount);

    // Freshness
    const freshnessScore = calcFreshnessScore(ageHours);

    // Content Preference — does this reel match user's taste?
    const contentPrefScore = calcContentPreferenceScore(reel, userCategoryPrefs, userTopCreators, userHashtagPrefs);

    // ─── Bonus Multipliers ───
    let bonusMultiplier = 1.0;

    // ★ TOP CATEGORY BOOST — user's most-watched categories always surface first
    const reelCategory = (reel.category || '').toLowerCase();
    if (reelCategory && userTopCategory && reelCategory === userTopCategory) {
      bonusMultiplier *= 1.8; // #1 most-watched category = 1.8x boost
    } else if (reelCategory && userTop3Categories.has(reelCategory)) {
      bonusMultiplier *= 1.4; // Top 3 categories = 1.4x boost
    }

    // New creator boost (< 5 reels = 1.4x)
    const creatorReelCount = postCountMap[reel.userId] || 0;
    if (creatorReelCount <= 5) bonusMultiplier *= 1.4;

    // Already viewed penalty (seen it before = lower priority)
    const userViewed = (reel.postViews || []).some((v: any) => v.userId === userId);
    if (userViewed) bonusMultiplier *= 0.3; // Heavy penalty for already-seen

    // Already liked = don't show again as high priority
    if (userLikedPostIds.has(reel.id)) bonusMultiplier *= 0.2;

    // Final weighted score
    const rawScore = 
      (engagementScore * WEIGHTS.engagement) +
      (watchTimeScore * WEIGHTS.watchTime) +
      (trendingScore * WEIGHTS.trending) +
      (affinityScore * WEIGHTS.affinity) +
      (freshnessScore * WEIGHTS.freshness) +
      (contentPrefScore * WEIGHTS.contentPreference);

    const finalScore = rawScore * bonusMultiplier;

    return {
      reel,
      score: finalScore,
      breakdown: {
        engagement: engagementScore,
        watchTime: watchTimeScore,
        trending: trendingScore,
        affinity: affinityScore,
        freshness: freshnessScore,
        contentPreference: contentPrefScore,
      },
    };
  });

  // 8. Sort by score (highest first)
  scoredReels.sort((a, b) => b.score - a.score);

  // 9. Apply diversity — avoid same creator back-to-back
  const diversifiedReels: ScoredReel[] = [];
  const recentCreators: string[] = [];
  
  for (const scored of scoredReels) {
    if (diversifiedReels.length >= limit) break;
    
    const creatorId = scored.reel.userId;
    
    // Don't show same creator within last 3 reels
    if (recentCreators.slice(-3).includes(creatorId)) {
      // Push to later instead of skipping entirely
      continue;
    }
    
    diversifiedReels.push(scored);
    recentCreators.push(creatorId);
  }

  // 10. If we didn't fill enough due to diversity, add remaining
  if (diversifiedReels.length < limit) {
    for (const scored of scoredReels) {
      if (diversifiedReels.length >= limit) break;
      if (!diversifiedReels.includes(scored)) {
        diversifiedReels.push(scored);
      }
    }
  }

  // 11. Add small randomness to top results (avoid stale feed feeling)
  // Shuffle positions slightly within similar score tiers (±10% score range)
  const sliced = diversifiedReels.slice(0, limit);
  for (let i = 0; i < sliced.length - 1; i++) {
    const current = sliced[i];
    const next = sliced[i + 1];
    // If two adjacent reels have similar scores (within 15%), randomly swap
    if (current.score > 0 && next.score / current.score > 0.85) {
      if (Math.random() > 0.6) {
        sliced[i] = next;
        sliced[i + 1] = current;
      }
    }
  }
  const finalReels = sliced.map(s => s.reel);

  // 12. Determine next cursor
  const lastReel = visibleCandidates[visibleCandidates.length - 1];
  const nextCursor = visibleCandidates.length >= candidateCount ? lastReel?.id : null;

  return { reels: finalReels, nextCursor };
}

/**
 * Fallback: Get reels for users with no interaction history (cold start)
 * Shows trending + following mix
 */
export async function getColdStartReels(userId: string, limit: number) {
  const blocks = await prisma.block.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });
  const blockedIds = blocks.map(b => b.blockerId === userId ? b.blockedId : b.blockerId);

  // For new users: show most-liked reels from last 48h
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const reels = await (prisma.post as any).findMany({
    where: {
      type: 'reel',
      userId: { not: userId, notIn: blockedIds },
      isScheduled: false,
      visibility: 'public',
      createdAt: { gte: twoDaysAgo },
    },
    take: limit * 3,
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { id: true, username: true, displayName: true, profilePicture: true, isVerified: true, closeFriends: true } },
      collabUser: { select: { id: true, username: true, displayName: true, profilePicture: true } },
      likes: { select: { userId: true } },
      comments: { select: { id: true } },
      _count: { select: { likes: true, postViews: true } },
    },
  });

  // Sort by engagement (likes + views)
  reels.sort((a: any, b: any) => {
    const scoreA = (a._count?.likes || 0) * 2 + (a._count?.postViews || 0);
    const scoreB = (b._count?.likes || 0) * 2 + (b._count?.postViews || 0);
    return scoreB - scoreA;
  });

  return { reels: reels.slice(0, limit), nextCursor: null };
}
