import { Router } from 'express';
import {
    getAchievements,
    getCreatorAnalytics,
    getCreatorContent,
    getCreatorPosts,
    getQuickPerformance,
    sharePost,
    viewPost
} from '../controllers/creatorController';
import { getCreatorGrowth } from '../controllers/growthController';
import { getCreatorMonetization } from '../controllers/monetizationController';
import { authenticateJWT } from '../middleware/auth';

const router = Router();

router.post('/view/:postId', authenticateJWT as any, viewPost as any);
router.post('/share', authenticateJWT as any, sharePost as any);
router.get('/analytics', authenticateJWT as any, getCreatorAnalytics as any);
router.get('/posts', authenticateJWT as any, getCreatorPosts as any);
router.get('/performance', authenticateJWT as any, getQuickPerformance as any);
router.get('/content', authenticateJWT as any, getCreatorContent as any);
router.get('/growth', authenticateJWT as any, getCreatorGrowth as any);
router.get('/monetization', authenticateJWT as any, getCreatorMonetization as any);
router.get('/achievements', authenticateJWT as any, getAchievements as any);

export default router;
