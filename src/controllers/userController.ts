import { prisma } from '../db';

// Toggle follow/unfollow a user
export const toggleFollow = async (req: any, res: any) => {
  try {
    const followerId = req.user.id;
    const { followingId } = req.body;

    if (!followingId) {
      return res.status(400).json({ error: "followingId is required" });
    }

    if (followerId === followingId) {
      return res.status(400).json({ error: "You cannot follow yourself" });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: followingId },
    });

    if (!targetUser) {
      return res.status(404).json({ error: "Target user not found" });
    }

    const existingFollow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId,
          followingId,
        },
      },
    });

    if (existingFollow) {
      await prisma.follow.delete({
        where: {
          followerId_followingId: {
            followerId,
            followingId,
          },
        },
      });
      return res.json({ followed: false, message: "Unfollowed successfully" });
    } else {
      const status = targetUser.isPrivate ? "pending" : "accepted";
      
      await prisma.follow.create({
        data: {
          followerId,
          followingId,
          status,
        },
      });

      // Create follow notification for public accounts
      if (status === "accepted") {
        try {
          await prisma.notification.create({
            data: {
              userId: followingId,
              senderId: followerId,
              type: "follow",
              text: "started following you",
            },
          });
          const { sendPushNotification } = await import('../utils/pushNotifications');
          const sender = await prisma.user.findUnique({ where: { id: followerId }, select: { username: true, displayName: true, profilePicture: true } });
          sendPushNotification(
            followingId,
            sender?.displayName || sender?.username || 'Someone',
            'started following you',
            { type: 'follow', senderId: followerId, senderName: sender?.displayName || sender?.username, senderAvatar: sender?.profilePicture }
          );
        } catch (notifErr) {
          console.error("Failed to create follow notification:", notifErr);
        }
      }

      return res.json({ 
        followed: true, 
        status,
        message: status === "pending" ? "Follow request sent" : "Followed successfully" 
      });
    }
  } catch (e: any) {
    console.error("Toggle Follow Error:", e);
    res.status(500).json({ error: e.message || "Failed to toggle follow status" });
  }
};

// Accept follower request (for private accounts)
export const acceptFollowRequest = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { followerId } = req.body;

    if (!followerId) {
      return res.status(400).json({ error: "followerId is required" });
    }

    const follow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId,
          followingId: userId,
        },
      },
    });

    if (!follow) {
      return res.status(404).json({ error: "Follow request not found" });
    }

    await prisma.follow.update({
      where: {
        followerId_followingId: {
          followerId,
          followingId: userId,
        },
      },
      data: {
        status: "accepted",
      },
    });

    try {
      await prisma.notification.create({
        data: {
          userId: follow.followerId,
          senderId: userId,
          type: "follow_accepted",
          text: "accepted your follow request",
        },
      });
      const { sendPushNotification } = await import('../utils/pushNotifications');
      const sender = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, displayName: true, profilePicture: true } });
      sendPushNotification(
        follow.followerId,
        sender?.displayName || sender?.username || 'Someone',
        'accepted your follow request',
        { type: 'follow_accepted', senderId: userId, senderName: sender?.displayName || sender?.username, senderAvatar: sender?.profilePicture }
      );
    } catch (notifErr) {
      console.error("Failed to create follow acceptance notification:", notifErr);
    }

    res.json({ success: true, message: "Follow request accepted" });
  } catch (e: any) {
    console.error("Accept Follow Request Error:", e);
    res.status(500).json({ error: e.message || "Failed to accept follow request" });
  }
};

// Retrieve pending follow requests
export const getPendingFollowRequests = async (req: any, res: any) => {
  try {
    const userId = req.user.id;

    const requests = await prisma.follow.findMany({
      where: {
        followingId: userId,
        status: "pending",
      },
      include: {
        follower: {
          select: {
            id: true,
            username: true,
            displayName: true,
            profilePicture: true,
            bio: true,
          },
        },
      },
    });

    res.json(requests.map(r => r.follower));
  } catch (e: any) {
    console.error("Get Pending Follow Requests Error:", e);
    res.status(500).json({ error: e.message || "Failed to retrieve pending follow requests" });
  }
};

// Decline / Reject follower request (for private accounts)
export const declineFollowRequest = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { followerId } = req.body;

    if (!followerId) {
      return res.status(400).json({ error: "followerId is required" });
    }

    const follow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId,
          followingId: userId,
        },
      },
    });

    if (!follow) {
      return res.status(404).json({ error: "Follow request not found" });
    }

    await prisma.follow.delete({
      where: {
        followerId_followingId: {
          followerId,
          followingId: userId,
        },
      },
    });

    res.json({ success: true, message: "Follow request declined" });
  } catch (e: any) {
    console.error("Decline Follow Request Error:", e);
    res.status(500).json({ error: e.message || "Failed to decline follow request" });
  }
};

// Retrieve followers list
export const getFollowers = async (req: any, res: any) => {
  try {
    const { userId } = req.params;
    const requesterId = req.user.id;

    // Get all blocked IDs (both directions) for the requester
    const blocks = await prisma.block.findMany({
      where: { OR: [{ blockerId: requesterId }, { blockedId: requesterId }] },
      select: { blockerId: true, blockedId: true },
    });
    const blockedIds = blocks.map(b => b.blockerId === requesterId ? b.blockedId : b.blockerId);

    const followers = await prisma.follow.findMany({
      where: {
        followingId: userId,
        status: "accepted",
        followerId: { notIn: blockedIds },
      },
      include: {
        follower: {
          select: {
            id: true,
            username: true,
            displayName: true,
            profilePicture: true,
            bio: true,
          },
        },
      },
    });

    res.json(followers.map(f => f.follower));
  } catch (e: any) {
    console.error("Get Followers Error:", e);
    res.status(500).json({ error: e.message || "Failed to retrieve followers list" });
  }
};

// Retrieve following list
export const getFollowing = async (req: any, res: any) => {
  try {
    const { userId } = req.params;
    const requesterId = req.user.id;

    // Get all blocked IDs (both directions) for the requester
    const blocks = await prisma.block.findMany({
      where: { OR: [{ blockerId: requesterId }, { blockedId: requesterId }] },
      select: { blockerId: true, blockedId: true },
    });
    const blockedIds = blocks.map(b => b.blockerId === requesterId ? b.blockedId : b.blockerId);

    const following = await prisma.follow.findMany({
      where: {
        followerId: userId,
        status: "accepted",
        followingId: { notIn: blockedIds },
      },
      include: {
        following: {
          select: {
            id: true,
            username: true,
            displayName: true,
            profilePicture: true,
            bio: true,
          },
        },
      },
    });

    res.json(following.map(f => f.following));
  } catch (e: any) {
    console.error("Get Following Error:", e);
    res.status(500).json({ error: e.message || "Failed to retrieve following list" });
  }
};

// Search users by query string
export const searchUsers = async (req: any, res: any) => {
  try {
    const { q } = req.query;
    const loggedInUserId = req.user.id;

    if (!q) {
      return res.json([]);
    }

    // Get IDs that are blocked in either direction
    const blocks = await prisma.block.findMany({
      where: {
        OR: [
          { blockerId: loggedInUserId },
          { blockedId: loggedInUserId },
        ],
      },
      select: { blockerId: true, blockedId: true },
    });
    const blockedIds = blocks.map(b =>
      b.blockerId === loggedInUserId ? b.blockedId : b.blockerId
    );

    const users = await prisma.user.findMany({
      where: {
        AND: [
          {
            OR: [
              { username: { contains: q, mode: "insensitive" } },
              { displayName: { contains: q, mode: "insensitive" } },
            ],
          },
          { id: { notIn: [...blockedIds, loggedInUserId] } },
        ],
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        profilePicture: true,
        bio: true,
        isVerified: true,
      },
      take: 20,
    });

    res.json(users);
  } catch (e: any) {
    console.error("Search Users Error:", e);
    res.status(500).json({ error: e.message || "Failed to perform user search" });
  }
};

// Get User Profile with details and follow status relative to logged-in user
export const getUserProfile = async (req: any, res: any) => {
  try {
    const loggedInUserId = req.user.id;
    const { targetIdOrUsername } = req.params;

    // Try finding by username first, then by UUID id
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: targetIdOrUsername },
          { id: targetIdOrUsername },
        ],
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Fetch counts
    const postsCount = await prisma.post.count({
      where: { userId: user.id },
    });

    const followersCount = await prisma.follow.count({
      where: { followingId: user.id, status: "accepted" },
    });

    const followingCount = await prisma.follow.count({
      where: { followerId: user.id, status: "accepted" },
    });

    // Check relationship from logged-in user to this user
    let followStatus = null; // null = not following
    let isBlocked = false;     // current user blocked target
    let isBlockedBy = false;   // target blocked current user

    if (loggedInUserId !== user.id) {
      const [follow, blockByMe, blockByThem] = await Promise.all([
        prisma.follow.findUnique({
          where: {
            followerId_followingId: {
              followerId: loggedInUserId,
              followingId: user.id,
            },
          },
        }),
        prisma.block.findUnique({
          where: { blockerId_blockedId: { blockerId: loggedInUserId, blockedId: user.id } },
        }),
        prisma.block.findUnique({
          where: { blockerId_blockedId: { blockerId: user.id, blockedId: loggedInUserId } },
        }),
      ]);

      if (follow) {
        followStatus = follow.status; // "pending" or "accepted"
      }
      isBlocked = !!blockByMe;
      isBlockedBy = !!blockByThem;
    }

    // If this user has blocked the requester, return almost nothing
    if (isBlockedBy) {
      return res.json({
        id: user.id,
        username: user.username,
        displayName: user.displayName || user.username,
        profilePicture: null,
        bio: null,
        isPrivate: true,
        isVerified: false,
        isOwnProfile: false,
        isBlocked: false,
        isBlockedBy: true,
        followStatus: null,
        stats: { posts: 0, followers: 0, following: 0 },
      });
    }

    res.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName || user.username,
      profilePicture: user.profilePicture,
      bio: user.bio,
      gender: user.gender,
      isPrivate: user.isPrivate,
      isVerified: user.isVerified,
      lastSeen: (user as any).lastSeen,
      hideOnlineStatus: (user as any).hideOnlineStatus,
      createdAt: user.createdAt,
      stats: {
        posts: postsCount,
        followers: followersCount,
        following: followingCount,
      },
      followStatus, // null, "pending", or "accepted"
      isOwnProfile: loggedInUserId === user.id,
      isBlocked,   // current user has blocked this profile
      isBlockedBy, // this profile has blocked current user
    });
  } catch (e: any) {
    console.error("Get User Profile Error:", e);
    res.status(500).json({ error: e.message || "Failed to retrieve user profile" });
  }
};

// Retrieve notifications for the logged-in user
export const getNotifications = async (req: any, res: any) => {
  try {
    const userId = req.user.id;

    const notifications = await prisma.notification.findMany({
      where: {
        userId,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 50,
    });

    // Fetch sender details for each notification
    const senderIds = Array.from(new Set(notifications.map((n: any) => n.senderId))) as string[];
    const senders = await prisma.user.findMany({
      where: {
        id: { in: senderIds },
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        profilePicture: true,
      },
    });

    const senderMap = new Map(senders.map(s => [s.id, s]));

    const result = notifications.map((n: any) => {
      const sender = senderMap.get(n.senderId);
      return {
        id: n.id,
        userId: n.userId,
        senderId: n.senderId,
        type: n.type,
        text: n.text || "interacted with your profile",
        postId: n.postId,
        storyId: n.storyId,
        createdAt: n.createdAt,
        isRead: n.isRead,
        itemType: 'notification', // Format for UI Activity List compat
        user: {
          username: sender?.username || "user",
          profilePicture: sender?.profilePicture || "https://via.placeholder.com/150",
          displayName: sender?.displayName || sender?.username || "User",
        },
      };
    });

    res.json(result);
  } catch (e: any) {
    console.error("Get Notifications Error:", e);
    res.status(500).json({ error: e.message || "Failed to retrieve notifications" });
  }
};

// Delete notification for the logged-in user
export const deleteNotification = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { notificationId } = req.body;

    if (!notificationId) {
      return res.status(400).json({ error: "notificationId is required" });
    }

    await prisma.notification.deleteMany({
      where: {
        id: notificationId,
        userId,
      },
    });

    res.json({ success: true, message: "Notification deleted" });
  } catch (e: any) {
    console.error("Delete Notification Error:", e);
    res.status(500).json({ error: e.message || "Failed to delete notification" });
  }
};

// Mark a single notification as read
export const markNotificationRead = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { notificationId } = req.body;

    await prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true },
    });

    res.json({ success: true });
  } catch (e: any) {
    console.error("Mark Notification Read Error:", e);
    res.status(500).json({ error: e.message || "Failed to mark notification as read" });
  }
};

// Mark all notifications as read
export const markAllNotificationsRead = async (req: any, res: any) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, isRead: false },
      data: { isRead: true },
    });

    res.json({ success: true });
  } catch (e: any) {
    console.error("Mark All Notifications Read Error:", e);
    res.status(500).json({ error: e.message || "Failed to mark all notifications as read" });
  }
};

// Get unread notification count
export const getUnreadNotificationCount = async (req: any, res: any) => {
  try {
    const count = await prisma.notification.count({
      where: { userId: req.user.id, isRead: false },
    });

    res.json({ count });
  } catch (e: any) {
    console.error("Get Unread Count Error:", e);
    res.status(500).json({ error: e.message || "Failed to get unread count" });
  }
};

// Update push token
export const updatePushToken = async (req: any, res: any) => {
  try {
    const { pushToken } = req.body;
    if (!pushToken) {
      return res.status(400).json({ error: "pushToken is required" });
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: { pushToken },
    });

    res.json({ success: true });
  } catch (e: any) {
    console.error("Update Push Token Error:", e);
    res.status(500).json({ error: e.message || "Failed to update push token" });
  }
};

// Toggle hide online status
export const toggleOnlineStatus = async (req: any, res: any) => {
  try {
    const user = await (prisma.user as any).findUnique({ where: { id: req.user.id }, select: { hideOnlineStatus: true } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const updated = await (prisma.user as any).update({
      where: { id: req.user.id },
      data: { hideOnlineStatus: !user.hideOnlineStatus },
      select: { hideOnlineStatus: true },
    });
    res.json({ hideOnlineStatus: updated.hideOnlineStatus });
  } catch (e: any) {
    console.error('Toggle online status error:', e);
    res.status(500).json({ error: e.message || 'Failed to toggle online status' });
  }
};

// ─── Disappearing messages timer ───
export const setDisappearingTimer = async (req: any, res: any) => {
  try {
    const { timer } = req.body; // null | "24h" | "7d"
    if (timer !== null && !['24h', '7d'].includes(timer)) {
      return res.status(400).json({ error: 'Invalid timer value' });
    }
    const updated = await (prisma.user as any).update({
      where: { id: req.user.id },
      data: { disappearingMsgTimer: timer },
      select: { disappearingMsgTimer: true },
    });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to set timer' });
  }
};

// ─── Close friends ───
export const getCloseFriends = async (req: any, res: any) => {
  try {
    const user = await (prisma.user as any).findUnique({
      where: { id: req.user.id },
      select: { closeFriends: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const friends = await prisma.user.findMany({
      where: { id: { in: user.closeFriends } },
      select: { id: true, username: true, displayName: true, profilePicture: true },
    });
    res.json(friends);
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to get close friends' });
  }
};

export const updateCloseFriends = async (req: any, res: any) => {
  try {
    const { closeFriends } = req.body; // string[]
    if (!Array.isArray(closeFriends)) return res.status(400).json({ error: 'closeFriends must be an array' });
    await (prisma.user as any).update({
      where: { id: req.user.id },
      data: { closeFriends },
    });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to update close friends' });
  }
};

// ─── Update lastSeen ───
export const updateLastSeen = async (req: any, res: any) => {
  try {
    await (prisma.user as any).update({
      where: { id: req.user.id },
      data: { lastSeen: new Date() },
    });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to update last seen' });
  }
};

// ─── Block list ───
export const getBlockList = async (req: any, res: any) => {
  try {
    const blocks = await prisma.block.findMany({
      where: { blockerId: req.user.id },
      include: {
        blocked: { select: { id: true, username: true, displayName: true, profilePicture: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(blocks.map((b: any) => b.blocked));
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to get block list' });
  }
};

// Update message privacy setting
export const updateMessagePrivacy = async (req: any, res: any) => {
  try {
    const { privacy } = req.body;
    if (!privacy || !['EVERYONE', 'FOLLOWERS'].includes(privacy)) {
      return res.status(400).json({ error: "Invalid privacy setting. Must be EVERYONE or FOLLOWERS." });
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: { messagePrivacy: privacy },
    });

    res.json({ success: true, message: `Message privacy updated to ${privacy}` });
  } catch (e: any) {
    console.error("Update Message Privacy Error:", e);
    res.status(500).json({ error: e.message || "Failed to update message privacy" });
  }
};