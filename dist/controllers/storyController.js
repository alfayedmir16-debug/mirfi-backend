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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.voteStoryPoll = exports.deleteStory = exports.getStoryActivity = exports.commentOnStory = exports.reactToStory = exports.viewStory = exports.getUserStories = exports.getStoryFeed = exports.createStory = void 0;
const db_1 = __importDefault(require("../config/db"));
// Create a new 24h story
const createStory = async (req, res) => {
    try {
        const userId = req.user.id;
        const { mediaUrl, stickerData, frameData, audience } = req.body;
        if (!mediaUrl) {
            return res.status(400).json({ error: "No media URL provided" });
        }
        // Set 24h expiration
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);
        // Save in Neon PostgreSQL Database
        const story = await db_1.default.story.create({
            data: {
                userId,
                mediaUrl,
                audience: audience || "everyone",
                stickerData: stickerData || undefined,
                frameData: frameData || undefined,
                expiresAt,
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
        // Process @mention stickers -> create notifications + push
        if (stickerData && Array.isArray(stickerData)) {
            const mentionStickers = stickerData.filter((s) => s.type === 'mention');
            for (const sticker of mentionStickers) {
                if (sticker.userId && sticker.userId !== userId) {
                    try {
                        await db_1.default.notification.create({
                            data: {
                                userId: sticker.userId,
                                senderId: userId,
                                type: "story_mention",
                                storyId: story.id,
                                text: "mentioned you in their story",
                            },
                        });
                        const { sendPushNotification } = await Promise.resolve().then(() => __importStar(require('../utils/pushNotifications')));
                        const sender = await db_1.default.user.findUnique({
                            where: { id: userId },
                            select: { username: true }
                        });
                        sendPushNotification(sticker.userId, sender?.username || 'Someone', 'mentioned you in their story', {
                            type: 'story_mention',
                            storyId: story.id,
                            senderId: userId
                        });
                    }
                    catch (notifErr) {
                        console.error("Failed to create mention notification:", notifErr);
                    }
                }
            }
        }
        console.log("=== Story Created ===");
        console.log("Hosted at:", mediaUrl);
        console.log("=====================");
        res.json(story);
    }
    catch (e) {
        console.error("Create Story Error:", e);
        res.status(500).json({ error: e.message || "Failed to create story" });
    }
};
exports.createStory = createStory;
// Retrieve active stories grouped by user for the home feed
const getStoryFeed = async (req, res) => {
    try {
        const userId = req.user.id;
        // Get list of users the logged-in user follows
        const following = await db_1.default.follow.findMany({
            where: {
                followerId: userId,
                status: "accepted",
            },
            select: {
                followingId: true,
            },
        });
        // Get blocked user IDs in either direction
        const blocks = await db_1.default.block.findMany({
            where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
            select: { blockerId: true, blockedId: true },
        });
        const blockedIds = blocks.map(b => b.blockerId === userId ? b.blockedId : b.blockerId);
        const userIdsToFetch = [userId, ...following.map(f => f.followingId).filter(id => !blockedIds.includes(id))];
        // Fetch active unexpired stories
        const activeStories = await db_1.default.story.findMany({
            where: {
                userId: { in: userIdsToFetch },
                expiresAt: { gt: new Date() },
            },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        displayName: true,
                        profilePicture: true,
                        closeFriends: true,
                    },
                },
            },
            orderBy: {
                createdAt: "asc",
            },
        });
        // Filter: close_friends stories only visible to author's closeFriends list
        const visibleStories = activeStories.filter(story => {
            if (story.audience === 'close_friends') {
                return story.user.closeFriends?.includes(userId) || story.userId === userId;
            }
            return true;
        });
        // Group stories by User just like Instagram!
        const groupedStoriesMap = {};
        visibleStories.forEach(story => {
            const user = story.user;
            if (!groupedStoriesMap[user.id]) {
                groupedStoriesMap[user.id] = {
                    user,
                    stories: [],
                };
            }
            groupedStoriesMap[user.id].stories.push({
                id: story.id,
                mediaUrl: story.mediaUrl,
                audience: story.audience,
                stickerData: story.stickerData,
                createdAt: story.createdAt,
                expiresAt: story.expiresAt,
            });
        });
        // Convert map to array
        const groupedFeed = Object.values(groupedStoriesMap);
        // Add view and reaction counts for each story + current user's reaction
        const userReactions = await db_1.default.storyReaction.findMany({
            where: { storyId: { in: activeStories.map(s => s.id) }, userId },
            select: { storyId: true, emoji: true },
        });
        const userReactionMap = Object.fromEntries(userReactions.map(r => [r.storyId, r.emoji]));
        const storiesWithCounts = await Promise.all(groupedFeed.map(async (userGroup) => {
            const storyIds = userGroup.stories.map((s) => s.id);
            const viewsPerStory = await db_1.default.storyView.groupBy({
                by: ['storyId'],
                where: {
                    storyId: { in: storyIds },
                },
                _count: true,
            });
            const reactionsPerStory = await db_1.default.storyReaction.groupBy({
                by: ['storyId'],
                where: {
                    storyId: { in: storyIds },
                },
                _count: true,
            });
            const viewsMap = Object.fromEntries(viewsPerStory.map(v => [v.storyId, v._count]));
            const reactionsMap = Object.fromEntries(reactionsPerStory.map(r => [r.storyId, r._count]));
            return {
                ...userGroup,
                stories: userGroup.stories.map((story) => ({
                    ...story,
                    viewCount: viewsMap[story.id] || 0,
                    reactionCount: reactionsMap[story.id] || 0,
                    userReaction: userReactionMap[story.id] || null,
                }))
            };
        }));
        res.json(storiesWithCounts);
    }
    catch (e) {
        console.error("Get Story Feed Error:", e);
        res.status(500).json({ error: e.message || "Failed to retrieve story feed" });
    }
};
exports.getStoryFeed = getStoryFeed;
// Get active stories for a specific user (profile page viewing)
const getUserStories = async (req, res) => {
    try {
        const requesterId = req.user.id;
        const { userId } = req.params;
        if (!userId) {
            return res.status(400).json({ error: "User ID is required" });
        }
        const targetUser = await db_1.default.user.findUnique({
            where: { id: userId },
            select: { id: true, username: true, displayName: true, profilePicture: true, isPrivate: true },
        });
        if (!targetUser) {
            return res.status(404).json({ error: "User not found" });
        }
        // Block check — either direction means no stories shown
        if (userId !== requesterId) {
            const block = await db_1.default.block.findFirst({
                where: {
                    OR: [
                        { blockerId: requesterId, blockedId: userId },
                        { blockerId: userId, blockedId: requesterId },
                    ],
                },
            });
            if (block)
                return res.json([]);
        }
        // If private account, only return stories if requester is following or is the owner
        if (targetUser.isPrivate && userId !== requesterId) {
            const follow = await db_1.default.follow.findFirst({
                where: { followerId: requesterId, followingId: userId, status: "accepted" },
            });
            if (!follow) {
                return res.json([]); // Empty = no story ring shown
            }
        }
        const stories = await db_1.default.story.findMany({
            where: {
                userId,
                expiresAt: { gt: new Date() },
            },
            include: {
                user: {
                    select: {
                        id: true,
                        closeFriends: true,
                    },
                },
            },
            orderBy: { createdAt: "asc" },
        });
        // Filter close_friends stories — only visible if requester is in author's closeFriends or is the author
        const visibleStories = stories.filter((s) => {
            if (s.audience === 'close_friends') {
                return s.user?.closeFriends?.includes(requesterId) || userId === requesterId;
            }
            return true;
        });
        // Add view/reaction counts + current user's reaction
        const storyIds = visibleStories.map((s) => s.id);
        const [views, reactions] = await Promise.all([
            db_1.default.storyView.groupBy({ by: ["storyId"], where: { storyId: { in: storyIds } }, _count: true }),
            db_1.default.storyReaction.groupBy({ by: ["storyId"], where: { storyId: { in: storyIds } }, _count: true }),
        ]);
        const viewsMap = Object.fromEntries(views.map((v) => [v.storyId, v._count]));
        const reactionsMap = Object.fromEntries(reactions.map((r) => [r.storyId, r._count]));
        const userReactions = await db_1.default.storyReaction.findMany({
            where: { storyId: { in: storyIds }, userId: requesterId },
            select: { storyId: true, emoji: true },
        });
        const userReactionMap = Object.fromEntries(userReactions.map((r) => [r.storyId, r.emoji]));
        res.json({
            user: targetUser,
            stories: visibleStories.map((s) => ({
                ...s,
                viewCount: viewsMap[s.id] || 0,
                reactionCount: reactionsMap[s.id] || 0,
                userReaction: userReactionMap[s.id] || null,
            })),
        });
    }
    catch (e) {
        console.error("Get User Stories Error:", e);
        res.status(500).json({ error: e.message || "Failed to get user stories" });
    }
};
exports.getUserStories = getUserStories;
// Track a story view
const viewStory = async (req, res) => {
    try {
        const userId = req.user.id;
        const { storyId } = req.params;
        if (!storyId) {
            return res.status(400).json({ error: "Story ID is required" });
        }
        const story = await db_1.default.story.findUnique({
            where: { id: storyId },
            include: { user: true },
        });
        if (!story) {
            return res.status(404).json({ error: "Story not found" });
        }
        if (story.expiresAt < new Date()) {
            return res.status(410).json({ error: "Story has expired" });
        }
        // Don't count view from story owner (viewing own story = no view)
        if (story.userId !== userId) {
            const existingView = await db_1.default.storyView.findFirst({
                where: { storyId, userId },
            });
            if (!existingView) {
                await db_1.default.storyView.create({
                    data: { storyId, userId },
                });
            }
        }
        res.json({ success: true });
    }
    catch (e) {
        console.error("View Story Error:", e);
        res.status(500).json({ error: e.message || "Failed to track story view" });
    }
};
exports.viewStory = viewStory;
// React to a story with an emoji
const reactToStory = async (req, res) => {
    try {
        const userId = req.user.id;
        const { storyId } = req.params;
        const { emoji } = req.body;
        if (!storyId) {
            return res.status(400).json({ error: "Story ID is required" });
        }
        if (!emoji) {
            return res.status(400).json({ error: "Emoji is required" });
        }
        const story = await db_1.default.story.findUnique({
            where: { id: storyId },
            include: { user: true },
        });
        if (!story) {
            return res.status(404).json({ error: "Story not found" });
        }
        if (story.expiresAt < new Date()) {
            return res.status(410).json({ error: "Story has expired" });
        }
        // One reaction per user per story — check by compound key
        const existingReaction = await db_1.default.storyReaction.findFirst({
            where: { storyId, userId },
        });
        if (existingReaction) {
            if (existingReaction.emoji === emoji) {
                // Same emoji → toggle off (remove)
                await db_1.default.storyReaction.delete({ where: { id: existingReaction.id } });
                return res.json({ reacted: false, emoji: null, message: "Reaction removed" });
            }
            // Different emoji → update
            await db_1.default.storyReaction.update({ where: { id: existingReaction.id }, data: { emoji } });
        }
        else {
            await db_1.default.storyReaction.create({ data: { storyId, userId, emoji } });
        }
        // Create notification for story owner
        if (story.userId !== userId) {
            try {
                await db_1.default.notification.create({
                    data: {
                        userId: story.userId,
                        senderId: userId,
                        type: "story_reaction",
                        storyId: story.id,
                        text: `reacted to your story with ${emoji}`,
                    },
                });
                const { sendPushNotification } = await Promise.resolve().then(() => __importStar(require('../utils/pushNotifications')));
                const sender = await db_1.default.user.findUnique({
                    where: { id: userId },
                    select: { username: true, displayName: true }
                });
                const senderName = sender?.username || sender?.displayName || 'Someone';
                sendPushNotification(story.userId, senderName, `reacted to your story with ${emoji}`, {
                    type: 'story_reaction',
                    storyId: story.id,
                    senderId: userId
                });
            }
            catch (notifErr) {
                console.error("Failed to create story reaction notification:", notifErr);
            }
        }
        res.json({ reacted: true, emoji, message: "Reaction added" });
    }
    catch (e) {
        console.error("React To Story Error:", e);
        res.status(500).json({ error: e.message || "Failed to react to story" });
    }
};
exports.reactToStory = reactToStory;
// Comment on a story
const commentOnStory = async (req, res) => {
    try {
        const userId = req.user.id;
        const { storyId } = req.params;
        const { text } = req.body;
        if (!storyId) {
            return res.status(400).json({ error: "Story ID is required" });
        }
        if (!text || !text.trim()) {
            return res.status(400).json({ error: "Comment text is required" });
        }
        const story = await db_1.default.story.findUnique({
            where: { id: storyId },
            include: { user: true },
        });
        if (!story) {
            return res.status(404).json({ error: "Story not found" });
        }
        if (story.expiresAt < new Date()) {
            return res.status(410).json({ error: "Story has expired" });
        }
        const comment = await db_1.default.storyComment.create({
            data: {
                storyId,
                userId,
                text: text.trim(),
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
        // Create notification for story owner
        if (story.userId !== userId) {
            try {
                await db_1.default.notification.create({
                    data: {
                        userId: story.userId,
                        senderId: userId,
                        type: "story_comment",
                        storyId: story.id,
                        text: `commented on your story`,
                    },
                });
                const { sendPushNotification } = await Promise.resolve().then(() => __importStar(require('../utils/pushNotifications')));
                const sender = await db_1.default.user.findUnique({
                    where: { id: userId },
                    select: { username: true, displayName: true }
                });
                const senderName = sender?.username || sender?.displayName || 'Someone';
                sendPushNotification(story.userId, senderName, `commented on your story`, {
                    type: 'story_comment',
                    storyId: story.id,
                    senderId: userId
                });
            }
            catch (notifErr) {
                console.error("Failed to create story comment notification:", notifErr);
            }
        }
        res.json(comment);
    }
    catch (e) {
        console.error("Comment On Story Error:", e);
        res.status(500).json({ error: e.message || "Failed to comment on story" });
    }
};
exports.commentOnStory = commentOnStory;
// Get story activity (views and comments) - for story owner only
const getStoryActivity = async (req, res) => {
    try {
        const userId = req.user.id;
        const { storyId } = req.params;
        if (!storyId) {
            return res.status(400).json({ error: "Story ID is required" });
        }
        const story = await db_1.default.story.findUnique({
            where: { id: storyId },
            include: { user: true },
        });
        if (!story) {
            return res.status(404).json({ error: "Story not found" });
        }
        if (story.expiresAt < new Date()) {
            return res.status(410).json({ error: "Story has expired" });
        }
        // Check if user owns this story
        if (story.userId !== userId) {
            return res.status(403).json({ error: "Unauthorized" });
        }
        // Get viewers (last 50)
        const viewers = await db_1.default.storyView.findMany({
            where: { storyId },
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
            orderBy: { createdAt: "desc" },
            take: 50,
        });
        // Get comments
        const comments = await db_1.default.storyComment.findMany({
            where: { storyId },
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
            orderBy: { createdAt: "asc" },
        });
        // Get reactions with user info
        const reactions = await db_1.default.storyReaction.findMany({
            where: { storyId },
            select: {
                emoji: true,
                userId: true,
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
        const reactionCounts = reactions.reduce((acc, reaction) => {
            acc[reaction.emoji] = (acc[reaction.emoji] || 0) + 1;
            return acc;
        }, {});
        res.json({
            story,
            viewers,
            comments,
            reactions,
            reactionCounts,
        });
    }
    catch (e) {
        console.error("Get Story Activity Error:", e);
        res.status(500).json({ error: e.message || "Failed to get story activity" });
    }
};
exports.getStoryActivity = getStoryActivity;
// Delete a story
const deleteStory = async (req, res) => {
    try {
        const userId = req.user.id;
        const { storyId } = req.params;
        if (!storyId) {
            return res.status(400).json({ error: "Story ID is required" });
        }
        const story = await db_1.default.story.findUnique({
            where: { id: storyId },
        });
        if (!story) {
            return res.status(404).json({ error: "Story not found" });
        }
        // Check if user owns this story
        if (story.userId !== userId) {
            return res.status(403).json({ error: "Unauthorized" });
        }
        // Delete related records first (due to cascade, this might not be needed but safe)
        await db_1.default.storyView.deleteMany({ where: { storyId } });
        await db_1.default.storyReaction.deleteMany({ where: { storyId } });
        await db_1.default.storyComment.deleteMany({ where: { storyId } });
        // Delete the story
        await db_1.default.story.delete({
            where: { id: storyId },
        });
        res.json({ success: true, message: "Story deleted successfully" });
    }
    catch (e) {
        console.error("Delete Story Error:", e);
        res.status(500).json({ error: e.message || "Failed to delete story" });
    }
};
exports.deleteStory = deleteStory;
// Vote on a story poll
const voteStoryPoll = async (req, res) => {
    try {
        const userId = req.user.id;
        const { storyId } = req.params;
        const { option } = req.body;
        if (!storyId) {
            return res.status(400).json({ error: "Story ID is required" });
        }
        if (option !== 0 && option !== 1) {
            return res.status(400).json({ error: "Option must be 0 or 1" });
        }
        const story = await db_1.default.story.findUnique({
            where: { id: storyId },
        });
        if (!story) {
            return res.status(404).json({ error: "Story not found" });
        }
        if (story.expiresAt < new Date()) {
            return res.status(410).json({ error: "Story has expired" });
        }
        // Check if user already voted
        const existingVote = await db_1.default.storyPollVote.findUnique({
            where: {
                storyId_userId: {
                    storyId,
                    userId,
                },
            },
        });
        if (existingVote) {
            // Update vote option
            await db_1.default.storyPollVote.update({
                where: { id: existingVote.id },
                data: { option },
            });
            res.json({ voted: true, option, message: "Vote updated" });
        }
        else {
            await db_1.default.storyPollVote.create({
                data: {
                    storyId,
                    userId,
                    option,
                },
            });
            res.json({ voted: true, option, message: "Vote recorded" });
        }
    }
    catch (e) {
        console.error("Vote Story Poll Error:", e);
        res.status(500).json({ error: e.message || "Failed to vote on story poll" });
    }
};
exports.voteStoryPoll = voteStoryPoll;
