import { Response } from 'express';
import { prisma } from '../db';
import { AuthRequest } from '../middleware/auth';

// ─── Get Comments with filtering + nested replies ───
export const getPostComments = async (req: AuthRequest, res: Response) => {
  const { postId } = req.params;
  const { sort = 'top' } = req.query; // 'top' | 'newest'

  try {
    const orderBy = sort === 'newest'
      ? { createdAt: 'desc' as const }
      : [{ isPinned: 'desc' as const }, { createdAt: 'desc' as const }];

    // Fetch top-level comments (no parentId)
    const comments = await (prisma.comment as any).findMany({
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
      comments.sort((a: any, b: any) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return (b.likes?.length || 0) - (a.likes?.length || 0);
      });
    }

    res.status(200).json(comments);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ─── Add Comment (supports replies + GIFs) ───
export const addCommentV2 = async (req: AuthRequest, res: Response) => {
  const { postId, text, parentId, type } = req.body;
  const userId = req.user!.id;

  if (!text) return res.status(400).json({ error: 'Comment text is required.' });

  try {
    const comment = await (prisma.comment as any).create({
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
      const post = await prisma.post.findUnique({ where: { id: postId }, select: { userId: true } });
      if (post && post.userId !== userId) {
        const shortText = type === 'gif' ? 'sent a GIF' : (text.length > 60 ? text.substring(0, 60) + '...' : text);
        await prisma.notification.create({
          data: { userId: post.userId, senderId: userId, type: 'comment', text: `commented: "${shortText}"`, postId },
        });
        const { sendPushNotification } = await import('../utils/pushNotifications');
        const sender = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
        sendPushNotification(post.userId, sender?.username || 'Someone', `commented: "${shortText}"`, { type: 'comment', postId, senderId: userId });
      }
    } catch {}

    // If reply, notify parent comment owner
    if (parentId) {
      try {
        const parentComment = await prisma.comment.findUnique({ where: { id: parentId }, select: { userId: true } });
        if (parentComment && parentComment.userId !== userId) {
          const sender = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
          await prisma.notification.create({
            data: { userId: parentComment.userId, senderId: userId, type: 'comment', text: `replied to your comment`, postId },
          });
        }
      } catch {}
    }

    res.status(201).json(comment);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ─── Toggle Comment Like ───
export const toggleCommentLike = async (req: AuthRequest, res: Response) => {
  const { commentId } = req.body;
  const userId = req.user!.id;

  if (!commentId) return res.status(400).json({ error: 'commentId is required.' });

  try {
    const existing = await (prisma as any).commentLike.findUnique({
      where: { userId_commentId: { userId, commentId } },
    });

    if (existing) {
      await (prisma as any).commentLike.delete({ where: { id: existing.id } });
      return res.status(200).json({ liked: false });
    } else {
      await (prisma as any).commentLike.create({ data: { userId, commentId } });
      return res.status(200).json({ liked: true });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ─── Pin/Unpin Comment (Post owner only, max 3) ───
export const togglePinComment = async (req: AuthRequest, res: Response) => {
  const { commentId } = req.body;
  const userId = req.user!.id;

  if (!commentId) return res.status(400).json({ error: 'commentId is required.' });

  try {
    const comment = await prisma.comment.findUnique({ where: { id: commentId }, select: { id: true, postId: true, isPinned: true } });
    if (!comment) return res.status(404).json({ error: 'Comment not found.' });

    // Verify user is post owner
    const post = await prisma.post.findUnique({ where: { id: comment.postId }, select: { userId: true } });
    if (!post || post.userId !== userId) return res.status(403).json({ error: 'Only the post creator can pin comments.' });

    if (comment.isPinned) {
      // Unpin
      await (prisma.comment as any).update({ where: { id: commentId }, data: { isPinned: false } });
      return res.status(200).json({ pinned: false });
    } else {
      // Check max 3 pinned
      const pinnedCount = await prisma.comment.count({ where: { postId: comment.postId, isPinned: true } });
      if (pinnedCount >= 3) return res.status(400).json({ error: 'Maximum 3 pinned comments allowed.' });

      await (prisma.comment as any).update({ where: { id: commentId }, data: { isPinned: true } });
      return res.status(200).json({ pinned: true });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ─── Delete Comment ───
export const deleteComment = async (req: AuthRequest, res: Response) => {
  const { commentId } = req.params;
  const userId = req.user!.id;

  try {
    const comment = await prisma.comment.findUnique({ where: { id: commentId }, select: { id: true, userId: true, postId: true } });
    if (!comment) return res.status(404).json({ error: 'Comment not found.' });

    // Can delete if own comment or post owner
    const post = await prisma.post.findUnique({ where: { id: comment.postId }, select: { userId: true } });
    if (comment.userId !== userId && post?.userId !== userId) {
      return res.status(403).json({ error: 'Not authorized to delete this comment.' });
    }

    await prisma.comment.delete({ where: { id: commentId } });
    res.status(200).json({ deleted: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ─── Search Users for @mention ───
export const searchMentionUsers = async (req: AuthRequest, res: Response) => {
  const { q } = req.query;
  if (!q || (q as string).length < 1) return res.status(200).json([]);

  try {
    const users = await prisma.user.findMany({
      where: {
        username: { contains: q as string, mode: 'insensitive' },
      },
      select: { id: true, username: true, displayName: true, profilePicture: true },
      take: 10,
    });
    res.status(200).json(users);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
