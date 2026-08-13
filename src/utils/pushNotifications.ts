import { Expo } from 'expo-server-sdk';
import prisma from '../config/db';

const expo = new Expo();

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

    // Determine title & body if empty, fallback to data fields
    const finalTitle = title || data?.senderName || data?.title || 'MirFi';
    const finalBody = body || data?.messageText || data?.body || 'New notification';

    // Map notification type to Android channel ID for high-priority popups
    let channelId = 'default';
    const notifType = data?.type || '';
    if (['message', 'group_message', 'message_reaction'].includes(notifType)) {
      channelId = 'chat';
    } else if (['like'].includes(notifType)) {
      channelId = 'likes';
    } else if (['comment'].includes(notifType)) {
      channelId = 'comments';
    } else if (['follow', 'follow_accepted'].includes(notifType)) {
      channelId = 'follows';
    } else if (['story_reaction', 'story_comment', 'story_mention'].includes(notifType)) {
      channelId = 'stories';
    }

    const message: any = {
      to: user.pushToken,
      title: finalTitle,
      body: finalBody,
      sound: 'default',
      priority: 'high',
      channelId,
      _contentAvailable: true,
      data: data || {},
    };

    const [ticket] = await expo.sendPushNotificationsAsync([message]);
    if (ticket && ticket.status === 'error') {
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
