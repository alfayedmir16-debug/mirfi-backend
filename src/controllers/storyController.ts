import prisma from "../config/db";

// Create a new 24h story
export const createStory = async (req: any, res: any) => {
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
    const story = await prisma.story.create({
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
      const mentionStickers = stickerData.filter((s: any) => s.type === 'mention');
      for (const sticker of mentionStickers) {
        if (sticker.userId && sticker.userId !== userId) {
          try {
            await prisma.notification.create({
              data: {
                userId: sticker.userId,
                senderId: userId,
                type: "story_mention",
                storyId: story.id,
                text: "mentioned you in their story",
              },
            });
            const { sendPushNotification } = await import('../utils/pushNotifications');
            const sender = await prisma.user.findUnique({ 
              where: { id: userId }, 
              select: { username: true } 
            });
            sendPushNotification(sticker.userId, sender?.username || 'Someone', 'mentioned you in their story', { 
              type: 'story_mention', 
              storyId: story.id,
              senderId: userId 
            });
          } catch (notifErr) {
            console.error("Failed to create mention notification:", notifErr);
          }
        }
      }
    }

    console.log("=== Story Created ===");
    console.log("Hosted at:", mediaUrl);
    console.log("=====================");

    res.json(story);
  } catch (e: any) {
    console.error("Create Story Error:", e);
    res.status(500).json({ error: e.message || "Failed to create story" });
  }
};

// Retrieve active stories grouped by user for the home feed
export const getStoryFeed = async (req: any, res: any) => {
  try {
    const userId = req.user.id;

    // Get list of users the logged-in user follows
    const following = await prisma.follow.findMany({
      where: {
        followerId: userId,
        status: "accepted",
      },
      select: {
        followingId: true,
      },
    });

    // Get blocked user IDs in either direction
    const blocks = await prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    const blockedIds = blocks.map(b => b.blockerId === userId ? b.blockedId : b.blockerId);

    const userIdsToFetch = [userId, ...following.map(f => f.followingId).filter(id => !blockedIds.includes(id))];

    // Fetch active unexpired stories
    const activeStories = await prisma.story.findMany({
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
            hiddenStoryFrom: true,
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    // Filter: close_friends stories only visible to author's closeFriends list
    // Filter: hiddenStoryFrom — if story owner hid stories from current user, exclude
    const visibleStories = activeStories.filter(story => {
      // Check if story owner has hidden stories from the current viewer
      if ((story.user as any).hiddenStoryFrom?.includes(userId) && story.userId !== userId) {
        return false;
      }
      if (story.audience === 'close_friends') {
        return story.user.closeFriends?.includes(userId) || story.userId === userId;
      }
      return true;
    });

    // Group stories by User just like Instagram!
    const groupedStoriesMap: { [userId: string]: any } = {};

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
    const userReactions = await prisma.storyReaction.findMany({
      where: { storyId: { in: activeStories.map(s => s.id) }, userId },
      select: { storyId: true, emoji: true },
    });
    const userReactionMap = Object.fromEntries(userReactions.map(r => [r.storyId, r.emoji]));

    const storiesWithCounts = await Promise.all(
      groupedFeed.map(async (userGroup: any) => {
        const storyIds = userGroup.stories.map((s: any) => s.id);
        
        const viewsPerStory = await prisma.storyView.groupBy({
          by: ['storyId'],
          where: {
            storyId: { in: storyIds },
          },
          _count: true,
        });
        
        const reactionsPerStory = await prisma.storyReaction.groupBy({
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
          stories: userGroup.stories.map((story: any) => ({
            ...story,
            viewCount: viewsMap[story.id] || 0,
            reactionCount: reactionsMap[story.id] || 0,
            userReaction: userReactionMap[story.id] || null,
          }))
        };
      })
    );

    res.json(storiesWithCounts);
  } catch (e: any) {
    console.error("Get Story Feed Error:", e);
    res.status(500).json({ error: e.message || "Failed to retrieve story feed" });
  }
};

// Get active stories for a specific user (profile page viewing)
export const getUserStories = async (req: any, res: any) => {
  try {
    const requesterId = req.user.id;
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, displayName: true, profilePicture: true, isPrivate: true, hiddenStoryFrom: true },
    });

    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // If target user has hidden stories from the requester, return empty
    if (userId !== requesterId && (targetUser as any).hiddenStoryFrom?.includes(requesterId)) {
      return res.json({ stories: [] });
    }

    // Block check — either direction means no stories shown
    if (userId !== requesterId) {
      const block = await prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: requesterId, blockedId: userId },
            { blockerId: userId, blockedId: requesterId },
          ],
        },
      });
      if (block) return res.json([]);
    }

    // If private account, only return stories if requester is following or is the owner
    if (targetUser.isPrivate && userId !== requesterId) {
      const follow = await prisma.follow.findFirst({
        where: { followerId: requesterId, followingId: userId, status: "accepted" },
      });
      if (!follow) {
        return res.json([]); // Empty = no story ring shown
      }
    }

    const stories = await prisma.story.findMany({
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
    const visibleStories = stories.filter((s: any) => {
      if (s.audience === 'close_friends') {
        return s.user?.closeFriends?.includes(requesterId) || userId === requesterId;
      }
      return true;
    });

    // Add view/reaction counts + current user's reaction
    const storyIds = visibleStories.map((s: any) => s.id);
    const [views, reactions] = await Promise.all([
      prisma.storyView.groupBy({ by: ["storyId"], where: { storyId: { in: storyIds } }, _count: true }),
      prisma.storyReaction.groupBy({ by: ["storyId"], where: { storyId: { in: storyIds } }, _count: true }),
    ]);
    const viewsMap = Object.fromEntries(views.map((v: any) => [v.storyId, v._count]));
    const reactionsMap = Object.fromEntries(reactions.map((r: any) => [r.storyId, r._count]));

    const userReactions = await prisma.storyReaction.findMany({
      where: { storyId: { in: storyIds }, userId: requesterId },
      select: { storyId: true, emoji: true },
    });
    const userReactionMap = Object.fromEntries(userReactions.map((r: any) => [r.storyId, r.emoji]));

    res.json({
      user: targetUser,
      stories: visibleStories.map((s: any) => ({
        ...s,
        viewCount: viewsMap[s.id] || 0,
        reactionCount: reactionsMap[s.id] || 0,
        userReaction: userReactionMap[s.id] || null,
      })),
    });
  } catch (e: any) {
    console.error("Get User Stories Error:", e);
    res.status(500).json({ error: e.message || "Failed to get user stories" });
  }
};

// Track a story view
export const viewStory = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { storyId } = req.params;

    if (!storyId) {
      return res.status(400).json({ error: "Story ID is required" });
    }

    const story = await prisma.story.findUnique({
      where: { id: storyId },
      include: { user: true },
    });

    if (!story) {
      return res.status(404).json({ error: "Story not found" });
    }

    // Check if story owner has hidden stories from this viewer
    if (story.userId !== userId) {
      const storyOwner = await prisma.user.findUnique({
        where: { id: story.userId },
        select: { hiddenStoryFrom: true },
      });
      if ((storyOwner as any)?.hiddenStoryFrom?.includes(userId)) {
        return res.status(403).json({ error: "Story not available" });
      }
    }

    if (story.expiresAt < new Date()) {
      return res.status(410).json({ error: "Story has expired" });
    }

    // Don't count view from story owner (viewing own story = no view)
    if (story.userId !== userId) {
      const existingView = await prisma.storyView.findFirst({
        where: { storyId, userId },
      });

      if (!existingView) {
        await prisma.storyView.create({
          data: { storyId, userId },
        });
      }
    }

    res.json({ success: true });
  } catch (e: any) {
    console.error("View Story Error:", e);
    res.status(500).json({ error: e.message || "Failed to track story view" });
  }
};

// React to a story with an emoji
export const reactToStory = async (req: any, res: any) => {
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

    const story = await prisma.story.findUnique({
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
    const existingReaction = await prisma.storyReaction.findFirst({
      where: { storyId, userId },
    });

    if (existingReaction) {
      if (existingReaction.emoji === emoji) {
        // Same emoji → toggle off (remove)
        await prisma.storyReaction.delete({ where: { id: existingReaction.id } });
        return res.json({ reacted: false, emoji: null, message: "Reaction removed" });
      }
      // Different emoji → update
      await prisma.storyReaction.update({ where: { id: existingReaction.id }, data: { emoji } });
    } else {
      await prisma.storyReaction.create({ data: { storyId, userId, emoji } });
    }
    
    // Create notification for story owner
    if (story.userId !== userId) {
      try {
        await prisma.notification.create({
          data: {
            userId: story.userId,
            senderId: userId,
            type: "story_reaction",
            storyId: story.id,
            text: `reacted to your story with ${emoji}`,
          },
        });
        
        const { sendPushNotification } = await import('../utils/pushNotifications');
        const sender = await prisma.user.findUnique({ 
          where: { id: userId }, 
          select: { username: true, displayName: true } 
        });
        const senderName = sender?.username || sender?.displayName || 'Someone';
        sendPushNotification(story.userId, senderName, `reacted to your story with ${emoji}`, { 
          type: 'story_reaction', 
          storyId: story.id,
          senderId: userId 
        });
      } catch (notifErr) {
        console.error("Failed to create story reaction notification:", notifErr);
      }
    }
    
    res.json({ reacted: true, emoji, message: "Reaction added" });
  } catch (e: any) {
    console.error("React To Story Error:", e);
    res.status(500).json({ error: e.message || "Failed to react to story" });
  }
};

// Comment on a story
export const commentOnStory = async (req: any, res: any) => {
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

    const story = await prisma.story.findUnique({
      where: { id: storyId },
      include: { user: true },
    });

    if (!story) {
      return res.status(404).json({ error: "Story not found" });
    }

    if (story.expiresAt < new Date()) {
      return res.status(410).json({ error: "Story has expired" });
    }

    const comment = await prisma.storyComment.create({
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
        await prisma.notification.create({
          data: {
            userId: story.userId,
            senderId: userId,
            type: "story_comment",
            storyId: story.id,
            text: `commented on your story`,
          },
        });
        
        const { sendPushNotification } = await import('../utils/pushNotifications');
        const sender = await prisma.user.findUnique({ 
          where: { id: userId }, 
          select: { username: true, displayName: true } 
        });
        const senderName = sender?.username || sender?.displayName || 'Someone';
        sendPushNotification(story.userId, senderName, `commented on your story`, { 
          type: 'story_comment', 
          storyId: story.id,
          senderId: userId 
        });
      } catch (notifErr) {
        console.error("Failed to create story comment notification:", notifErr);
      }
    }

    res.json(comment);
  } catch (e: any) {
    console.error("Comment On Story Error:", e);
    res.status(500).json({ error: e.message || "Failed to comment on story" });
  }
};

// Get story activity (views and comments) - for story owner only
export const getStoryActivity = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { storyId } = req.params;

    if (!storyId) {
      return res.status(400).json({ error: "Story ID is required" });
    }

    const story = await prisma.story.findUnique({
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
    const viewers = await prisma.storyView.findMany({
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
    const comments = await prisma.storyComment.findMany({
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
    const reactions = await prisma.storyReaction.findMany({
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

    const reactionCounts = reactions.reduce((acc: any, reaction: any) => {
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
  } catch (e: any) {
    console.error("Get Story Activity Error:", e);
    res.status(500).json({ error: e.message || "Failed to get story activity" });
  }
};

// Delete a story
export const deleteStory = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { storyId } = req.params;

    if (!storyId) {
      return res.status(400).json({ error: "Story ID is required" });
    }

    const story = await prisma.story.findUnique({
      where: { id: storyId },
    });

    if (!story) {
      return res.status(404).json({ error: "Story not found" });
    }

    // Check if user owns this story
    if (story.userId !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Delete from Cloudflare R2 if the media URL is from R2
    if (story.mediaUrl && story.mediaUrl.includes('r2.cloudflarestorage.com') || story.mediaUrl?.includes(process.env.CLOUDFLARE_R2_PUBLIC_URL || 'pub-')) {
      try {
        const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
        const { r2Client } = await import('../utils/r2');
        // Extract key from URL — format: https://domain/bucket/key or https://pub-xxx.r2.dev/key
        const url = new URL(story.mediaUrl);
        const key = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
        // Remove bucket name prefix if present
        const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'mirfi-media';
        const objectKey = key.startsWith(bucketName + '/') ? key.slice(bucketName.length + 1) : key;

        await r2Client.send(new DeleteObjectCommand({
          Bucket: bucketName,
          Key: objectKey,
        }));
        console.log(`[R2] Deleted story media: ${objectKey}`);
      } catch (r2Err) {
        console.warn('[R2] Failed to delete media (non-blocking):', r2Err);
        // Don't fail the story deletion if R2 cleanup fails
      }
    }

    // Delete related records first
    await prisma.storyView.deleteMany({ where: { storyId } });
    await prisma.storyReaction.deleteMany({ where: { storyId } });
    await prisma.storyComment.deleteMany({ where: { storyId } });
    await prisma.storyPollVote.deleteMany({ where: { storyId } });

    // Delete the story
    await prisma.story.delete({
      where: { id: storyId },
    });

    res.json({ success: true, message: "Story deleted successfully" });
  } catch (e: any) {
    console.error("Delete Story Error:", e);
    res.status(500).json({ error: e.message || "Failed to delete story" });
  }
};

// Vote on a story poll
export const voteStoryPoll = async (req: any, res: any) => {
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

    const story = await prisma.story.findUnique({
      where: { id: storyId },
    });

    if (!story) {
      return res.status(404).json({ error: "Story not found" });
    }

    if (story.expiresAt < new Date()) {
      return res.status(410).json({ error: "Story has expired" });
    }

    // Check if user already voted
    const existingVote = await prisma.storyPollVote.findUnique({
      where: {
        storyId_userId: {
          storyId,
          userId,
        },
      },
    });

    if (existingVote) {
      // Update vote option
      await prisma.storyPollVote.update({
        where: { id: existingVote.id },
        data: { option },
      });
      res.json({ voted: true, option, message: "Vote updated" });
    } else {
      await prisma.storyPollVote.create({
        data: {
          storyId,
          userId,
          option,
        },
      });
      res.json({ voted: true, option, message: "Vote recorded" });
    }
  } catch (e: any) {
    console.error("Vote Story Poll Error:", e);
    res.status(500).json({ error: e.message || "Failed to vote on story poll" });
  }
};
