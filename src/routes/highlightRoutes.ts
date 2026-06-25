import { Router } from 'express';
import {
    addToHighlight,
    createHighlight,
    deleteHighlight,
    getHighlightDetail,
    getUserHighlights,
    removeFromHighlight,
    updateHighlight,
} from '../controllers/highlightController';
import { authenticateJWT } from '../middleware/auth';

const router = Router();

// Public — view highlights for any user
router.get('/user/:userId', authenticateJWT as any, getUserHighlights as any);
router.get('/:highlightId', authenticateJWT as any, getHighlightDetail as any);

// Auth — manage own highlights
router.post('/', authenticateJWT as any, createHighlight as any);
router.put('/:highlightId', authenticateJWT as any, updateHighlight as any);
router.delete('/:highlightId', authenticateJWT as any, deleteHighlight as any);
router.post('/:highlightId/add', authenticateJWT as any, addToHighlight as any);
router.delete('/:highlightId/item/:itemId', authenticateJWT as any, removeFromHighlight as any);

export default router;
