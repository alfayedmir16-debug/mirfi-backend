"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const db_1 = __importDefault(require("../config/db"));
const supportController_1 = require("../controllers/supportController");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
router.post('/ticket', auth_1.authenticateJWT, supportController_1.createSupportTicket);
// Admin reply to a support ticket — creates notification + sends email
router.post('/ticket/:ticketId/reply', async (req, res) => {
    try {
        const { ticketId } = req.params;
        const { message, adminSecret } = req.body;
        // Verify admin
        if (adminSecret !== (process.env.ADMIN_SECRET || 'mirfi_admin_2026_secret')) {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        if (!message)
            return res.status(400).json({ error: 'Message is required' });
        // Find the ticket
        const ticket = await db_1.default.supportTicket.findUnique({ where: { id: ticketId } });
        if (!ticket)
            return res.status(404).json({ error: 'Ticket not found' });
        // Get the user
        const user = await db_1.default.user.findUnique({
            where: { id: ticket.userId },
            select: { id: true, email: true, username: true, pushToken: true },
        });
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        // 1. Create notification (shows in heart icon)
        await db_1.default.notification.create({
            data: {
                userId: user.id,
                senderId: user.id, // admin notification — no real sender
                type: 'admin_message',
                text: message,
            },
        });
        // 2. Send push notification
        try {
            const { sendPushNotification } = await Promise.resolve().then(() => __importStar(require('../utils/pushNotifications')));
            sendPushNotification(user.id, 'MirFi Support', message, { type: 'admin_message' });
        }
        catch { }
        // 3. Send email to user's registered email
        try {
            const nodemailer = require('nodemailer');
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST || 'smtp.gmail.com',
                port: parseInt(process.env.SMTP_PORT || '587'),
                secure: false,
                auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
            });
            await transporter.sendMail({
                from: `"MirFi Support" <${process.env.SMTP_USER}>`,
                to: user.email,
                subject: `Re: Your ${ticket.category} - MirFi Support`,
                html: `
          <div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto; padding: 30px;">
            <h2 style="color: #333;">MirFi Support Response</h2>
            <p style="color: #666; font-size: 14px;">Hi @${user.username},</p>
            <div style="background: #f5f5f5; padding: 16px; border-radius: 12px; margin: 16px 0;">
              <p style="color: #333; font-size: 15px; margin: 0;">${message}</p>
            </div>
            <p style="color: #999; font-size: 12px;">This is regarding your ${ticket.category} ticket.</p>
            <p style="color: #999; font-size: 12px;">— MirFi Support Team</p>
          </div>
        `,
            });
        }
        catch (emailErr) {
            console.warn('Email send failed (non-critical):', emailErr);
        }
        res.json({ success: true, message: 'Reply sent to user (notification + email)' });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
exports.default = router;
