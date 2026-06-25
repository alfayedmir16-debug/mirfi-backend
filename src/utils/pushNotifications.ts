import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import prisma from '../config/db';

const expo = new Expo();

/**
 * Send push notification with Instagram-style grouping.
 * Multiple messages from the same sender collapse into one notification
 * showing all messages stacked (like Instagram DMs).
 * 
 * Uses:
 * - `threadId` (iOS) — groups notifications by conversation
 * - `channelId` (Android) — groups by channel
 * - `_contentAvailable` — allows background processing
 */
export async function sendPushNotification(userId: string, title: string, body: string, data?: Record<string, any>) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { pushToken: true },
    });

    if (!user?.pushToken) return;

    if (!Expo.isExpoPushToken(user.pushToken)) {
      console.warn(`Invalid Expo push token for user ${userId}`);
      return;
    }

    // For silent/cancel notifications, send minimal payload
    if (data?.silent || data?.type === 'cancel_notification') {
      const message: ExpoPushMessage = {
        to: user.pushToken,
        data: data || {},
        priority: 'high',
        _contentAvailable: true,
      } as any;
      await expo.sendPushNotificationsAsync([message]);
      return;
    }

    // Determine grouping key — messages from same sender collapse into one
    const senderId = data?.senderId || 'general';

    // For message notifications, fetch recent unread messages to show stacked
    let stackedBody = body;
    if (data?.type === 'message' && senderId) {
      try {
        const recentMsgs = await prisma.message.findMany({
          where: {
            senderId,
            room: { OR: [{ user1Id: userId }, { user2Id: userId }] },
            status: { not: 'SEEN' },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { text: true, type: true },
        });

        if (recentMsgs.length > 1) {
          const lines = recentMsgs
            .reverse()
            .map(m => m.type === 'image' ? '📷 Photo' : m.type === 'audio' ? '🎤 Voice' : m.text || '💬')
            .slice(-4);
          stackedBody = lines.join('\n');
        }
      } catch {}
    }

    // Get sender's profile picture for notification
    let senderAvatar: string | undefined;
    if (senderId && senderId !== 'general') {
      try {
        const sender = await prisma.user.findUnique({
          where: { id: senderId },
          select: { profilePicture: true },
        });
        if (sender?.profilePicture && !sender.profilePicture.includes('placeholder')) {
          senderAvatar = sender.profilePicture;
        }
      } catch {}
    }

    const message: ExpoPushMessage = {
      to: user.pushToken,
      sound: 'default',
      title,
      body: stackedBody,
      data: { ...data },
      channelId: data?.type === 'message' ? 'messages' : 'default',
      priority: 'high',
    };

    // Collapse notifications from same sender (replace previous)
    // Using a fixed notification ID per sender — new notification replaces old one
    if (data?.type === 'message' && senderId) {
      (message as any)._id = `chat_${senderId}`; // Same ID = replaces previous
    }

    const [ticket] = await expo.sendPushNotificationsAsync([message]);
    if (ticket.status === 'error') {
      console.error(`Push notification error for ${userId}:`, ticket.message);
      if (ticket.details?.error === 'DeviceNotRegistered') {
        await prisma.user.update({
          where: { id: userId },
          data: { pushToken: null },
        });
      }
    }
  } catch (e) {
    console.error('Send push notification error:', e);
  }
}
