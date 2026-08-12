"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSupportTicket = void 0;
const db_1 = __importDefault(require("../config/db"));
const createSupportTicket = async (req, res) => {
    const { category, description, images } = req.body;
    if (!category || !description) {
        return res.status(400).json({ error: 'Category and description are required.' });
    }
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ error: 'User not authenticated.' });
        }
        // 1. Check daily limit (2 tickets per day)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const ticketCount = await db_1.default.supportTicket.count({
            where: {
                userId: user.id,
                createdAt: {
                    gte: today
                }
            }
        });
        if (ticketCount >= 2) {
            return res.status(429).json({
                error: 'Daily limit reached. You can only submit 2 support tickets per day.'
            });
        }
        // 2. Save ticket to database — visible in Admin Panel
        await db_1.default.supportTicket.create({
            data: {
                userId: user.id,
                category,
                description,
                images: images || []
            }
        });
        // No email — all tickets managed via Admin Panel
        res.status(200).json({ success: true, message: 'Support ticket sent successfully.' });
    }
    catch (error) {
        console.error('Support ticket error:', error);
        res.status(500).json({ error: error.message || 'Failed to send support ticket.' });
    }
};
exports.createSupportTicket = createSupportTicket;
