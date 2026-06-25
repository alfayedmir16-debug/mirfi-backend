import { Router } from 'express';
import { confirmAccountDeletion, forgotPassword, getMe, googleLogin, login, register, requestAccountDeletion, resetPassword, updateProfile } from '../controllers/authController';
import { authenticateJWT } from '../middleware/auth';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', authenticateJWT as any, getMe as any);
router.put('/update', authenticateJWT as any, updateProfile as any);
router.post('/forgot-password', forgotPassword as any);
router.post('/reset-password', resetPassword as any);
router.post('/google', googleLogin as any);
router.post('/request-deletion', requestAccountDeletion as any);
router.post('/confirm-deletion', confirmAccountDeletion as any);

export default router;
