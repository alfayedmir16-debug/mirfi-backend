import { Expo, ExpoPushMessage } from 'expo-server-sdk';
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

    const message: ExpoPushMessage = {
      to: user.pushToken,
      sound: 'default',
      title,
      body,
      data: data || {},
    };

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
