"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../config/db"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// Creator submits monetization application (from app)
router.post('/apply', auth_1.authenticateJWT, async (req, res) => {
    try {
        const userId = req.user.id;
        const { fullName, email, phone, contentType, niche, paymentMethod, paymentDetails } = req.body;
        if (!fullName || !email || !contentType) {
            return res.status(400).json({ error: 'fullName, email, and contentType are required' });
        }
        // Check if already applied
        const existing = await db_1.default.monetizationApplication.findFirst({
            where: { userId, status: { in: ['pending', 'approved'] } },
        });
        if (existing) {
            return res.status(400).json({ error: 'You already have an active application', application: existing });
        }
        // Check eligibility
        const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const [followers, views30d] = await Promise.all([
            db_1.default.follow.count({ where: { followingId: userId, status: 'accepted' } }),
            db_1.default.postView.count({ where: { post: { userId }, createdAt: { gte: since30 } } }),
        ]);
        if (followers < 1000 || views30d < 15000) {
            return res.status(403).json({
                error: 'Not eligible. Need 1000+ followers and 15000+ views in last 30 days.',
                current: { followers, views30d },
            });
        }
        const application = await db_1.default.monetizationApplication.create({
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
    }
    catch (e) {
        res.status(500).json({ error: e.message || 'Failed to submit application' });
    }
});
// Check application status (from app)
router.get('/status', auth_1.authenticateJWT, async (req, res) => {
    try {
        const application = await db_1.default.monetizationApplication.findFirst({
            where: { userId: req.user.id },
            orderBy: { createdAt: 'desc' },
        });
        res.json(application || { status: 'none' });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// ─── Admin Routes (protected by admin secret) ───
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'mirfi_admin_2026_secret';
function adminAuth(req, res, next) {
    const secret = req.headers['x-admin-secret'];
    if (secret !== ADMIN_SECRET) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    next();
}
// List all applications (admin)
router.get('/admin/applications', adminAuth, async (req, res) => {
    try {
        const { status, page = '1', limit = '20' } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const where = status && status !== 'all' ? { status } : {};
        const [applications, total] = await Promise.all([
            db_1.default.monetizationApplication.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: parseInt(limit),
            }),
            db_1.default.monetizationApplication.count({ where }),
        ]);
        // Fetch user profiles for each application
        const userIds = applications.map((a) => a.userId);
        const users = await db_1.default.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, username: true, displayName: true, profilePicture: true, isVerified: true },
        });
        const userMap = new Map(users.map(u => [u.id, u]));
        const enriched = applications.map((a) => ({
            ...a,
            user: userMap.get(a.userId) || null,
        }));
        res.json({ applications: enriched, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// Approve/Reject application (admin)
router.put('/admin/applications/:id', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, adminNotes } = req.body;
        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ error: 'Status must be approved or rejected' });
        }
        const application = await db_1.default.monetizationApplication.update({
            where: { id },
            data: { status, adminNotes: adminNotes || null },
        });
        res.json(application);
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// Get single application detail (admin)
router.get('/admin/applications/:id', adminAuth, async (req, res) => {
    try {
        const application = await db_1.default.monetizationApplication.findUnique({
            where: { id: req.params.id },
        });
        if (!application)
            return res.status(404).json({ error: 'Not found' });
        const user = await db_1.default.user.findUnique({
            where: { id: application.userId },
            select: { id: true, username: true, displayName: true, profilePicture: true, isVerified: true, createdAt: true },
        });
        res.json({ ...application, user });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// Stats (admin dashboard)
router.get('/admin/stats', adminAuth, async (req, res) => {
    try {
        const [total, pending, approved, rejected] = await Promise.all([
            db_1.default.monetizationApplication.count(),
            db_1.default.monetizationApplication.count({ where: { status: 'pending' } }),
            db_1.default.monetizationApplication.count({ where: { status: 'approved' } }),
            db_1.default.monetizationApplication.count({ where: { status: 'rejected' } }),
        ]);
        res.json({ total, pending, approved, rejected });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
exports.default = router;
