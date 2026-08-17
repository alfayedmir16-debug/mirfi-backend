import { Response } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middleware/auth';

export const createPost = async (req: AuthRequest, res: Response) => {
  const { type, mediaUrl, thumbnailUrl, caption, category, hideLikes, hideShares, collabUserId, scheduledAt, visibility, textLayers, audioUrl, aspectRatio } = req.body;

  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  if (!type || !mediaUrl) {
    return res.status(400).json({ error: 'Post type and media URL are required.' });
  }

  try {
    // Limit check: Max 2 posts or reels per day (last 24 hours)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const postsTodayCount = await prisma.post.count({
      where: {
        userId: req.user.id,
        createdAt: { gte: twentyFourHoursAgo },
      },
    });

    if (postsTodayCount >= 2) {
      return res.status(400).json({ error: 'You can only create up to 2 posts or reels per day. Please try again tomorrow.' });
    }

    const isScheduled = !!scheduledAt;
    // Parse textLayers if it's a string
    let parsedTextLayers = null;
    if (textLayers) {
      try {
        parsedTextLayers = typeof textLayers === 'string' ? JSON.parse(textLayers) : textLayers;
      } catch { parsedTextLayers = null; }
    }

    const post = await prisma.post.create({
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
        aspectRatio: aspectRatio ? parseFloat(aspectRatio.toString()) : null,
      } as any,
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
        await prisma.$executeRawUnsafe(
          `UPDATE "Post" SET "textLayers" = $1::jsonb, "audioUrl" = $2 WHERE "id" = $3`,
          parsedTextLayers ? JSON.stringify(parsedTextLayers) : null,
          audioUrl || null,
          post.id
        );
      } catch (rawErr) {
        console.log('Raw update for textLayers/audioUrl skipped (columns may not exist yet):', rawErr);
      }
    }

    // Auto-extract sound for reels (TikTok-style original sounds)
    if (type === 'reel' && mediaUrl) {
      try {
        const creator = await prisma.user.findUnique({ where: { id: req.user.id }, select: { username: true } });
        const soundTitle = caption && caption.trim() ? caption.trim().substring(0, 50) : `Original Sound - @${creator?.username || 'user'}`;
        await (prisma as any).sound.create({
          data: {
            title: soundTitle,
            audioUrl: mediaUrl,
            creatorId: req.user.id,
            postId: (post as any).id,
            useCount: 1,
          },
        });
        // Link sound to post
        const sound = await (prisma as any).sound.findFirst({ where: { postId: (post as any).id } });
        if (sound) {
          await prisma.post.update({ where: { id: (post as any).id }, data: { soundId: sound.id } as any });
        }
      } catch {}
    }

    // Notify collab invitee
    if (collabUserId) {
      try {
        const { sendPushNotification } = await import('../utils/pushNotifications');
        const sender = await prisma.user.findUnique({ where: { id: req.user.id }, select: { username: true, displayName: true } });
        sendPushNotification(
          collabUserId,
          sender?.displayName || sender?.username || 'Someone',
          'invited you to collab on a post 🤝',
          { type: 'collab_invite', postId: (post as any).id }
        );
      } catch {}
    }

    res.status(201).json(post);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getFeed = async (req: AuthRequest, res: Response) => {
  const { limit = '10', cursor, tag } = req.query;

  try {
    const take = parseInt(limit as string);

    // get IDs the current user has blocked or is blocked by
    const blocks = await prisma.block.findMany({
      where: { OR: [{ blockerId: req.user!.id }, { blockedId: req.user!.id }] },
      select: { blockerId: true, blockedId: true },
    });
    const blockedIds = blocks.map(b => b.blockerId === req.user!.id ? b.blockedId : b.blockerId);

    const posts = await (prisma.post as any).findMany({
      where: {
        type: 'image',
        userId: { not: req.user!.id, notIn: blockedIds },
        isScheduled: false,
        visibility: { in: ['public', 'close_friends'] },
        ...(tag ? { caption: { contains: tag as string, mode: 'insensitive' } } : {})
      },
      take: take * 2,
      ...(cursor ? { skip: 1, cursor: { id: cursor as string } } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, username: true, displayName: true, profilePicture: true, isVerified: true, closeFriends: true } },
        collabUser: { select: { id: true, username: true, displayName: true, profilePicture: true } },
        likes: { select: { userId: true } },
        comments: { include: { user: { select: { username: true, profilePicture: true } } } }
      }
    });

    // Filter close_friends posts: only visible if viewer is in author's closeFriends (or is the author)
    const filteredPosts = posts.filter((p: any) => {
      if (p.userId === req.user!.id) return true;
      if (p.visibility === 'close_friends') {
        return p.user.closeFriends?.includes(req.user!.id);
      }
      return true;
    }).slice(0, take);

    const nextCursor = filteredPosts.length === take ? filteredPosts[filteredPosts.length - 1].id : null;

    res.status(200).json({
      posts: filteredPosts,
      nextCursor
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getReels = async (req: AuthRequest, res: Response) => {
  const { limit = '30', cursor } = req.query;

  try {
    const take = parseInt(limit as string, 10) || 30;

    const blocks = await prisma.block.findMany({
      where: { OR: [{ blockerId: req.user!.id }, { blockedId: req.user!.id }] },
      select: { blockerId: true, blockedId: true },
    });
    const blockedIds = blocks.map(b => b.blockerId === req.user!.id ? b.blockedId : b.blockerId);

    const reels = await (prisma.post as any).findMany({
      where: {
        type: { in: ['reel', 'Reel'] },
        userId: { notIn: blockedIds },
        isScheduled: false,
        visibility: { in: ['public', 'close_friends'] },
      },
      take: take * 2,
      ...(cursor ? { skip: 1, cursor: { id: cursor as string } } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, username: true, displayName: true, profilePicture: true, isVerified: true, closeFriends: true } },
        collabUser: { select: { id: true, username: true, displayName: true, profilePicture: true } },
        likes: { select: { userId: true } },
        saves: { select: { userId: true } },
        comments: { include: { user: { select: { username: true, profilePicture: true } } } }
      }
    });

    // Filter close_friends reels: only show if current user is in that user's close friends list
    const filteredReels = reels.filter((r: any) => {
      if (r.userId === req.user!.id) return true;
      if (r.visibility === 'close_friends') {
        return r.user.closeFriends?.includes(req.user!.id);
      }
      return true;
    }).slice(0, take);

    const nextCursor = filteredReels.length === take ? filteredReels[filteredReels.length - 1].id : null;

    res.status(200).json({
      reels: filteredReels,
      nextCursor
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const toggleLike = async (req: AuthRequest, res: Response) => {
  const { postId } = req.body;

  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const existingLike = await prisma.like.findUnique({
      where: {
        userId_postId: {
          userId: req.user.id,
          postId
        }
      }
    });

    if (existingLike) {
      await prisma.like.delete({
        where: {
          userId_postId: {
            userId: req.user.id,
            postId
          }
        }
      });
      return res.status(200).json({ liked: false });
    } else {
      const like = await prisma.like.create({
        data: {
          userId: req.user.id,
          postId
        }
      });

      // Create notification for post owner
      try {
        const post = await prisma.post.findUnique({ where: { id: postId }, select: { userId: true } });
        if (post && post.userId !== req.user.id) {
          await prisma.notification.create({
            data: {
              userId: post.userId,
              senderId: req.user.id,
              type: 'like',
              text: 'liked your post',
              postId,
            },
          });
          const { sendPushNotification } = await import('../utils/pushNotifications');
          const sender = await prisma.user.findUnique({ where: { id: req.user.id }, select: { username: true } });
          sendPushNotification(post.userId, sender?.username || 'Someone', 'liked your post', { type: 'like', postId, senderId: req.user.id });
        }
      } catch (notifErr) {
        console.error('Failed to create like notification:', notifErr);
      }

      return res.status(200).json({ liked: true });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getUserPosts = async (req: AuthRequest, res: Response) => {
  const userId = req.params.userId as string;
  const requesterId = req.user!.id;

  try {
    // Block check — either direction blocks access
    if (userId !== requesterId) {
      const block = await prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: requesterId, blockedId: userId },
            { blockerId: userId, blockedId: requesterId },
          ],
        },
      });
      if (block) return res.status(200).json([]);
    }

    const isOwner = userId === requesterId;
    const includeBlock = {
      user: { select: { id: true, username: true, displayName: true, profilePicture: true, isVerified: true } },
      collabUser: { select: { id: true, username: true, displayName: true, profilePicture: true } },
      likes: { select: { userId: true } },
    };

    const visibilityFilter = isOwner ? {} : { visibility: 'public', isScheduled: false };

    // own posts
    const ownPosts = await (prisma.post as any).findMany({
      where: { userId, ...visibilityFilter },
      orderBy: { createdAt: 'desc' },
      include: includeBlock,
    });
    // collab posts where this user accepted (only public for non-owners)
    const collabPosts = await (prisma.post as any).findMany({
      where: { collabUserId: userId, collabStatus: 'accepted', ...visibilityFilter },
      orderBy: { createdAt: 'desc' },
      include: includeBlock,
    });
    // merge + dedupe + sort
    const seen = new Set<string>();
    const all = [...ownPosts, ...collabPosts].filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const page = parseInt(req.query.page as string, 10);
    const limit = parseInt(req.query.limit as string, 10) || 18;

    if (page && page > 0) {
      const skip = (page - 1) * limit;
      const paginated = all.slice(skip, skip + limit);
      return res.status(200).json({
        posts: paginated,
        total: all.length,
        page,
        hasMore: skip + paginated.length < all.length,
      });
    }

    res.status(200).json(all);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Toggle save/unsave post
export const toggleSave = async (req: any, res: any) => {
  const { postId } = req.body;
  const userId = req.user.id;

  try {
    const existingSave = await prisma.save.findUnique({
      where: {
        userId_postId: {
          userId,
          postId,
        },
      },
    });

    if (existingSave) {
      await prisma.save.delete({
        where: {
          userId_postId: {
            userId,
            postId,
          },
        },
      });
      return res.status(200).json({ saved: false });
    } else {
      await prisma.save.create({
        data: {
          userId,
          postId,
        },
      });
      return res.status(200).json({ saved: true });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Fetch all saved posts for logged-in user with pagination support
export const getSavedPosts = async (req: any, res: any) => {
  const userId = req.user.id;
  const page = parseInt(req.query.page as string, 10);
  const limit = parseInt(req.query.limit as string, 10) || 18;

  try {
    if (page && page > 0) {
      const skip = (page - 1) * limit;
      const [saves, total] = await Promise.all([
        prisma.save.findMany({
          where: { userId },
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
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.save.count({ where: { userId } }),
      ]);
      const posts = saves.map(s => s.post).filter(Boolean);
      return res.status(200).json({
        posts,
        total,
        page,
        hasMore: skip + saves.length < total,
      });
    } else {
      const saves = await prisma.save.findMany({
        where: { userId },
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
        orderBy: { createdAt: "desc" },
      });
      return res.status(200).json(saves.map(s => s.post).filter(Boolean));
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Add comment to a post
export const addComment = async (req: any, res: any) => {
  const { postId, text } = req.body;
  const userId = req.user.id;

  if (!text) {
    return res.status(400).json({ error: "Comment text is required." });
  }

  try {
    const comment = await prisma.comment.create({
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
      const post = await prisma.post.findUnique({ where: { id: postId }, select: { userId: true } });
      if (post && post.userId !== userId) {
        const shortText = text.length > 80 ? text.substring(0, 80) + '...' : text;
        await prisma.notification.create({
          data: {
            userId: post.userId,
            senderId: userId,
            type: 'comment',
            text: `commented: "${shortText}"`,
            postId,
          },
        });
        const { sendPushNotification } = await import('../utils/pushNotifications');
        const sender = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
        sendPushNotification(post.userId, sender?.username || 'Someone', `commented: "${shortText}"`, { type: 'comment', postId, senderId: userId });
      }
    } catch (notifErr) {
      console.error('Failed to create comment notification:', notifErr);
    }

    res.status(201).json(comment);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Fetch comments for a specific post with pagination support
export const getComments = async (req: any, res: any) => {
  const { postId } = req.params;
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = parseInt(req.query.limit as string, 10) || 20;
  const skip = (page - 1) * limit;

  try {
    const [comments, total] = await Promise.all([
      prisma.comment.findMany({
        where: { postId },
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
        skip,
        take: limit,
      }),
      prisma.comment.count({ where: { postId } }),
    ]);

    // Return object if paginated, or raw list if legacy client asks for full list (page <= 0)
    if (req.query.page || req.query.limit) {
      return res.status(200).json({
        comments,
        total,
        page,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + comments.length < total,
      });
    }

    res.status(200).json(comments);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Fetch single post by ID
export const getPostById = async (req: any, res: any) => {
  const { postId } = req.params;
  const requesterId = req.user?.id;

  try {
    const post = await (prisma.post as any).findUnique({
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
        saves: { select: { userId: true } },
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
      const block = await prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: requesterId, blockedId: post.userId },
            { blockerId: post.userId, blockedId: requesterId },
          ],
        },
      });
      if (block) return res.status(403).json({ error: "Post not available" });

      // Track post view (dedup within 24h)
      try {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const existingView = await (prisma as any).postView.findFirst({
          where: { postId, userId: requesterId, createdAt: { gte: oneDayAgo } },
        });
        if (!existingView) {
          await prisma.$transaction([
            (prisma as any).postView.create({ data: { postId, userId: requesterId } }),
            (prisma as any).post.update({
              where: { id: postId },
              data: { viewCount: { increment: 1 } },
            }),
          ]);
        }
      } catch (viewErr) {
        // Silently ignore view tracking errors
      }
    }

    res.status(200).json(post);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updatePostSettings = async (req: AuthRequest, res: Response) => {
  const { postId, hideLikes, hideShares, visibility, scheduledAt, cancelSchedule } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    if (post.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden. You do not own this post.' });
    }

    const updateData: any = {};
    if (hideLikes !== undefined) updateData.hideLikes = hideLikes === true || hideLikes === 'true';
    if (hideShares !== undefined) updateData.hideShares = hideShares === true || hideShares === 'true';
    if (visibility !== undefined && ['public', 'private', 'unlisted'].includes(visibility)) {
      updateData.visibility = visibility;
    }
    if (cancelSchedule === true) {
      updateData.scheduledAt = null;
      updateData.isScheduled = false;
    } else if (scheduledAt !== undefined) {
      const d = new Date(scheduledAt);
      if (!isNaN(d.getTime())) {
        updateData.scheduledAt = d;
        updateData.isScheduled = true;
      }
    }

    const updated = await prisma.post.update({
      where: { id: postId },
      data: updateData
    });

    res.status(200).json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Collab: invited user accepts or declines
export const respondCollab = async (req: AuthRequest, res: Response) => {
  const { postId } = req.params;
  const { action } = req.body; // 'accept' | 'decline'
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const post = await (prisma.post as any).findUnique({ where: { id: postId } });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.collabUserId !== userId) return res.status(403).json({ error: 'Not the collab invitee' });
    if (post.collabStatus !== 'pending') return res.status(400).json({ error: 'Invite already responded' });

    const status = action === 'accept' ? 'accepted' : 'declined';
    const updated = await (prisma.post as any).update({
      where: { id: postId },
      data: { collabStatus: status },
      include: {
        user: { select: { id: true, username: true, displayName: true, profilePicture: true } },
        collabUser: { select: { id: true, username: true, displayName: true, profilePicture: true } },
      },
    });

    // Notify post owner
    const { sendPushNotification } = await import('../utils/pushNotifications');
    const invitee = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, displayName: true } });
    if (action === 'accept') {
      sendPushNotification(
        post.userId,
        invitee?.displayName || invitee?.username || 'Someone',
        'accepted your collab invite! 🎉',
        { type: 'collab_accepted', postId }
      );
    }

    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// Get pending collab invites for logged-in user
export const getPendingCollabInvites = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const invites = await (prisma.post as any).findMany({
      where: { collabUserId: userId, collabStatus: 'pending' },
      include: {
        user: { select: { id: true, username: true, displayName: true, profilePicture: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(invites);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const deletePost = async (req: AuthRequest, res: Response) => {
  const postId = req.params.postId as string;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    if (post.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden. You do not own this post.' });
    }

    // Delete media file from Cloudflare R2
    // BUT only if no sound is using this URL (sound should stay)
    const sound = await (prisma as any).sound.findFirst({ where: { postId } });
    if (!sound && post.mediaUrl) {
      // No sound linked — safe to delete the file
      try {
        const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
        const { r2Client } = await import('../utils/r2');
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
      } catch (r2Err) {
        console.warn('R2 delete failed (non-critical):', r2Err);
      }
    }
    // If sound exists, keep the file (others may use the sound)
    // But unlink the post from sound
    if (sound) {
      await (prisma as any).sound.update({ where: { id: sound.id }, data: { postId: null } }).catch(() => {});
    }

    await prisma.post.delete({ where: { id: postId } });

    res.status(200).json({ success: true, message: 'Post deleted successfully.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ─── Scheduler: Auto-publish scheduled posts every minute ───
export function startPostScheduler() {
  const INTERVAL_MS = 60 * 1000; // 1 minute

  const tick = async () => {
    try {
      const now = new Date();
      const duePosts = await (prisma.post as any).findMany({
        where: {
          isScheduled: true,
          scheduledAt: { lte: now },
        },
        select: { id: true, userId: true, caption: true },
      });

      if (duePosts.length > 0) {
        await (prisma.post as any).updateMany({
          where: {
            id: { in: duePosts.map((p: any) => p.id) },
          },
          data: {
            isScheduled: false,
            scheduledAt: null,
          },
        });
        console.log(`[Scheduler] Published ${duePosts.length} scheduled post(s)`);
      }
    } catch (e: any) {
      console.error('[Scheduler] Error publishing scheduled posts:', e.message);
    }
  };

  tick(); // run immediately on startup
  setInterval(tick, INTERVAL_MS);
  console.log('[Scheduler] Post scheduler started (1-minute interval)');
}

import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';

const downloadFile = (url: string, dest: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
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
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
};

export const downloadPostReel = async (req: any, res: any) => {
  const { postId } = req.params;

  try {
    const post = await prisma.post.findUnique({
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
    const videoExt = path.extname(new URL(post.mediaUrl).pathname) || '.mp4';
    const audioExt = path.extname(new URL(post.audioUrl).pathname) || '.mp3';

    const tempVideoPath = path.join(tempDir, `video_${postId}_${Date.now()}${videoExt}`);
    const tempAudioPath = path.join(tempDir, `audio_${postId}_${Date.now()}${audioExt}`);
    const outputPath = path.join(tempDir, `merged_${postId}_${Date.now()}.mp4`);

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

    exec(command, (error, stdout, stderr) => {
      // Clean up inputs immediately after execution
      fs.unlink(tempVideoPath, () => {});
      fs.unlink(tempAudioPath, () => {});

      if (error) {
        console.error('[Download] FFmpeg merging failed:', error, stderr);
        // Fallback: Redirect to original video so the download doesn't fail completely
        return res.redirect(post.mediaUrl);
      }

      console.log('[Download] FFmpeg merge succeeded, streaming file to client');

      // Send the merged file to client and delete it after sending
      res.sendFile(outputPath, (sendErr: any) => {
        fs.unlink(outputPath, () => {});
        if (sendErr) {
          console.error('[Download] Error sending file to client:', sendErr);
        }
      });
    });

  } catch (err: any) {
    console.error('[Download] Server-side merge error:', err);
    // Fallback: Try redirecting to mediaUrl
    try {
      const post = await prisma.post.findUnique({ where: { id: postId } });
      if (post) {
        return res.redirect(post.mediaUrl);
      }
    } catch {}
    res.status(500).json({ error: err.message || 'Failed to download reel' });
  }
};