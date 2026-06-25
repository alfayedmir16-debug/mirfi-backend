"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPushNotification = sendPushNotification;
const expo_server_sdk_1 = require("expo-server-sdk");
const db_1 = __importDefault(require("../config/db"));
const expo = new expo_server_sdk_1.Expo();
async function sendPushNotification(userId, title, body, data) {
    try {
        const user = await db_1.default.user.findUnique({
            where: { id: userId },
            select: { pushToken: true },
        });
        if (!user?.pushToken)
            return;
        if (!expo_server_sdk_1.Expo.isExpoPushToken(user.pushToken)) {
            console.warn(`Invalid Expo push token for user ${userId}`);
            return;
        }
        const message = {
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
                await db_1.default.user.update({
                    where: { id: userId },
                    data: { pushToken: null },
                });
            }
        }
    }
    catch (e) {
        console.error('Send push notification error:', e);
    }
}
