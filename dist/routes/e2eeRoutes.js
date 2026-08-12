"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../config/db"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
/**
 * POST /api/e2ee/register-keys
 * Register user's public key on signup
 */
router.post('/register-keys', auth_1.authenticateJWT, async (req, res) => {
    try {
        const { publicKey } = req.body;
        const userId = req.user?.id;
        if (!publicKey) {
            return res.status(400).json({ error: 'publicKey required' });
        }
        await db_1.default.user.update({
            where: { id: userId },
            data: { publicKey },
        });
        res.json({ success: true });
    }
    catch (error) {
        console.error('Register keys error:', error);
        res.status(500).json({ error: 'Failed to register keys' });
    }
});
/**
 * GET /api/e2ee/public-key/:userId
 * Fetch another user's public key for key exchange
 */
router.get('/public-key/:userId', auth_1.authenticateJWT, async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await db_1.default.user.findUnique({
            where: { id: userId },
            select: { publicKey: true, id: true },
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ publicKey: user.publicKey });
    }
    catch (error) {
        console.error('Get public key error:', error);
        res.status(500).json({ error: 'Failed to get public key' });
    }
});
/**
 * POST /api/e2ee/batch-public-keys
 * Fetch multiple users' public keys at once (for chat list)
 */
router.post('/batch-public-keys', auth_1.authenticateJWT, async (req, res) => {
    try {
        const { userIds } = req.body;
        if (!Array.isArray(userIds)) {
            return res.status(400).json({ error: 'userIds array required' });
        }
        const users = await db_1.default.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, publicKey: true },
        });
        const keyMap = {};
        users.forEach(u => { keyMap[u.id] = u.publicKey; });
        res.json({ keys: keyMap });
    }
    catch (error) {
        console.error('Batch public keys error:', error);
        res.status(500).json({ error: 'Failed to get public keys' });
    }
});
exports.default = router;
