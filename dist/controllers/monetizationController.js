"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCreatorMonetization = void 0;
const db_1 = __importDefault(require("../config/db"));
const getCreatorMonetization = async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: 'Unauthorized.' });
    const userId = req.user.id;
    try {
        const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const sincePrev30 = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        const [followers, views30d, viewsPrev30d, posts30d, postsPrev30d, totalLikes, totalComments, totalShares] = await Promise.all([
            db_1.default.follow.count({ where: { followingId: userId, status: 'accepted' } }),
            db_1.default.postView.count({
                where: { post: { userId }, createdAt: { gte: since30 } },
            }),
            db_1.default.postView.count({
                where: { post: { userId }, createdAt: { gte: sincePrev30, lt: since30 } },
            }),
            db_1.default.post.count({ where: { userId, type: 'reel', createdAt: { gte: since30 } } }),
            db_1.default.post.count({ where: { userId, type: 'reel', createdAt: { gte: sincePrev30, lt: since30 } } }),
            db_1.default.like.count({ where: { post: { userId }, createdAt: { gte: since30 } } }),
            db_1.default.comment.count({ where: { post: { userId }, createdAt: { gte: since30 } } }),
            db_1.default.post.aggregate({
                where: { userId, createdAt: { gte: since30 } },
                _sum: { shareCount: true },
            }).then((r) => r._sum.shareCount || 0),
        ]);
        const followersPrev30d = await db_1.default.follow.count({
            where: { followingId: userId, status: 'accepted', createdAt: { gte: sincePrev30, lt: since30 } },
        });
        const newFollowers30d = followers - followersPrev30d;
        const newFollowersPrev30d = followersPrev30d;
        const followersChange = newFollowersPrev30d > 0
            ? Math.round(((newFollowers30d - newFollowersPrev30d) / newFollowersPrev30d) * 100)
            : (newFollowers30d > 0 ? 100 : 0);
        const viewsChange = viewsPrev30d > 0
            ? Math.round(((views30d - viewsPrev30d) / viewsPrev30d) * 100)
            : (views30d > 0 ? 100 : 0);
        const engagementRate = views30d > 0 ? ((totalLikes + totalComments + totalShares) / views30d) * 100 : 0;
        const avgViewsPerPost = posts30d > 0 ? Math.round(views30d / posts30d) : 0;
        const followerPct = Math.min(100, Math.round((followers / 1000) * 100));
        const viewsPct = Math.min(100, Math.round((views30d / 15000) * 100));
        const overallPct = Math.round((followerPct + viewsPct) / 2);
        const isEligible = followers >= 1000 && views30d >= 15000;
        const user = await db_1.default.user.findUnique({
            where: { id: userId },
            select: { email: true, isVerified: true },
        });
        res.status(200).json({
            isEligible,
            followers: { current: followers, target: 1000, pct: followerPct },
            views30d: { current: views30d, target: 15000, pct: viewsPct },
            overallPct,
            performance: {
                totalViews: views30d,
                newFollowers: newFollowers30d,
                followersChange,
                engagementRate: Number(engagementRate.toFixed(1)),
                avgViewsPerPost,
                postsCount: posts30d,
                postsChange: postsPrev30d > 0 ? Math.round(((posts30d - postsPrev30d) / postsPrev30d) * 100) : 0,
                viewsChange,
            },
            review: {
                completeGuidelines: true,
                communityGuidelines: isEligible,
                copyrightCompliance: true,
                authenticContent: isEligible,
                verifiedEmail: user?.isVerified || false,
            },
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.getCreatorMonetization = getCreatorMonetization;
