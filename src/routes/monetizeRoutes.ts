import { Router } from 'express';
import prisma from '../config/db';
import { authenticateJWT } from '../middleware/auth';

const router = Router();

// Creator submits monetization application (from app)
router.post('/apply', authenticateJWT as any, async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { fullName, email, phone, contentType, niche, paymentMethod, paymentDetails } = req.body;

    if (!fullName || !email || !contentType) {
      return res.status(400).json({ error: 'fullName, email, and contentType are required' });
    }

    // Check if already applied
    const existing = await (prisma as any).monetizationApplication.findFirst({
      where: { userId, status: { in: ['pending', 'approved'] } },
    });
    if (existing) {
      return res.status(400).json({ error: 'You already have an active application', application: existing });
    }

    // Check eligibility
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [followers, views30d] = await Promise.all([
      prisma.follow.count({ where: { followingId: userId, status: 'accepted' } }),
      prisma.postView.count({ where: { post: { userId }, createdAt: { gte: since30 } } }),
    ]);

    if (followers < 1000 || views30d < 15000) {
      return res.status(403).json({
        error: 'Not eligible. Need 1000+ followers and 15000+ views in last 30 days.',
        current: { followers, views30d },
      });
    }

    const application = await (prisma as any).monetizationApplication.create({
      data: {
        userId,
        fullName,
        email,
        phone: phone || null,
        contentType,
        niche: niche || null,
        followers,
        views30d,
        paymentMethod: paymentMethod || null,
        paymentDetails: paymentDetails || null,
      },
    });

    res.status(201).json(application);
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to submit application' });
  }
});

// Check application status (from app)
router.get('/status', authenticateJWT as any, async (req: any, res: any) => {
  try {
    const application = await (prisma as any).monetizationApplication.findFirst({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(application || { status: 'none' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Admin Routes (protected by admin secret) ───

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'mirfi_admin_2026_secret';

function adminAuth(req: any, res: any, next: any) {
  const secret = req.headers['x-admin-secret'];
  if (secret !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
}

// List all applications (admin)
router.get('/admin/applications', adminAuth, async (req: any, res: any) => {
  try {
    const { status, page = '1', limit = '20' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = status && status !== 'all' ? { status } : {};
    const [applications, total] = await Promise.all([
      (prisma as any).monetizationApplication.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      (prisma as any).monetizationApplication.count({ where }),
    ]);

    // Fetch user profiles for each application
    const userIds = applications.map((a: any) => a.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, displayName: true, profilePicture: true, isVerified: true },
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    const enriched = applications.map((a: any) => ({
      ...a,
      user: userMap.get(a.userId) || null,
    }));

    res.json({ applications: enriched, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Approve/Reject application (admin)
router.put('/admin/applications/:id', adminAuth, async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status must be approved or rejected' });
    }

    const application = await (prisma as any).monetizationApplication.update({
      where: { id },
      data: { status, adminNotes: adminNotes || null },
    });

    res.json(application);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Get single application detail (admin)
router.get('/admin/applications/:id', adminAuth, async (req: any, res: any) => {
  try {
    const application = await (prisma as any).monetizationApplication.findUnique({
      where: { id: req.params.id },
    });
    if (!application) return res.status(404).json({ error: 'Not found' });

    const user = await prisma.user.findUnique({
      where: { id: application.userId },
      select: { id: true, username: true, displayName: true, profilePicture: true, isVerified: true, createdAt: true },
    });

    res.json({ ...application, user });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Stats (admin dashboard)
router.get('/admin/stats', adminAuth, async (req: any, res: any) => {
  try {
    const [total, pending, approved, rejected] = await Promise.all([
      (prisma as any).monetizationApplication.count(),
      (prisma as any).monetizationApplication.count({ where: { status: 'pending' } }),
      (prisma as any).monetizationApplication.count({ where: { status: 'approved' } }),
      (prisma as any).monetizationApplication.count({ where: { status: 'rejected' } }),
    ]);
    res.json({ total, pending, approved, rejected });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
