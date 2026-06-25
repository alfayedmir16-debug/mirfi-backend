import express from 'express';
import { createSupportTicket } from '../controllers/supportController';
import { authenticateJWT } from '../middleware/auth';

const router = express.Router();

router.post('/ticket', authenticateJWT as any, createSupportTicket as any);

export default router;
