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

    const message: any = {
      to: user.pushToken,
      data: data || {},
    };

    if (title || body) {
      message.sound = 'default';
      if (title) message.title = title;
      if (body) message.body = body;
    } else {
      // Data-only push — ensure it wakes the app for background processing
      message._contentAvailable = true;
      message.priority = 'high';
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
