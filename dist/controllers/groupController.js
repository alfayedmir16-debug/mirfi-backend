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
exports.votePoll = exports.removeGroupMessageReaction = exports.reactToGroupMessage = exports.unpinGroupMessage = exports.pinGroupMessage = exports.unsendGroupMessage = exports.deleteGroupMessageForMe = exports.editGroupMessage = exports.getPolls = exports.createPoll = exports.deleteGroup = exports.leaveGroup = exports.removeGroupMember = exports.addGroupMember = exports.getGroupMessages = exports.sendGroupMessage = exports.updateGroup = exports.getGroup = exports.getMyGroups = exports.createGroup = void 0;
const db_1 = __importDefault(require("../config/db"));
// Create a new group
const createGroup = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        const { name, avatar, description, memberIds, allowMembersToInvite } = req.body;
        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: 'Group name is required' });
        }
        const group = await db_1.default.group.create({
            data: {
                name: name.trim(),
                avatar: avatar || null,
                description: description || null,
                allowMembersToInvite: allowMembersToInvite ?? false,
                createdById: userId,
                members: {
                    create: [
                        { userId, role: 'owner' },
                        ...(memberIds || []).map((id) => ({ userId: id, role: 'member' })),
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
    }
    catch (e) {
        console.error('createGroup error:', e);
        res.status(500).json({ error: e.message || 'Failed to create group' });
    }
};
exports.createGroup = createGroup;
// Get groups I'm in
const getMyGroups = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        const memberships = await db_1.default.groupMember.findMany({
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
        const groups = memberships.map((m) => m.group);
        res.json(groups);
    }
    catch (e) {
        console.error('getMyGroups error:', e);
        res.status(500).json({ error: e.message || 'Failed to fetch groups' });
    }
};
exports.getMyGroups = getMyGroups;
// Get group details
const getGroup = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { id } = req.params;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        const group = await db_1.default.group.findUnique({
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
        if (!group)
            return res.status(404).json({ error: 'Group not found' });
        // Verify user is member
        const isMember = group.members.some((m) => m.userId === userId);
        if (!isMember)
            return res.status(403).json({ error: 'Not a member of this group' });
        res.json(group);
    }
    catch (e) {
        console.error('getGroup error:', e);
        res.status(500).json({ error: e.message || 'Failed to fetch group' });
    }
};
exports.getGroup = getGroup;
// Update group (name, avatar, description, settings)
const updateGroup = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { id } = req.params;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        const { name, avatar, description, allowMembersToInvite, onlyAdminsCanSend, membersCanEditProfile } = req.body;
        if (name !== undefined && name.trim().length === 0) {
            return res.status(400).json({ error: 'Group name cannot be empty' });
        }
        // Verify membership
        const myMember = await db_1.default.groupMember.findUnique({
            where: { groupId_userId: { groupId: id, userId } },
        });
        if (!myMember)
            return res.status(403).json({ error: 'Not a member of this group' });
        const isAdmin = myMember.role === 'owner' || myMember.role === 'admin';
        const group = await db_1.default.group.findUnique({ where: { id } });
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
        const data = {};
        if (name !== undefined)
            data.name = name.trim();
        if (avatar !== undefined)
            data.avatar = avatar || null;
        if (description !== undefined)
            data.description = description || null;
        if (allowMembersToInvite !== undefined)
            data.allowMembersToInvite = allowMembersToInvite;
        if (onlyAdminsCanSend !== undefined)
            data.onlyAdminsCanSend = onlyAdminsCanSend;
        if (membersCanEditProfile !== undefined)
            data.membersCanEditProfile = membersCanEditProfile;
        const updated = await db_1.default.group.update({
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
    }
    catch (e) {
        console.error('updateGroup error:', e);
        res.status(500).json({ error: e.message || 'Failed to update group' });
    }
};
exports.updateGroup = updateGroup;
// Send message to group
const sendGroupMessage = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        const groupId = req.params.id;
        const { text, type, mediaUrl, audioDuration, replyToId } = req.body;
        if (!groupId)
            return res.status(400).json({ error: 'groupId is required' });
        // Verify membership
        const member = await db_1.default.groupMember.findUnique({
            where: { groupId_userId: { groupId, userId } },
        });
        if (!member)
            return res.status(403).json({ error: 'Not a member of this group' });
        // Check if only admins can send
        const group = await db_1.default.group.findUnique({ where: { id: groupId } });
        if (group?.onlyAdminsCanSend && member.role !== 'owner' && member.role !== 'admin') {
            return res.status(403).json({ error: 'Only admins can send messages in this group' });
        }
        const message = await db_1.default.groupMessage.create({
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
            message.group.members.forEach((m) => {
                io.to(`user:${m.userId}`).emit('new_group_message', message);
            });
        }
        // Push notification to all members except sender
        try {
            const { sendPushNotification } = await Promise.resolve().then(() => __importStar(require('../utils/pushNotifications')));
            const sender = message.group.members.find((m) => m.userId === userId)?.user;
            const senderName = sender?.displayName || sender?.username || 'Someone';
            const richText = text ? text.substring(0, 120) : mediaUrl ? '📸 Photo' : '🎤 Voice';
            const memberPromises = message.group.members
                .filter((m) => m.userId !== userId)
                .map((m) => sendPushNotification(m.userId, `${senderName} in ${group?.name || 'Group'}`, richText, {
                type: 'group_message',
                groupId,
                senderId: userId,
                senderName,
                messageText: text || '',
            }));
            await Promise.all(memberPromises);
        }
        catch (_) { }
        res.json(message);
    }
    catch (e) {
        console.error('sendGroupMessage error:', e);
        res.status(500).json({ error: e.message || 'Failed to send message' });
    }
};
exports.sendGroupMessage = sendGroupMessage;
// Get group message history
const getGroupMessages = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { id } = req.params;
        const { before, limit = 50 } = req.query;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        // Verify membership
        const member = await db_1.default.groupMember.findUnique({
            where: { groupId_userId: { groupId: id, userId } },
        });
        if (!member)
            return res.status(403).json({ error: 'Not a member of this group' });
        const messages = await db_1.default.groupMessage.findMany({
            where: {
                groupId: id,
                ...(before ? { createdAt: { lt: new Date(before) } } : {}),
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
    }
    catch (e) {
        console.error('getGroupMessages error:', e);
        res.status(500).json({ error: e.message || 'Failed to fetch messages' });
    }
};
exports.getGroupMessages = getGroupMessages;
// Add member to group
const addGroupMember = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        const { groupId, memberIds } = req.body;
        if (!groupId || !memberIds || !Array.isArray(memberIds)) {
            return res.status(400).json({ error: 'groupId and memberIds array required' });
        }
        // Verify membership
        const myMember = await db_1.default.groupMember.findUnique({
            where: { groupId_userId: { groupId, userId } },
        });
        if (!myMember)
            return res.status(403).json({ error: 'Not a member of this group' });
        const isAdmin = myMember.role === 'owner' || myMember.role === 'admin';
        const group = await db_1.default.group.findUnique({ where: { id: groupId } });
        // Non-admins can only add if allowMembersToInvite is ON
        if (!isAdmin && !group?.allowMembersToInvite) {
            return res.status(403).json({ error: 'Only admins can add members to this group' });
        }
        const newMembers = await db_1.default.groupMember.createMany({
            data: memberIds.map((id) => ({ groupId, userId: id, role: 'member' })),
            skipDuplicates: true,
        });
        // Push notification to added members
        try {
            const adder = await db_1.default.user.findUnique({ where: { id: userId }, select: { username: true, displayName: true } });
            const { sendPushNotification } = await Promise.resolve().then(() => __importStar(require('../utils/pushNotifications')));
            await Promise.all(memberIds.map((id) => sendPushNotification(id, adder?.displayName || adder?.username || 'Someone', `added you to "${group?.name || 'a group'}"`, { type: 'group_add', groupId, senderId: userId })));
        }
        catch (_) { }
        res.json({ success: true, added: newMembers.count });
    }
    catch (e) {
        console.error('addGroupMember error:', e);
        res.status(500).json({ error: e.message || 'Failed to add members' });
    }
};
exports.addGroupMember = addGroupMember;
// Remove member from group
const removeGroupMember = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        const { groupId, memberId } = req.body;
        if (!groupId || !memberId)
            return res.status(400).json({ error: 'groupId and memberId required' });
        // Verify admin/owner
        const myMember = await db_1.default.groupMember.findUnique({
            where: { groupId_userId: { groupId, userId } },
        });
        if (!myMember || (myMember.role !== 'owner' && myMember.role !== 'admin')) {
            return res.status(403).json({ error: 'Only admins can remove members' });
        }
        // Owner cannot be removed
        const group = await db_1.default.group.findUnique({ where: { id: groupId } });
        if (group?.createdById === memberId) {
            return res.status(400).json({ error: 'Cannot remove group owner' });
        }
        await db_1.default.groupMember.deleteMany({
            where: { groupId, userId: memberId },
        });
        res.json({ success: true });
    }
    catch (e) {
        console.error('removeGroupMember error:', e);
        res.status(500).json({ error: e.message || 'Failed to remove member' });
    }
};
exports.removeGroupMember = removeGroupMember;
// Leave group
const leaveGroup = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        const { groupId } = req.body;
        if (!groupId)
            return res.status(400).json({ error: 'groupId required' });
        const group = await db_1.default.group.findUnique({
            where: { id: groupId },
            include: { members: true },
        });
        if (!group)
            return res.status(404).json({ error: 'Group not found' });
        const isOwner = group.createdById === userId;
        if (isOwner) {
            // Transfer ownership to a random other member
            const otherMembers = group.members.filter((m) => m.userId !== userId);
            if (otherMembers.length > 0) {
                const randomIndex = Math.floor(Math.random() * otherMembers.length);
                const newOwner = otherMembers[randomIndex];
                await db_1.default.group.update({
                    where: { id: groupId },
                    data: { createdById: newOwner.userId },
                });
                await db_1.default.groupMember.update({
                    where: { groupId_userId: { groupId, userId: newOwner.userId } },
                    data: { role: 'owner' },
                });
            }
            else {
                // No other members — delete the group
                await db_1.default.group.delete({ where: { id: groupId } });
                res.json({ success: true });
                return;
            }
        }
        await db_1.default.groupMember.deleteMany({
            where: { groupId, userId },
        });
        res.json({ success: true });
    }
    catch (e) {
        console.error('leaveGroup error:', e);
        res.status(500).json({ error: e.message || 'Failed to leave group' });
    }
};
exports.leaveGroup = leaveGroup;
// Delete group (owner only)
const deleteGroup = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        const { groupId } = req.body;
        if (!groupId)
            return res.status(400).json({ error: 'groupId required' });
        const group = await db_1.default.group.findUnique({ where: { id: groupId } });
        if (!group)
            return res.status(404).json({ error: 'Group not found' });
        if (group.createdById !== userId) {
            return res.status(403).json({ error: 'Only owner can delete group' });
        }
        await db_1.default.group.delete({ where: { id: groupId } });
        res.json({ success: true });
    }
    catch (e) {
        console.error('deleteGroup error:', e);
        res.status(500).json({ error: e.message || 'Failed to delete group' });
    }
};
exports.deleteGroup = deleteGroup;
// ─── Create poll ───
const createPoll = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id: groupId } = req.params;
        const { question, options } = req.body;
        if (!question || !Array.isArray(options) || options.length < 2) {
            return res.status(400).json({ error: 'question and at least 2 options are required' });
        }
        const isMember = await db_1.default.groupMember.findFirst({ where: { groupId, userId } });
        if (!isMember)
            return res.status(403).json({ error: 'Not a member' });
        const poll = await db_1.default.groupPoll.create({
            data: { groupId, creatorId: userId, question, options },
            include: { votes: true },
        });
        res.json(poll);
    }
    catch (e) {
        console.error('createPoll error:', e);
        res.status(500).json({ error: e.message || 'Failed to create poll' });
    }
};
exports.createPoll = createPoll;
// ─── Get polls for a group ───
const getPolls = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id: groupId } = req.params;
        const isMember = await db_1.default.groupMember.findFirst({ where: { groupId, userId } });
        if (!isMember)
            return res.status(403).json({ error: 'Not a member' });
        const polls = await db_1.default.groupPoll.findMany({
            where: { groupId },
            orderBy: { createdAt: 'desc' },
            include: { votes: true },
        });
        res.json(polls);
    }
    catch (e) {
        console.error('getPolls error:', e);
        res.status(500).json({ error: e.message || 'Failed to get polls' });
    }
};
exports.getPolls = getPolls;
// ─── Edit group message ───
const editGroupMessage = async (req, res) => {
    try {
        const userId = req.user.id;
        const { messageId } = req.params;
        const { text } = req.body;
        if (!text?.trim())
            return res.status(400).json({ error: 'Text is required' });
        const message = await db_1.default.groupMessage.findUnique({ where: { id: messageId } });
        if (!message)
            return res.status(404).json({ error: 'Message not found' });
        if (message.senderId !== userId)
            return res.status(403).json({ error: 'Can only edit own messages' });
        const ageMs = Date.now() - new Date(message.createdAt).getTime();
        if (ageMs > 15 * 60 * 1000)
            return res.status(403).json({ error: 'Edit window expired' });
        const updated = await db_1.default.groupMessage.update({
            where: { id: messageId },
            data: { text: text.trim(), edited: true, editedAt: new Date() },
        });
        res.json(updated);
    }
    catch (e) {
        console.error('editGroupMessage error:', e);
        res.status(500).json({ error: e.message || 'Failed to edit message' });
    }
};
exports.editGroupMessage = editGroupMessage;
// ─── Delete group message for me ───
const deleteGroupMessageForMe = async (req, res) => {
    try {
        const userId = req.user.id;
        const { messageId } = req.params;
        const msg = await db_1.default.groupMessage.findUnique({ where: { id: messageId }, select: { deletedFor: true } });
        const current = msg?.deletedFor || [];
        if (!current.includes(userId)) {
            await db_1.default.groupMessage.update({
                where: { id: messageId },
                data: { deletedFor: [...current, userId] },
            });
        }
        res.json({ success: true });
    }
    catch (e) {
        console.error('deleteGroupMessageForMe error:', e);
        res.status(500).json({ error: e.message || 'Failed to delete message' });
    }
};
exports.deleteGroupMessageForMe = deleteGroupMessageForMe;
// ─── Unsend group message ───
const unsendGroupMessage = async (req, res) => {
    try {
        const userId = req.user.id;
        const { messageId } = req.params;
        const message = await db_1.default.groupMessage.findUnique({ where: { id: messageId } });
        if (!message)
            return res.status(404).json({ error: 'Message not found' });
        if (message.senderId !== userId)
            return res.status(403).json({ error: 'Can only unsend own messages' });
        const ageMs = Date.now() - new Date(message.createdAt).getTime();
        if (ageMs > 60 * 60 * 1000)
            return res.status(403).json({ error: 'Unsend window expired' });
        await db_1.default.groupMessage.delete({ where: { id: messageId } });
        res.json({ success: true });
    }
    catch (e) {
        console.error('unsendGroupMessage error:', e);
        res.status(500).json({ error: e.message || 'Failed to unsend message' });
    }
};
exports.unsendGroupMessage = unsendGroupMessage;
// ─── Pin group message ───
const pinGroupMessage = async (req, res) => {
    try {
        const userId = req.user.id;
        const { messageId } = req.params;
        const message = await db_1.default.groupMessage.findUnique({ where: { id: messageId }, include: { group: { include: { members: true } } } });
        if (!message)
            return res.status(404).json({ error: 'Message not found' });
        const isMember = message.group.members.some((m) => m.userId === userId);
        if (!isMember)
            return res.status(403).json({ error: 'Not a member' });
        await db_1.default.groupMessage.update({
            where: { id: messageId },
            data: { isPinned: true },
        });
        res.json({ success: true });
    }
    catch (e) {
        console.error('pinGroupMessage error:', e);
        res.status(500).json({ error: e.message || 'Failed to pin message' });
    }
};
exports.pinGroupMessage = pinGroupMessage;
// ─── Unpin group message ───
const unpinGroupMessage = async (req, res) => {
    try {
        const userId = req.user.id;
        const { messageId } = req.params;
        const message = await db_1.default.groupMessage.findUnique({ where: { id: messageId }, include: { group: { include: { members: true } } } });
        if (!message)
            return res.status(404).json({ error: 'Message not found' });
        const isMember = message.group.members.some((m) => m.userId === userId);
        if (!isMember)
            return res.status(403).json({ error: 'Not a member' });
        await db_1.default.groupMessage.update({
            where: { id: messageId },
            data: { isPinned: false },
        });
        res.json({ success: true });
    }
    catch (e) {
        console.error('unpinGroupMessage error:', e);
        res.status(500).json({ error: e.message || 'Failed to unpin message' });
    }
};
exports.unpinGroupMessage = unpinGroupMessage;
// ─── React to group message ───
const reactToGroupMessage = async (req, res) => {
    try {
        const userId = req.user.id;
        const { messageId } = req.params;
        const { emoji } = req.body;
        if (!emoji)
            return res.status(400).json({ error: 'emoji is required' });
        const message = await db_1.default.groupMessage.findUnique({
            where: { id: messageId },
            include: { group: { include: { members: true } } },
        });
        if (!message)
            return res.status(404).json({ error: 'Message not found' });
        const isMember = message.group.members.some((m) => m.userId === userId);
        if (!isMember)
            return res.status(403).json({ error: 'Not a member' });
        // Upsert reaction (one per user per emoji per message)
        const reaction = await db_1.default.groupMessageReaction.upsert({
            where: { messageId_userId_emoji: { messageId, userId, emoji } },
            create: { messageId, userId, emoji },
            update: {},
            include: { user: { select: { id: true, username: true, displayName: true, profilePicture: true } } },
        });
        // Push notification to message sender
        try {
            const senderId = message.senderId;
            if (senderId !== userId) {
                const { sendPushNotification } = await Promise.resolve().then(() => __importStar(require('../utils/pushNotifications')));
                const reactor = await db_1.default.user.findUnique({ where: { id: userId }, select: { username: true, displayName: true } });
                sendPushNotification(senderId, reactor?.displayName || reactor?.username || 'Someone', `reacted ${emoji} to your message in ${message.group?.name || 'Group'}`, { type: 'group_message_reaction', groupId: message.groupId, senderId: userId });
            }
        }
        catch (_) { }
        res.json(reaction);
    }
    catch (e) {
        console.error('reactToGroupMessage error:', e);
        res.status(500).json({ error: e.message || 'Failed to react' });
    }
};
exports.reactToGroupMessage = reactToGroupMessage;
// ─── Remove group message reaction ───
const removeGroupMessageReaction = async (req, res) => {
    try {
        const userId = req.user.id;
        const { messageId } = req.params;
        const { emoji } = req.body;
        if (!emoji)
            return res.status(400).json({ error: 'emoji is required' });
        await db_1.default.groupMessageReaction.deleteMany({
            where: { messageId, userId, emoji },
        });
        res.json({ success: true });
    }
    catch (e) {
        console.error('removeGroupMessageReaction error:', e);
        res.status(500).json({ error: e.message || 'Failed to remove reaction' });
    }
};
exports.removeGroupMessageReaction = removeGroupMessageReaction;
// ─── Vote on poll ───
const votePoll = async (req, res) => {
    try {
        const userId = req.user.id;
        const { pollId } = req.params;
        const { optionIdx } = req.body;
        if (optionIdx === undefined || optionIdx === null) {
            return res.status(400).json({ error: 'optionIdx is required' });
        }
        const poll = await db_1.default.groupPoll.findUnique({ where: { id: pollId } });
        if (!poll)
            return res.status(404).json({ error: 'Poll not found' });
        if (optionIdx < 0 || optionIdx >= poll.options.length) {
            return res.status(400).json({ error: 'Invalid option index' });
        }
        // Upsert vote
        await db_1.default.groupPollVote.upsert({
            where: { pollId_userId: { pollId, userId } },
            create: { pollId, userId, optionIdx },
            update: { optionIdx },
        });
        const updated = await db_1.default.groupPoll.findUnique({
            where: { id: pollId },
            include: { votes: true },
        });
        res.json(updated);
    }
    catch (e) {
        console.error('votePoll error:', e);
        res.status(500).json({ error: e.message || 'Failed to vote' });
    }
};
exports.votePoll = votePoll;
