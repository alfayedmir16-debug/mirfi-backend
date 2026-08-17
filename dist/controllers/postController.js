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
exports.downloadPostReel = exports.deletePost = exports.getPendingCollabInvites = exports.respondCollab = exports.updatePostSettings = exports.getPostById = exports.getComments = exports.addComment = exports.getSavedPosts = exports.toggleSave = exports.getUserPosts = exports.toggleLike = exports.getReels = exports.getFeed = exports.createPost = void 0;
exports.startPostScheduler = startPostScheduler;
const db_1 = require("../db");
const createPost = async (req, res) => {
    const { type, mediaUrl, thumbnailUrl, caption, category, hideLikes, hideShares, collabUserId, scheduledAt, visibility, textLayers, audioUrl } = req.body;
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized.' });
    }
    if (!type || !mediaUrl) {
        return res.status(400).json({ error: 'Post type and media URL are required.' });
    }
    try {
        const isScheduled = !!scheduledAt;
        // Parse textLayers if it's a string
        let parsedTextLayers = null;
        if (textLayers) {
            try {
                parsedTextLayers = typeof textLayers === 'string' ? JSON.parse(textLayers) : textLayers;
            }
            catch {
                parsedTextLayers = null;
            }
        }
        const post = await db_1.prisma.post.create({
            data: {
                userId: req.user.id,
                type,
                mediaUrl,
                thumbnailUrl: thumbnailUrl || '',
                caption: caption || '',
                category: category || '',
                hideLikes: hideLikes === true || hideLikes === 'true',
                hideShares: hideShares === true || hideShares === 'true',
                collabUserId: collabUserId || null,
                collabStatus: collabUserId ? 'pending' : null,
                scheduledAt: isScheduled ? new Date(scheduledAt) : null,
                isScheduled: isScheduled,
                visibility: visibility || 'public',
                textLayers: parsedTextLayers,
                audioUrl: audioUrl || null,
            },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        displayName: true,
                        profilePicture: true,
                    }
                }
            }
        });
        // Update textLayers and audioUrl via raw query (in case Prisma client hasn't been regenerated)
        if (parsedTextLayers || audioUrl) {
            try {
                await db_1.prisma.$executeRawUnsafe(`UPDATE "Post" SET "textLayers" = $1::jsonb, "audioUrl" = $2 WHERE "id" = $3`, parsedTextLayers ? JSON.stringify(parsedTextLayers) : null, audioUrl || null, post.id);
            }
            catch (rawErr) {
                console.log('Raw update for textLayers/audioUrl skipped (columns may not exist yet):', rawErr);
            }
        }
        // Auto-extract sound for reels (TikTok-style original sounds)
        if (type === 'reel' && mediaUrl) {
            try {
                const creator = await db_1.prisma.user.findUnique({ where: { id: req.user.id }, select: { username: true } });
                const soundTitle = caption && caption.trim() ? caption.trim().substring(0, 50) : `Original Sound - @${creator?.username || 'user'}`;
                await db_1.prisma.sound.create({
                    data: {
                        title: soundTitle,
                        audioUrl: mediaUrl,
                        creatorId: req.user.id,
                        postId: post.id,
                        useCount: 1,
                    },
                });
                // Link sound to post
                const sound = await db_1.prisma.sound.findFirst({ where: { postId: post.id } });
                if (sound) {
                    await db_1.prisma.post.update({ where: { id: post.id }, data: { soundId: sound.id } });
                }
            }
            catch { }
        }
        // Notify collab invitee
        if (collabUserId) {
            try {
                const { sendPushNotification } = await Promise.resolve().then(() => __importStar(require('../utils/pushNotifications')));
                const sender = await db_1.prisma.user.findUnique({ where: { id: req.user.id }, select: { username: true, displayName: true } });
                sendPushNotification(collabUserId, sender?.displayName || sender?.username || 'Someone', 'invited you to collab on a post 🤝', { type: 'collab_invite', postId: post.id });
            }
            catch { }
        }
        res.status(201).json(post);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.createPost = createPost;
const getFeed = async (req, res) => {
    const { limit = '10', cursor, tag } = req.query;
    try {
        const take = parseInt(limit);
        // get IDs the current user has blocked or is blocked by
        const blocks = await db_1.prisma.block.findMany({
            where: { OR: [{ blockerId: req.user.id }, { blockedId: req.user.id }] },
            select: { blockerId: true, blockedId: true },
        });
        const blockedIds = blocks.map(b => b.blockerId === req.user.id ? b.blockedId : b.blockerId);
        const posts = await db_1.prisma.post.findMany({
            where: {
                type: 'image',
                userId: { not: req.user.id, notIn: blockedIds },
                isScheduled: false,
                visibility: { in: ['public', 'close_friends'] },
                ...(tag ? { caption: { contains: tag, mode: 'insensitive' } } : {})
            },
            take: take * 2,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
            orderBy: { createdAt: 'desc' },
            include: {
                user: { select: { id: true, username: true, displayName: true, profilePicture: true, isVerified: true, closeFriends: true } },
                collabUser: { select: { id: true, username: true, displayName: true, profilePicture: true } },
                likes: { select: { userId: true } },
                comments: { include: { user: { select: { username: true, profilePicture: true } } } }
            }
        });
        // Filter close_friends posts: only visible if viewer is in author's closeFriends
        const filteredPosts = posts.filter((p) => {
            if (p.visibility === 'close_friends') {
                return p.user.closeFriends?.includes(req.user.id);
            }
            return true;
        }).slice(0, take);
        const nextCursor = filteredPosts.length === take ? filteredPosts[filteredPosts.length - 1].id : null;
        res.status(200).json({
            posts: filteredPosts,
            nextCursor
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.getFeed = getFeed;
const getReels = async (req, res) => {
    const { limit = '5', cursor } = req.query;
    try {
        const take = parseInt(limit);
        const userId = req.user.id;
        // Use recommendation algorithm
        const { getRecommendedReels, getColdStartReels } = await Promise.resolve().then(() => __importStar(require('../services/reelsAlgorithm')));
        // Check if user has any interaction history (for cold start detection)
        const userLikeCount = await db_1.prisma.like.count({ where: { userId } });
        const userViewCount = await db_1.prisma.postView.count({ where: { userId } });
        let result;
        if (userLikeCount < 3 && userViewCount < 10) {
            // Cold start — new user with no history
            result = await getColdStartReels(userId, take);
        }
        else {
            // Full algorithm
            result = await getRecommendedReels({
                userId,
                limit: take,
                cursor: cursor || undefined,
            });
        }
        res.status(200).json({
            reels: result.reels,
            nextCursor: result.nextCursor,
        });
    }
    catch (error) {
        console.error('getReels algorithm error:', error);
        res.status(500).json({ error: error.message });
    }
};
exports.getReels = getReels;
const toggleLike = async (req, res) => {
    const { postId } = req.body;
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized.' });
    }
    try {
        const existingLike = await db_1.prisma.like.findUnique({
            where: {
                userId_postId: {
                    userId: req.user.id,
                    postId
                }
            }
        });
        if (existingLike) {
            await db_1.prisma.like.delete({
                where: {
                    userId_postId: {
                        userId: req.user.id,
                        postId
                    }
                }
            });
            return res.status(200).json({ liked: false });
        }
        else {
            const like = await db_1.prisma.like.create({
                data: {
                    userId: req.user.id,
                    postId
                }
            });
            // Create notification for post owner
            try {
                const post = await db_1.prisma.post.findUnique({ where: { id: postId }, select: { userId: true } });
                if (post && post.userId !== req.user.id) {
                    await db_1.prisma.notification.create({
                        data: {
                            userId: post.userId,
                            senderId: req.user.id,
                            type: 'like',
                            text: 'liked your post',
                            postId,
                        },
                    });
                    const { sendPushNotification } = await Promise.resolve().then(() => __importStar(require('../utils/pushNotifications')));
                    const sender = await db_1.prisma.user.findUnique({ where: { id: req.user.id }, select: { username: true } });
                    sendPushNotification(post.userId, sender?.username || 'Someone', 'liked your post', { type: 'like', postId, senderId: req.user.id });
                }
            }
            catch (notifErr) {
                console.error('Failed to create like notification:', notifErr);
            }
            return res.status(200).json({ liked: true });
        }
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.toggleLike = toggleLike;
const getUserPosts = async (req, res) => {
    const userId = req.params.userId;
    const requesterId = req.user.id;
    const { limit = '12', cursor } = req.query;
    try {
        // Block check — either direction blocks access
        if (userId !== requesterId) {
            const block = await db_1.prisma.block.findFirst({
                where: {
                    OR: [
                        { blockerId: requesterId, blockedId: userId },
                        { blockerId: userId, blockedId: requesterId },
                    ],
                },
            });
            if (block)
                return res.status(200).json({ posts: [], nextCursor: null });
        }
        const take = Math.min(parseInt(limit) || 12, 30);
        const isOwner = userId === requesterId;
        const includeBlock = {
            user: { select: { id: true, username: true, displayName: true, profilePicture: true, isVerified: true } },
            collabUser: { select: { id: true, username: true, displayName: true, profilePicture: true } },
            likes: { select: { userId: true } },
        };
        const visibilityFilter = isOwner ? {} : { visibility: 'public', isScheduled: false };
        // own posts + collab posts combined with pagination
        const ownPosts = await db_1.prisma.post.findMany({
            where: { userId, ...visibilityFilter },
            orderBy: { createdAt: 'desc' },
            include: includeBlock,
            take: take + 1,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        const hasMore = ownPosts.length > take;
        const results = hasMore ? ownPosts.slice(0, take) : ownPosts;
        const nextCursor = hasMore ? results[results.length - 1].id : null;
        res.status(200).json({ posts: results, nextCursor });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.getUserPosts = getUserPosts;
// Toggle save/unsave post
const toggleSave = async (req, res) => {
    const { postId } = req.body;
    const userId = req.user.id;
    try {
        const existingSave = await db_1.prisma.save.findUnique({
            where: {
                userId_postId: {
                    userId,
                    postId,
                },
            },
        });
        if (existingSave) {
            await db_1.prisma.save.delete({
                where: {
                    userId_postId: {
                        userId,
                        postId,
                    },
                },
            });
            return res.status(200).json({ saved: false });
        }
        else {
            await db_1.prisma.save.create({
                data: {
                    userId,
                    postId,
                },
            });
            return res.status(200).json({ saved: true });
        }
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.toggleSave = toggleSave;
// Fetch saved posts for logged-in user (paginated)
const getSavedPosts = async (req, res) => {
    const userId = req.user.id;
    const { limit = '12', cursor } = req.query;
    try {
        const take = Math.min(parseInt(limit) || 12, 30);
        const saves = await db_1.prisma.save.findMany({
            where: {
                userId,
            },
            include: {
                post: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true,
                                displayName: true,
                                profilePicture: true,
                            },
                        },
                    },
                },
            },
            orderBy: {
                createdAt: "desc",
            },
            take: take + 1, // fetch 1 extra to check if there's more
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        const hasMore = saves.length > take;
        const results = hasMore ? saves.slice(0, take) : saves;
        const nextCursor = hasMore ? results[results.length - 1].id : null;
        res.status(200).json({
            posts: results.map(s => s.post),
            nextCursor,
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.getSavedPosts = getSavedPosts;
// Add comment to a post
const addComment = async (req, res) => {
    const { postId, text } = req.body;
    const userId = req.user.id;
    if (!text) {
        return res.status(400).json({ error: "Comment text is required." });
    }
    try {
        const comment = await db_1.prisma.comment.create({
            data: {
                userId,
                postId,
                text,
            },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        displayName: true,
                        profilePicture: true,
                    },
                },
            },
        });
        // Create notification for post owner
        try {
            const post = await db_1.prisma.post.findUnique({ where: { id: postId }, select: { userId: true } });
            if (post && post.userId !== userId) {
                const shortText = text.length > 80 ? text.substring(0, 80) + '...' : text;
                await db_1.prisma.notification.create({
                    data: {
                        userId: post.userId,
                        senderId: userId,
                        type: 'comment',
                        text: `commented: "${shortText}"`,
                        postId,
                    },
                });
                const { sendPushNotification } = await Promise.resolve().then(() => __importStar(require('../utils/pushNotifications')));
                const sender = await db_1.prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
                sendPushNotification(post.userId, sender?.username || 'Someone', `commented: "${shortText}"`, { type: 'comment', postId, senderId: userId });
            }
        }
        catch (notifErr) {
            console.error('Failed to create comment notification:', notifErr);
        }
        res.status(201).json(comment);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.addComment = addComment;
// Fetch comments for a specific post
const getComments = async (req, res) => {
    const { postId } = req.params;
    try {
        const comments = await db_1.prisma.comment.findMany({
            where: {
                postId,
            },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        displayName: true,
                        profilePicture: true,
                    },
                },
            },
            orderBy: {
                createdAt: "asc",
            },
        });
        res.status(200).json(comments);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.getComments = getComments;
// Fetch single post by ID
const getPostById = async (req, res) => {
    const { postId } = req.params;
    const requesterId = req.user?.id;
    try {
        const post = await db_1.prisma.post.findUnique({
            where: {
                id: postId,
            },
            include: {
                user: {
                    select: { id: true, username: true, displayName: true, profilePicture: true, isVerified: true },
                },
                collabUser: {
                    select: { id: true, username: true, displayName: true, profilePicture: true },
                },
                likes: { select: { userId: true } },
                comments: {
                    include: {
                        user: {
                            select: { id: true, username: true, displayName: true, profilePicture: true },
                        },
                    },
                    orderBy: { createdAt: "asc" },
                },
            },
        });
        if (!post) {
            return res.status(404).json({ error: "Post not found" });
        }
        const isOwner = requesterId && post.userId === requesterId;
        // Scheduled posts only visible to owner
        if (post.isScheduled && !isOwner) {
            return res.status(404).json({ error: "Post not found" });
        }
        // Private posts only visible to owner
        if (post.visibility === 'private' && !isOwner) {
            return res.status(403).json({ error: "This post is private" });
        }
        // Block check — blocked user's post not accessible via direct link either
        if (requesterId && post.userId !== requesterId) {
            const block = await db_1.prisma.block.findFirst({
                where: {
                    OR: [
                        { blockerId: requesterId, blockedId: post.userId },
                        { blockerId: post.userId, blockedId: requesterId },
                    ],
                },
            });
            if (block)
                return res.status(403).json({ error: "Post not available" });
            // Track post view (dedup within 24h)
            try {
                const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
                const existingView = await db_1.prisma.postView.findFirst({
                    where: { postId, userId: requesterId, createdAt: { gte: oneDayAgo } },
                });
                if (!existingView) {
                    await db_1.prisma.$transaction([
                        db_1.prisma.postView.create({ data: { postId, userId: requesterId } }),
                        db_1.prisma.post.update({
                            where: { id: postId },
                            data: { viewCount: { increment: 1 } },
                        }),
                    ]);
                }
            }
            catch (viewErr) {
                // Silently ignore view tracking errors
            }
        }
        res.status(200).json(post);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.getPostById = getPostById;
const updatePostSettings = async (req, res) => {
    const { postId, hideLikes, hideShares, visibility, scheduledAt, cancelSchedule } = req.body;
    const userId = req.user?.id;
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized.' });
    }
    try {
        const post = await db_1.prisma.post.findUnique({ where: { id: postId } });
        if (!post) {
            return res.status(404).json({ error: 'Post not found.' });
        }
        if (post.userId !== userId) {
            return res.status(403).json({ error: 'Forbidden. You do not own this post.' });
        }
        const updateData = {};
        if (hideLikes !== undefined)
            updateData.hideLikes = hideLikes === true || hideLikes === 'true';
        if (hideShares !== undefined)
            updateData.hideShares = hideShares === true || hideShares === 'true';
        if (visibility !== undefined && ['public', 'private', 'unlisted'].includes(visibility)) {
            updateData.visibility = visibility;
        }
        if (cancelSchedule === true) {
            updateData.scheduledAt = null;
            updateData.isScheduled = false;
        }
        else if (scheduledAt !== undefined) {
            const d = new Date(scheduledAt);
            if (!isNaN(d.getTime())) {
                updateData.scheduledAt = d;
                updateData.isScheduled = true;
            }
        }
        const updated = await db_1.prisma.post.update({
            where: { id: postId },
            data: updateData
        });
        res.status(200).json(updated);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.updatePostSettings = updatePostSettings;
// Collab: invited user accepts or declines
const respondCollab = async (req, res) => {
    const { postId } = req.params;
    const { action } = req.body; // 'accept' | 'decline'
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const post = await db_1.prisma.post.findUnique({ where: { id: postId } });
        if (!post)
            return res.status(404).json({ error: 'Post not found' });
        if (post.collabUserId !== userId)
            return res.status(403).json({ error: 'Not the collab invitee' });
        if (post.collabStatus !== 'pending')
            return res.status(400).json({ error: 'Invite already responded' });
        const status = action === 'accept' ? 'accepted' : 'declined';
        const updated = await db_1.prisma.post.update({
            where: { id: postId },
            data: { collabStatus: status },
            include: {
                user: { select: { id: true, username: true, displayName: true, profilePicture: true } },
                collabUser: { select: { id: true, username: true, displayName: true, profilePicture: true } },
            },
        });
        // Notify post owner
        const { sendPushNotification } = await Promise.resolve().then(() => __importStar(require('../utils/pushNotifications')));
        const invitee = await db_1.prisma.user.findUnique({ where: { id: userId }, select: { username: true, displayName: true } });
        if (action === 'accept') {
            sendPushNotification(post.userId, invitee?.displayName || invitee?.username || 'Someone', 'accepted your collab invite! 🎉', { type: 'collab_accepted', postId });
        }
        res.json(updated);
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
};
exports.respondCollab = respondCollab;
// Get pending collab invites for logged-in user
const getPendingCollabInvites = async (req, res) => {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const invites = await db_1.prisma.post.findMany({
            where: { collabUserId: userId, collabStatus: 'pending' },
            include: {
                user: { select: { id: true, username: true, displayName: true, profilePicture: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json(invites);
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
};
exports.getPendingCollabInvites = getPendingCollabInvites;
const deletePost = async (req, res) => {
    const postId = req.params.postId;
    const userId = req.user?.id;
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized.' });
    }
    try {
        const post = await db_1.prisma.post.findUnique({ where: { id: postId } });
        if (!post) {
            return res.status(404).json({ error: 'Post not found.' });
        }
        if (post.userId !== userId) {
            return res.status(403).json({ error: 'Forbidden. You do not own this post.' });
        }
        // Delete media file from Cloudflare R2
        // BUT only if no sound is using this URL (sound should stay)
        const sound = await db_1.prisma.sound.findFirst({ where: { postId } });
        if (!sound && post.mediaUrl) {
            // No sound linked — safe to delete the file
            try {
                const { DeleteObjectCommand } = await Promise.resolve().then(() => __importStar(require('@aws-sdk/client-s3')));
                const { r2Client } = await Promise.resolve().then(() => __importStar(require('../utils/r2')));
                const publicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL || '';
                if (post.mediaUrl.startsWith(publicUrl)) {
                    const key = post.mediaUrl.replace(publicUrl + '/', '');
                    await r2Client.send(new DeleteObjectCommand({
                        Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
                        Key: key,
                    }));
                }
                // Also delete thumbnail if exists
                if (post.thumbnailUrl && post.thumbnailUrl.startsWith(publicUrl)) {
                    const thumbKey = post.thumbnailUrl.replace(publicUrl + '/', '');
                    await r2Client.send(new DeleteObjectCommand({
                        Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
                        Key: thumbKey,
                    }));
                }
            }
            catch (r2Err) {
                console.warn('R2 delete failed (non-critical):', r2Err);
            }
        }
        // If sound exists, keep the file (others may use the sound)
        // But unlink the post from sound
        if (sound) {
            await db_1.prisma.sound.update({ where: { id: sound.id }, data: { postId: null } }).catch(() => { });
        }
        await db_1.prisma.post.delete({ where: { id: postId } });
        res.status(200).json({ success: true, message: 'Post deleted successfully.' });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.deletePost = deletePost;
// ─── Scheduler: Auto-publish scheduled posts every minute ───
function startPostScheduler() {
    const INTERVAL_MS = 60 * 1000; // 1 minute
    const tick = async () => {
        try {
            const now = new Date();
            const duePosts = await db_1.prisma.post.findMany({
                where: {
                    isScheduled: true,
                    scheduledAt: { lte: now },
                },
                select: { id: true, userId: true, caption: true },
            });
            if (duePosts.length > 0) {
                await db_1.prisma.post.updateMany({
                    where: {
                        id: { in: duePosts.map((p) => p.id) },
                    },
                    data: {
                        isScheduled: false,
                        scheduledAt: null,
                    },
                });
                console.log(`[Scheduler] Published ${duePosts.length} scheduled post(s)`);
            }
        }
        catch (e) {
            console.error('[Scheduler] Error publishing scheduled posts:', e.message);
        }
    };
    tick(); // run immediately on startup
    setInterval(tick, INTERVAL_MS);
    console.log('[Scheduler] Post scheduler started (1-minute interval)');
}
const fsExtra = __importStar(require("fs"));
const https = __importStar(require("https"));
const http = __importStar(require("http"));
const pathExtra = __importStar(require("path"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
const downloadFile = (url, dest) => {
    return new Promise((resolve, reject) => {
        const file = fsExtra.createWriteStream(dest);
        const client = url.startsWith('https') ? https : http;
        client.get(url, (response) => {
            if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                // Handle redirect
                downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download file: status ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fsExtra.unlink(dest, () => { });
            reject(err);
        });
    });
};
const downloadPostReel = async (req, res) => {
    const { postId } = req.params;
    try {
        const post = await db_1.prisma.post.findUnique({
            where: { id: postId },
        });
        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }
        // If no background music is selected, redirect directly to original mediaUrl
        if (!post.audioUrl) {
            return res.redirect(post.mediaUrl);
        }
        // We have an audioUrl, so merge it on the server
        const tempDir = os.tmpdir();
        const videoExt = pathExtra.extname(new URL(post.mediaUrl).pathname) || '.mp4';
        const audioExt = pathExtra.extname(new URL(post.audioUrl).pathname) || '.mp3';
        const tempVideoPath = pathExtra.join(tempDir, `video_${postId}_${Date.now()}${videoExt}`);
        const tempAudioPath = pathExtra.join(tempDir, `audio_${postId}_${Date.now()}${audioExt}`);
        const outputPath = pathExtra.join(tempDir, `merged_${postId}_${Date.now()}.mp4`);
        console.log(`[Download] Starting server-side merge for post ${postId}`);
        console.log(`[Download] Video URL: ${post.mediaUrl}`);
        console.log(`[Download] Audio URL: ${post.audioUrl}`);
        // Download both files in parallel
        await Promise.all([
            downloadFile(post.mediaUrl, tempVideoPath),
            downloadFile(post.audioUrl, tempAudioPath),
        ]);
        const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
        const ffmpegPath = ffmpegInstaller.path;
        // FFmpeg command mapping: strip video original audio and map background music
        const command = `"${ffmpegPath}" -i "${tempVideoPath}" -i "${tempAudioPath}" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -shortest -y "${outputPath}"`;
        console.log(`[Download] Running FFmpeg command: ${command}`);
        (0, child_process_1.exec)(command, (error, stdout, stderr) => {
            // Clean up inputs immediately after execution
            fsExtra.unlink(tempVideoPath, () => { });
            fsExtra.unlink(tempAudioPath, () => { });
            if (error) {
                console.error('[Download] FFmpeg merging failed:', error, stderr);
                // Fallback: Redirect to original video so the download doesn't fail completely
                return res.redirect(post.mediaUrl);
            }
            console.log('[Download] FFmpeg merge succeeded, streaming file to client');
            // Send the merged file to client and delete it after sending
            res.sendFile(outputPath, (sendErr) => {
                fsExtra.unlink(outputPath, () => { });
                if (sendErr) {
                    console.error('[Download] Error sending file to client:', sendErr);
                }
            });
        });
    }
    catch (err) {
        console.error('[Download] Server-side merge error:', err);
        // Fallback: Try redirecting to mediaUrl
        try {
            const post = await db_1.prisma.post.findUnique({ where: { id: postId } });
            if (post) {
                return res.redirect(post.mediaUrl);
            }
        }
        catch { }
        res.status(500).json({ error: err.message || 'Failed to download reel' });
    }
};
exports.downloadPostReel = downloadPostReel;
