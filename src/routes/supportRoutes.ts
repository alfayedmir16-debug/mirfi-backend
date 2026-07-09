import express from 'express';
import prisma from '../config/db';
import { createSupportTicket } from '../controllers/supportController';
import { authenticateJWT } from '../middleware/auth';

const router = express.Router();

router.post('/ticket', authenticateJWT as any, createSupportTicket as any);

// Admin reply to a support ticket — creates notification + sends email
router.post('/ticket/:ticketId/reply', async (req: any, res: any) => {
  try {
    const { ticketId } = req.params;
    const { message, adminSecret } = req.body;

    // Verify admin
    if (adminSecret !== (process.env.ADMIN_SECRET || 'mirfi_admin_2026_secret')) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!message) return res.status(400).json({ error: 'Message is required' });

    // Find the ticket
    const ticket = await (prisma as any).supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    // Get the user
    const user = await prisma.user.findUnique({
      where: { id: ticket.userId },
      select: { id: true, email: true, username: true, pushToken: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // 1. Create notification (shows in heart icon)
    await prisma.notification.create({
      data: {
        userId: user.id,
        senderId: user.id, // admin notification — no real sender
        type: 'admin_message',
        text: message,
      },
    });

    // 2. Send push notification
    try {
      const { sendPushNotification } = await import('../utils/pushNotifications');
      sendPushNotification(user.id, 'MirFi Support', message, { type: 'admin_message' });
    } catch {}

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
    } catch (emailErr) {
      console.warn('Email send failed (non-critical):', emailErr);
    }

    res.json({ success: true, message: 'Reply sent to user (notification + email)' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
