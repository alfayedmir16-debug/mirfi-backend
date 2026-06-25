import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth';
import { generateAgoraToken } from '../controllers/callController';

const router = Router();

router.get('/token', authenticateJWT, generateAgoraToken);

export default router;
