"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAgoraToken = void 0;
const agora_token_1 = require("agora-token");
const generateAgoraToken = (req, res) => {
    const appId = process.env.AGORA_APP_ID;
    const appCert = process.env.AGORA_APP_CERT;
    if (!appId || !appCert) {
        return res.status(500).json({ error: 'Agora credentials not configured' });
    }
    const { channel, uid = 0 } = req.query;
    if (!channel || typeof channel !== 'string') {
        return res.status(400).json({ error: 'channel query param required' });
    }
    const expireTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    const token = agora_token_1.RtcTokenBuilder.buildTokenWithUid(appId, appCert, channel, Number(uid), agora_token_1.RtcRole.PUBLISHER, expireTime, expireTime);
    return res.json({ token, appId, channel });
};
exports.generateAgoraToken = generateAgoraToken;
