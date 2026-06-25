import { Router, Request, Response } from 'express';
import prisma from '../config/db';
import { authenticateJWT } from '../middleware/auth';

const router = Router();

/**
 * POST /api/e2ee/register-keys
 * Register user's public key on signup
 */
router.post('/register-keys', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const { publicKey } = req.body;
    const userId = (req as any).user?.id;

    if (!publicKey) {
      return res.status(400).json({ error: 'publicKey required' });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { publicKey },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Register keys error:', error);
    res.status(500).json({ error: 'Failed to register keys' });
  }
});

/**
 * GET /api/e2ee/public-key/:userId
 * Fetch another user's public key for key exchange
 */
router.get('/public-key/:userId', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params as { userId: string };

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { publicKey: true, id: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ publicKey: user.publicKey });
  } catch (error) {
    console.error('Get public key error:', error);
    res.status(500).json({ error: 'Failed to get public key' });
  }
});

/**
 * POST /api/e2ee/batch-public-keys
 * Fetch multiple users' public keys at once (for chat list)
 */
router.post('/batch-public-keys', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const { userIds } = req.body;

    if (!Array.isArray(userIds)) {
      return res.status(400).json({ error: 'userIds array required' });
    }

    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, publicKey: true },
    });

    const keyMap: { [userId: string]: string | null } = {};
    users.forEach(u => { keyMap[u.id] = u.publicKey; });

    res.json({ keys: keyMap });
  } catch (error) {
    console.error('Batch public keys error:', error);
    res.status(500).json({ error: 'Failed to get public keys' });
  }
});

export default router;
