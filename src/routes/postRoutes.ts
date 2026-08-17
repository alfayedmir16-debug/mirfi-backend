import { Router } from 'express';
import { addComment, createPost, deletePost, getComments, getFeed, getPendingCollabInvites, getPostById, getReels, getSavedPosts, getUserPosts, respondCollab, toggleLike, toggleSave, updatePostSettings, downloadPostReel } from '../controllers/postController';
import { addCommentV2, deleteComment, getPostComments, searchMentionUsers, toggleCommentLike, togglePinComment } from '../controllers/commentController';
import { authenticateJWT } from '../middleware/auth';

const router = Router();

router.post('/create', authenticateJWT as any, createPost as any);
router.get('/feed', authenticateJWT as any, getFeed as any);
router.get('/reels', authenticateJWT as any, getReels as any);
router.post('/like', authenticateJWT as any, toggleLike as any);
router.get('/user/:userId', authenticateJWT as any, getUserPosts as any);
router.get('/post/:postId', authenticateJWT as any, getPostById as any);
router.get('/post/:postId/download', downloadPostReel as any);
router.post('/save', authenticateJWT as any, toggleSave as any);
router.get('/saved', authenticateJWT as any, getSavedPosts as any);
router.get('/search', authenticateJWT as any, getFeed as any);
router.post('/comment', authenticateJWT as any, addComment as any);
router.get('/:postId/comments', authenticateJWT as any, getComments as any);
router.put('/settings', authenticateJWT as any, updatePostSettings as any);
router.delete('/:postId', authenticateJWT as any, deletePost as any);
router.get('/collab/invites', authenticateJWT as any, getPendingCollabInvites as any);
router.post('/collab/:postId/respond', authenticateJWT as any, respondCollab as any);

// ─── Enhanced Comment APIs ───
router.get('/:postId/comments/v2', authenticateJWT as any, getPostComments as any);
router.post('/comment/v2', authenticateJWT as any, addCommentV2 as any);
router.post('/comment/like', authenticateJWT as any, toggleCommentLike as any);
router.post('/comment/pin', authenticateJWT as any, togglePinComment as any);
router.delete('/comment/:commentId', authenticateJWT as any, deleteComment as any);
router.get('/comments/mentions', authenticateJWT as any, searchMentionUsers as any);

export default router;
