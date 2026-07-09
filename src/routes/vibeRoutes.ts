import { Router } from 'express';
import {
  findVibe,
  getQuota,
  getSession,
  grantAdBonus,
  pollTicket,
  quitVibe,
  revealVibe,
  sendVibeMessage,
} from '../controllers/vibeController';
import { authenticateJWT } from '../middleware/auth';

const router = Router();

router.get('/quota', authenticateJWT as any, getQuota as any);
router.post('/find', authenticateJWT as any, findVibe as any);
router.get('/ticket/:id', authenticateJWT as any, pollTicket as any);
router.get('/session/:id', authenticateJWT as any, getSession as any);
router.post('/session/:id/message', authenticateJWT as any, sendVibeMessage as any);
router.post('/session/:id/reveal', authenticateJWT as any, revealVibe as any);
router.post('/session/:id/quit', authenticateJWT as any, quitVibe as any);
router.post('/ad-grant', authenticateJWT as any, grantAdBonus as any);

export default router;
