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
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchMentionUsers = exports.deleteComment = exports.togglePinComment = exports.toggleCommentLike = exports.addCommentV2 = exports.getPostComments = void 0;
const db_1 = require("../db");
// ─── Get Comments with filtering + nested replies ───
const getPostComments = async (req, res) => {
    const { postId } = req.params;
    const { sort = 'top' } = req.query; // 'top' | 'newest'
    try {
        const orderBy = sort === 'newest'
            ? { createdAt: 'desc' }
            : [{ isPinned: 'desc' }, { createdAt: 'desc' }];
        // Fetch top-level comments (no parentId)
        const comments = await db_1.prisma.comment.findMany({
            where: { postId, parentId: null },
            include: {
                user: { select: { id: true, username: true, displayName: true, profilePicture: true } },
                likes: { select: { userId: true } },
                replies: {
                    include: {
                        user: { select: { id: true, username: true, displayName: true, profilePicture: true } },
                        likes: { select: { userId: true } },
                    },
                    orderBy: { createdAt: 'asc' },
                    take: 50,
                },
            },
            orderBy,
        });
        // If sort is 'top', re-sort by like count (pinned first, then most liked)
        if (sort === 'top') {
            comments.sort((a, b) => {
                if (a.isPinned && !b.isPinned)
                    return -1;
                if (!a.isPinned && b.isPinned)
                    return 1;
                return (b.likes?.length || 0) - (a.likes?.length || 0);
            });
        }
        res.status(200).json(comments);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.getPostComments = getPostComments;
// ─── Add Comment (supports replies + GIFs) ───
const addCommentV2 = async (req, res) => {
    const { postId, text, parentId, type } = req.body;
    const userId = req.user.id;
    if (!text)
        return res.status(400).json({ error: 'Comment text is required.' });
    try {
        const comment = await db_1.prisma.comment.create({
            data: {
                userId,
                postId,
                text,
                type: type || 'text',
                parentId: parentId || null,
            },
            include: {
                user: { select: { id: true, username: true, displayName: true, profilePicture: true } },
                likes: { select: { userId: true } },
                replies: {
                    include: {
                        user: { select: { id: true, username: true, displayName: true, profilePicture: true } },
                        likes: { select: { userId: true } },
                    },
                },
            },
        });
        // Notification for post owner (skip if commenting on own post)
        try {
            const post = await db_1.prisma.post.findUnique({ where: { id: postId }, select: { userId: true } });
            if (post && post.userId !== userId) {
                const shortText = type === 'gif' ? 'sent a GIF' : (text.length > 60 ? text.substring(0, 60) + '...' : text);
                await db_1.prisma.notification.create({
                    data: { userId: post.userId, senderId: userId, type: 'comment', text: `commented: "${shortText}"`, postId },
                });
                const { sendPushNotification } = await Promise.resolve().then(() => __importStar(require('../utils/pushNotifications')));
                const sender = await db_1.prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
                sendPushNotification(post.userId, sender?.username || 'Someone', `commented: "${shortText}"`, { type: 'comment', postId, senderId: userId });
            }
        }
        catch { }
        // If reply, notify parent comment owner
        if (parentId) {
            try {
                const parentComment = await db_1.prisma.comment.findUnique({ where: { id: parentId }, select: { userId: true } });
                if (parentComment && parentComment.userId !== userId) {
                    const sender = await db_1.prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
                    await db_1.prisma.notification.create({
                        data: { userId: parentComment.userId, senderId: userId, type: 'comment', text: `replied to your comment`, postId },
                    });
                }
            }
            catch { }
        }
        res.status(201).json(comment);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.addCommentV2 = addCommentV2;
// ─── Toggle Comment Like ───
const toggleCommentLike = async (req, res) => {
    const { commentId } = req.body;
    const userId = req.user.id;
    if (!commentId)
        return res.status(400).json({ error: 'commentId is required.' });
    try {
        const existing = await db_1.prisma.commentLike.findUnique({
            where: { userId_commentId: { userId, commentId } },
        });
        if (existing) {
            await db_1.prisma.commentLike.delete({ where: { id: existing.id } });
            return res.status(200).json({ liked: false });
        }
        else {
            await db_1.prisma.commentLike.create({ data: { userId, commentId } });
            return res.status(200).json({ liked: true });
        }
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.toggleCommentLike = toggleCommentLike;
// ─── Pin/Unpin Comment (Post owner only, max 3) ───
const togglePinComment = async (req, res) => {
    const { commentId } = req.body;
    const userId = req.user.id;
    if (!commentId)
        return res.status(400).json({ error: 'commentId is required.' });
    try {
        const comment = await db_1.prisma.comment.findUnique({ where: { id: commentId }, select: { id: true, postId: true, isPinned: true } });
        if (!comment)
            return res.status(404).json({ error: 'Comment not found.' });
        // Verify user is post owner
        const post = await db_1.prisma.post.findUnique({ where: { id: comment.postId }, select: { userId: true } });
        if (!post || post.userId !== userId)
            return res.status(403).json({ error: 'Only the post creator can pin comments.' });
        if (comment.isPinned) {
            // Unpin
            await db_1.prisma.comment.update({ where: { id: commentId }, data: { isPinned: false } });
            return res.status(200).json({ pinned: false });
        }
        else {
            // Check max 3 pinned
            const pinnedCount = await db_1.prisma.comment.count({ where: { postId: comment.postId, isPinned: true } });
            if (pinnedCount >= 3)
                return res.status(400).json({ error: 'Maximum 3 pinned comments allowed.' });
            await db_1.prisma.comment.update({ where: { id: commentId }, data: { isPinned: true } });
            return res.status(200).json({ pinned: true });
        }
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.togglePinComment = togglePinComment;
// ─── Delete Comment ───
const deleteComment = async (req, res) => {
    const commentId = req.params.commentId;
    const userId = req.user.id;
    try {
        const comment = await db_1.prisma.comment.findUnique({ where: { id: commentId }, select: { id: true, userId: true, postId: true } });
        if (!comment)
            return res.status(404).json({ error: 'Comment not found.' });
        // Can delete if own comment or post owner
        const post = await db_1.prisma.post.findUnique({ where: { id: comment.postId }, select: { userId: true } });
        if (comment.userId !== userId && post?.userId !== userId) {
            return res.status(403).json({ error: 'Not authorized to delete this comment.' });
        }
        await db_1.prisma.comment.delete({ where: { id: commentId } });
        res.status(200).json({ deleted: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.deleteComment = deleteComment;
// ─── Search Users for @mention ───
const searchMentionUsers = async (req, res) => {
    const q = req.query.q;
    if (!q || q.length < 1)
        return res.status(200).json([]);
    try {
        const users = await db_1.prisma.user.findMany({
            where: {
                username: { contains: q, mode: 'insensitive' },
            },
            select: { id: true, username: true, displayName: true, profilePicture: true },
            take: 10,
        });
        res.status(200).json(users);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.searchMentionUsers = searchMentionUsers;
