import prisma from '../config/db';

// Create a new group
export const createGroup = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { name, avatar, description, memberIds, allowMembersToInvite } = req.body;
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    const group = await (prisma.group as any).create({
      data: {
        name: name.trim(),
        avatar: avatar || null,
        description: description || null,
        allowMembersToInvite: allowMembersToInvite ?? false,
        createdById: userId,
        members: {
          create: [
            { userId, role: 'owner' },
            ...(memberIds || []).map((id: string) => ({ userId: id, role: 'member' })),
          ],
        },
      },
      include: {
        members: {
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
    });

    res.json(group);
  } catch (e: any) {
    console.error('createGroup error:', e);
    res.status(500).json({ error: e.message || 'Failed to create group' });
  }
};

// Get groups I'm in
export const getMyGroups = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const memberships = await (prisma.groupMember as any).findMany({
      where: { userId },
      include: {
        group: {
          include: {
            members: {
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
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    const groups = memberships.map((m: any) => m.group);
    res.json(groups);
  } catch (e: any) {
    console.error('getMyGroups error:', e);
    res.status(500).json({ error: e.message || 'Failed to fetch groups' });
  }
};

// Get group details
export const getGroup = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const group = await (prisma.group as any).findUnique({
      where: { id },
      include: {
        members: {
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
          orderBy: { joinedAt: 'asc' },
        },
      },
    });

    if (!group) return res.status(404).json({ error: 'Group not found' });

    // Verify user is member
    const isMember = group.members.some((m: any) => m.userId === userId);
    if (!isMember) return res.status(403).json({ error: 'Not a member of this group' });

    res.json(group);
  } catch (e: any) {
    console.error('getGroup error:', e);
    res.status(500).json({ error: e.message || 'Failed to fetch group' });
  }
};

// Update group (name, avatar, description, settings)
export const updateGroup = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { name, avatar, description, allowMembersToInvite, onlyAdminsCanSend, membersCanEditProfile } = req.body;
    if (name !== undefined && name.trim().length === 0) {
      return res.status(400).json({ error: 'Group name cannot be empty' });
    }

    // Verify membership
    const myMember = await (prisma.groupMember as any).findUnique({
      where: { groupId_userId: { groupId: id, userId } },
    });
    if (!myMember) return res.status(403).json({ error: 'Not a member of this group' });

    const isAdmin = myMember.role === 'owner' || myMember.role === 'admin';
    const group = await (prisma.group as any).findUnique({ where: { id } });
    const canEditProfile = isAdmin || group?.membersCanEditProfile;

    // Non-admins can only edit profile fields when membersCanEditProfile is ON
    if (!isAdmin && !canEditProfile) {
      return res.status(403).json({ error: 'Only admins can edit group settings' });
    }

    // Non-admins cannot touch admin-only toggles
    if (!isAdmin) {
      if (allowMembersToInvite !== undefined || onlyAdminsCanSend !== undefined || membersCanEditProfile !== undefined) {
        return res.status(403).json({ error: 'Only admins can change permission settings' });
      }
    }

    const data: any = {};
    if (name !== undefined) data.name = name.trim();
    if (avatar !== undefined) data.avatar = avatar || null;
    if (description !== undefined) data.description = description || null;
    if (allowMembersToInvite !== undefined) data.allowMembersToInvite = allowMembersToInvite;
    if (onlyAdminsCanSend !== undefined) data.onlyAdminsCanSend = onlyAdminsCanSend;
    if (membersCanEditProfile !== undefined) data.membersCanEditProfile = membersCanEditProfile;

    const updated = await (prisma.group as any).update({
      where: { id },
      data,
      include: {
        members: {
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
    });

    res.json(updated);
  } catch (e: any) {
    console.error('updateGroup error:', e);
    res.status(500).json({ error: e.message || 'Failed to update group' });
  }
};

// Send message to group
export const sendGroupMessage = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const groupId = req.params.id;
    const { text, type, mediaUrl, audioDuration, replyToId } = req.body;
    if (!groupId) return res.status(400).json({ error: 'groupId is required' });

    // Verify membership
    const member = await (prisma.groupMember as any).findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!member) return res.status(403).json({ error: 'Not a member of this group' });

    // Check if only admins can send
    const group = await (prisma.group as any).findUnique({ where: { id: groupId } });
    if (group?.onlyAdminsCanSend && member.role !== 'owner' && member.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can send messages in this group' });
    }

    const message = await (prisma.groupMessage as any).create({
      data: {
        groupId,
        senderId: userId,
        text: text || null,
        type: type || 'text',
        mediaUrl: mediaUrl || null,
        audioDuration: audioDuration || null,
        replyToId: replyToId || null,
      },
      include: {
        group: {
          include: {
            members: {
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
        },
      },
    });

    // Emit socket event to all members
    const io = req.app.get('io');
    if (io) {
      message.group.members.forEach((m: any) => {
        io.to(`user:${m.userId}`).emit('new_group_message', message);
      });
    }

    // Push notification to all members except sender
    try {
      const { sendPushNotification } = await import('../utils/pushNotifications');
      const sender = message.group.members.find((m: any) => m.userId === userId)?.user;
      const senderName = sender?.displayName || sender?.username || 'Someone';
      const richText = text ? text.substring(0, 120) : mediaUrl ? '📸 Photo' : '🎤 Voice';
      const memberPromises = message.group.members
        .filter((m: any) => m.userId !== userId)
        .map((m: any) =>
          sendPushNotification(
            m.userId,
            `${senderName} in ${group?.name || 'Group'}`,
            richText,
            {
              type: 'group_message',
              groupId,
              senderId: userId,
              senderName,
              messageText: text || '',
            }
          )
        );
      await Promise.all(memberPromises);
    } catch (_) {}

    res.json(message);
  } catch (e: any) {
    console.error('sendGroupMessage error:', e);
    res.status(500).json({ error: e.message || 'Failed to send message' });
  }
};

// Get group message history
export const getGroupMessages = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    const { before, limit = 50 } = req.query;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Verify membership
    const member = await (prisma.groupMember as any).findUnique({
      where: { groupId_userId: { groupId: id, userId } },
    });
    if (!member) return res.status(403).json({ error: 'Not a member of this group' });

    const messages = await (prisma.groupMessage as any).findMany({
      where: {
        groupId: id,
        ...(before ? { createdAt: { lt: new Date(before as string) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      include: {
        reactions: {
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
        group: {
          select: {
            members: {
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
        },
      },
    });

    res.json(messages.reverse());
  } catch (e: any) {
    console.error('getGroupMessages error:', e);
    res.status(500).json({ error: e.message || 'Failed to fetch messages' });
  }
};

// Add member to group
export const addGroupMember = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { groupId, memberIds } = req.body;
    if (!groupId || !memberIds || !Array.isArray(memberIds)) {
      return res.status(400).json({ error: 'groupId and memberIds array required' });
    }

    // Verify membership
    const myMember = await (prisma.groupMember as any).findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!myMember) return res.status(403).json({ error: 'Not a member of this group' });

    const isAdmin = myMember.role === 'owner' || myMember.role === 'admin';
    const group = await (prisma.group as any).findUnique({ where: { id: groupId } });

    // Non-admins can only add if allowMembersToInvite is ON
    if (!isAdmin && !group?.allowMembersToInvite) {
      return res.status(403).json({ error: 'Only admins can add members to this group' });
    }

    const newMembers = await (prisma.groupMember as any).createMany({
      data: memberIds.map((id: string) => ({ groupId, userId: id, role: 'member' })),
      skipDuplicates: true,
    });

    // Push notification to added members
    try {
      const adder = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, displayName: true } });
      const { sendPushNotification } = await import('../utils/pushNotifications');
      await Promise.all(
        memberIds.map((id: string) =>
          sendPushNotification(
            id,
            adder?.displayName || adder?.username || 'Someone',
            `added you to "${group?.name || 'a group'}"`,
            { type: 'group_add', groupId, senderId: userId }
          )
        )
      );
    } catch (_) {}

    res.json({ success: true, added: newMembers.count });
  } catch (e: any) {
    console.error('addGroupMember error:', e);
    res.status(500).json({ error: e.message || 'Failed to add members' });
  }
};

// Remove member from group
export const removeGroupMember = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { groupId, memberId } = req.body;
    if (!groupId || !memberId) return res.status(400).json({ error: 'groupId and memberId required' });

    // Verify admin/owner
    const myMember = await (prisma.groupMember as any).findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!myMember || (myMember.role !== 'owner' && myMember.role !== 'admin')) {
      return res.status(403).json({ error: 'Only admins can remove members' });
    }

    // Owner cannot be removed
    const group = await (prisma.group as any).findUnique({ where: { id: groupId } });
    if (group?.createdById === memberId) {
      return res.status(400).json({ error: 'Cannot remove group owner' });
    }

    await (prisma.groupMember as any).deleteMany({
      where: { groupId, userId: memberId },
    });

    res.json({ success: true });
  } catch (e: any) {
    console.error('removeGroupMember error:', e);
    res.status(500).json({ error: e.message || 'Failed to remove member' });
  }
};

// Leave group
export const leaveGroup = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { groupId } = req.body;
    if (!groupId) return res.status(400).json({ error: 'groupId required' });

    const group = await (prisma.group as any).findUnique({
      where: { id: groupId },
      include: { members: true },
    });
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const isOwner = group.createdById === userId;

    if (isOwner) {
      // Transfer ownership to a random other member
      const otherMembers = group.members.filter((m: any) => m.userId !== userId);
      if (otherMembers.length > 0) {
        const randomIndex = Math.floor(Math.random() * otherMembers.length);
        const newOwner = otherMembers[randomIndex];
        await (prisma.group as any).update({
          where: { id: groupId },
          data: { createdById: newOwner.userId },
        });
        await (prisma.groupMember as any).update({
          where: { groupId_userId: { groupId, userId: newOwner.userId } },
          data: { role: 'owner' },
        });
      } else {
        // No other members — delete the group
        await (prisma.group as any).delete({ where: { id: groupId } });
        res.json({ success: true });
        return;
      }
    }

    await (prisma.groupMember as any).deleteMany({
      where: { groupId, userId },
    });

    res.json({ success: true });
  } catch (e: any) {
    console.error('leaveGroup error:', e);
    res.status(500).json({ error: e.message || 'Failed to leave group' });
  }
};

// Delete group (owner only)
export const deleteGroup = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { groupId } = req.body;
    if (!groupId) return res.status(400).json({ error: 'groupId required' });

    const group = await (prisma.group as any).findUnique({ where: { id: groupId } });
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.createdById !== userId) {
      return res.status(403).json({ error: 'Only owner can delete group' });
    }

    await (prisma.group as any).delete({ where: { id: groupId } });

    res.json({ success: true });
  } catch (e: any) {
    console.error('deleteGroup error:', e);
    res.status(500).json({ error: e.message || 'Failed to delete group' });
  }
};

// ─── Create poll ───
export const createPoll = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { id: groupId } = req.params;
    const { question, options } = req.body;

    if (!question || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ error: 'question and at least 2 options are required' });
    }

    const isMember = await (prisma.groupMember as any).findFirst({ where: { groupId, userId } });
    if (!isMember) return res.status(403).json({ error: 'Not a member' });

    const poll = await (prisma.groupPoll as any).create({
      data: { groupId, creatorId: userId, question, options },
      include: { votes: true },
    });

    res.json(poll);
  } catch (e: any) {
    console.error('createPoll error:', e);
    res.status(500).json({ error: e.message || 'Failed to create poll' });
  }
};

// ─── Get polls for a group ───
export const getPolls = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { id: groupId } = req.params;

    const isMember = await (prisma.groupMember as any).findFirst({ where: { groupId, userId } });
    if (!isMember) return res.status(403).json({ error: 'Not a member' });

    const polls = await (prisma.groupPoll as any).findMany({
      where: { groupId },
      orderBy: { createdAt: 'desc' },
      include: { votes: true },
    });

    res.json(polls);
  } catch (e: any) {
    console.error('getPolls error:', e);
    res.status(500).json({ error: e.message || 'Failed to get polls' });
  }
};

// ─── Edit group message ───
export const editGroupMessage = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Text is required' });

    const message = await (prisma.groupMessage as any).findUnique({ where: { id: messageId } });
    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (message.senderId !== userId) return res.status(403).json({ error: 'Can only edit own messages' });

    const ageMs = Date.now() - new Date(message.createdAt).getTime();
    if (ageMs > 15 * 60 * 1000) return res.status(403).json({ error: 'Edit window expired' });

    const updated = await (prisma.groupMessage as any).update({
      where: { id: messageId },
      data: { text: text.trim(), edited: true, editedAt: new Date() },
    });
    res.json(updated);
  } catch (e: any) {
    console.error('editGroupMessage error:', e);
    res.status(500).json({ error: e.message || 'Failed to edit message' });
  }
};

// ─── Delete group message for me ───
export const deleteGroupMessageForMe = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;
    const msg = await (prisma.groupMessage as any).findUnique({ where: { id: messageId }, select: { deletedFor: true } });
    const current = msg?.deletedFor || [];
    if (!current.includes(userId)) {
      await (prisma.groupMessage as any).update({
        where: { id: messageId },
        data: { deletedFor: [...current, userId] },
      });
    }
    res.json({ success: true });
  } catch (e: any) {
    console.error('deleteGroupMessageForMe error:', e);
    res.status(500).json({ error: e.message || 'Failed to delete message' });
  }
};

// ─── Unsend group message ───
export const unsendGroupMessage = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;
    const message = await (prisma.groupMessage as any).findUnique({ where: { id: messageId } });
    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (message.senderId !== userId) return res.status(403).json({ error: 'Can only unsend own messages' });

    const ageMs = Date.now() - new Date(message.createdAt).getTime();
    if (ageMs > 60 * 60 * 1000) return res.status(403).json({ error: 'Unsend window expired' });

    await (prisma.groupMessage as any).delete({ where: { id: messageId } });
    res.json({ success: true });
  } catch (e: any) {
    console.error('unsendGroupMessage error:', e);
    res.status(500).json({ error: e.message || 'Failed to unsend message' });
  }
};

// ─── Pin group message ───
export const pinGroupMessage = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;
    const message = await (prisma.groupMessage as any).findUnique({ where: { id: messageId }, include: { group: { include: { members: true } } } });
    if (!message) return res.status(404).json({ error: 'Message not found' });

    const isMember = message.group.members.some((m: any) => m.userId === userId);
    if (!isMember) return res.status(403).json({ error: 'Not a member' });

    await (prisma.groupMessage as any).update({
      where: { id: messageId },
      data: { isPinned: true },
    });
    res.json({ success: true });
  } catch (e: any) {
    console.error('pinGroupMessage error:', e);
    res.status(500).json({ error: e.message || 'Failed to pin message' });
  }
};

// ─── Unpin group message ───
export const unpinGroupMessage = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;
    const message = await (prisma.groupMessage as any).findUnique({ where: { id: messageId }, include: { group: { include: { members: true } } } });
    if (!message) return res.status(404).json({ error: 'Message not found' });

    const isMember = message.group.members.some((m: any) => m.userId === userId);
    if (!isMember) return res.status(403).json({ error: 'Not a member' });

    await (prisma.groupMessage as any).update({
      where: { id: messageId },
      data: { isPinned: false },
    });
    res.json({ success: true });
  } catch (e: any) {
    console.error('unpinGroupMessage error:', e);
    res.status(500).json({ error: e.message || 'Failed to unpin message' });
  }
};

// ─── React to group message ───
export const reactToGroupMessage = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;
    const { emoji } = req.body;
    if (!emoji) return res.status(400).json({ error: 'emoji is required' });

    const message = await (prisma.groupMessage as any).findUnique({
      where: { id: messageId },
      include: { group: { include: { members: true } } },
    });
    if (!message) return res.status(404).json({ error: 'Message not found' });

    const isMember = message.group.members.some((m: any) => m.userId === userId);
    if (!isMember) return res.status(403).json({ error: 'Not a member' });

    // Upsert reaction (one per user per emoji per message)
    const reaction = await (prisma.groupMessageReaction as any).upsert({
      where: { messageId_userId_emoji: { messageId, userId, emoji } },
      create: { messageId, userId, emoji },
      update: {},
      include: { user: { select: { id: true, username: true, displayName: true, profilePicture: true } } },
    });

    // Push notification to message sender
    try {
      const senderId = message.senderId;
      if (senderId !== userId) {
        const { sendPushNotification } = await import('../utils/pushNotifications');
        const reactor = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, displayName: true } });
        sendPushNotification(
          senderId,
          reactor?.displayName || reactor?.username || 'Someone',
          `reacted ${emoji} to your message in ${message.group?.name || 'Group'}`,
          { type: 'group_message_reaction', groupId: message.groupId, senderId: userId }
        );
      }
    } catch (_) {}

    res.json(reaction);
  } catch (e: any) {
    console.error('reactToGroupMessage error:', e);
    res.status(500).json({ error: e.message || 'Failed to react' });
  }
};

// ─── Remove group message reaction ───
export const removeGroupMessageReaction = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;
    const { emoji } = req.body;
    if (!emoji) return res.status(400).json({ error: 'emoji is required' });

    await (prisma.groupMessageReaction as any).deleteMany({
      where: { messageId, userId, emoji },
    });

    res.json({ success: true });
  } catch (e: any) {
    console.error('removeGroupMessageReaction error:', e);
    res.status(500).json({ error: e.message || 'Failed to remove reaction' });
  }
};

// ─── Vote on poll ───
export const votePoll = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { pollId } = req.params;
    const { optionIdx } = req.body;

    if (optionIdx === undefined || optionIdx === null) {
      return res.status(400).json({ error: 'optionIdx is required' });
    }

    const poll = await (prisma.groupPoll as any).findUnique({ where: { id: pollId } });
    if (!poll) return res.status(404).json({ error: 'Poll not found' });
    if (optionIdx < 0 || optionIdx >= poll.options.length) {
      return res.status(400).json({ error: 'Invalid option index' });
    }

    // Upsert vote
    await (prisma.groupPollVote as any).upsert({
      where: { pollId_userId: { pollId, userId } },
      create: { pollId, userId, optionIdx },
      update: { optionIdx },
    });

    const updated = await (prisma.groupPoll as any).findUnique({
      where: { id: pollId },
      include: { votes: true },
    });

    res.json(updated);
  } catch (e: any) {
    console.error('votePoll error:', e);
    res.status(500).json({ error: e.message || 'Failed to vote' });
  }
};

