import { prisma } from '../db';
import { isUserOnline } from '../utils/socketHandler';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

const DAILY_LIMIT = 2;
const TICKET_TTL_MS = 90 * 1000; // 90 seconds
const SCORE_TARGET = 100; // 100 points = 100%
const FAST_REPLY_WINDOW_MS = 60 * 1000; // 60s
const MSG_POINTS = 4;
const FAST_REPLY_BONUS = 6;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function getOrCreateUsage(userId: string) {
  const date = todayStr();
  return await prisma.vibeUsage.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date, used: 0, bonusUses: 0 },
    update: {},
  });
}

async function consumeQuota(userId: string) {
  const date = todayStr();
  await prisma.vibeUsage.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date, used: 1, bonusUses: 0 },
    update: { used: { increment: 1 } },
  });
}

async function refundQuota(userId: string) {
  const date = todayStr();
  // Only decrement if used > 0 (don't go negative)
  const usage = await prisma.vibeUsage.findUnique({ where: { userId_date: { userId, date } } });
  if (usage && usage.used > 0) {
    await prisma.vibeUsage.update({ where: { userId_date: { userId, date } }, data: { used: { decrement: 1 } } });
  }
}

async function computeQuota(userId: string) {
  const usage = await getOrCreateUsage(userId);
  const remaining = DAILY_LIMIT + usage.bonusUses - usage.used;
  return {
    used: usage.used,
    bonusUses: usage.bonusUses,
    limit: DAILY_LIMIT,
    remaining: Math.max(0, remaining),
    canUse: remaining > 0,
  };
}

// ──────────────────────────────────────────────
// GET /quota
// ──────────────────────────────────────────────
export const getQuota = async (req: any, res: any) => {
  try {
    const quota = await computeQuota(req.user.id);
    res.json(quota);
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to get quota' });
  }
};

// ──────────────────────────────────────────────
// POST /find  — start looking for a vibe match
// ──────────────────────────────────────────────
export const findVibe = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { mood, customPrompt, isCustom } = req.body;

    if (!mood || typeof mood !== 'string') {
      return res.status(400).json({ error: 'mood is required' });
    }
    if (isCustom && customPrompt && customPrompt.trim().split(/\s+/).length > 30) {
      return res.status(400).json({ error: 'Custom vibe must be 30 words or less' });
    }

    // Quota check
    const quota = await computeQuota(userId);
    if (!quota.canUse) {
      return res.status(403).json({ error: 'Daily limit reached', quota, needAd: true });
    }

    // Expire old tickets
    await prisma.vibeTicket.updateMany({
      where: { status: 'waiting', expiresAt: { lt: new Date() } },
      data: { status: 'expired' },
    });

    // Find all waiting tickets with same mood (not self)
    const candidates = await (prisma.vibeTicket as any).findMany({
      where: {
        mood,
        status: 'waiting',
        userId: { not: userId },
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Pick first candidate that is NOT blocked, NOT followed (either direction), and has NO prior message history
    for (const cand of candidates) {
      const blocked = await prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: userId, blockedId: cand.userId },
            { blockerId: cand.userId, blockedId: userId },
          ],
        },
      });
      if (blocked) continue;

      // Check if either user follows the other
      const followExists = await prisma.follow.findFirst({
        where: {
          OR: [
            { followerId: userId, followingId: cand.userId },
            { followerId: cand.userId, followingId: userId },
          ],
        },
      });
      if (followExists) continue;

      // Check if they have any prior chat history (non-vibe rooms with messages)
      const priorChat = await prisma.chatRoom.findFirst({
        where: {
          isVibe: false,
          OR: [
            { user1Id: userId, user2Id: cand.userId },
            { user1Id: cand.userId, user2Id: userId },
          ],
          messages: { some: {} },
        },
      });
      if (priorChat) continue;

      return await matchWith(req, res, userId, cand, mood, customPrompt, isCustom);
    }

    // No (unblocked) candidate → create waiting ticket
    return await createWaitingTicket(req, res, userId, mood, customPrompt, isCustom);
  } catch (e: any) {
    console.error('Find Vibe Error:', e);
    res.status(500).json({ error: e.message || 'Failed to find vibe' });
  }
};

async function createWaitingTicket(req: any, res: any, userId: string, mood: string, customPrompt: string | undefined, isCustom: boolean) {
  const ticket = await prisma.vibeTicket.create({
    data: {
      userId,
      mood,
      isCustom: !!isCustom,
      customPrompt: isCustom ? customPrompt?.substring(0, 200) : null,
      status: 'waiting',
      expiresAt: new Date(Date.now() + TICKET_TTL_MS),
    },
  });
  res.json({ searching: true, ticketId: ticket.id });
}

async function matchWith(req: any, res: any, userId: string, candidate: any, mood: string, customPrompt: string | undefined, isCustom: boolean) {
  // Create a ChatRoom (isVibe true, both can message)
  const room = await prisma.chatRoom.create({
    data: {
      user1Id: userId,
      user2Id: candidate.userId,
      isAccepted: true,
      isVibe: true,
    },
  });

  const session = await prisma.vibeSession.create({
    data: {
      roomId: room.id,
      user1Id: userId,
      user2Id: candidate.userId,
      mood,
      user1CustomPrompt: isCustom ? customPrompt?.substring(0, 200) : null,
      user2CustomPrompt: candidate.isCustom ? candidate.customPrompt : null,
      status: 'active',
    },
  });

  // Mark both tickets as matched
  await prisma.vibeTicket.updateMany({
    where: { id: { in: [candidate.id] } },
    data: { status: 'matched', matchedSessionId: session.id },
  });
  // Our own waiting ticket (if any just created) — but we created candidate's match; we may also have a ticket. Mark any of ours matched.
  await (prisma.vibeTicket as any).updateMany({
    where: { userId, status: 'waiting' },
    data: { status: 'matched', matchedSessionId: session.id },
  });

  // Consume quota for BOTH users
  await consumeQuota(userId);
  await consumeQuota(candidate.userId);

  // Notify both via socket
  try {
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${userId}`).emit('vibe_matched', { sessionId: session.id, roomId: room.id, mood, partnerCustomPrompt: candidate.customPrompt || null });
      io.to(`user:${candidate.userId}`).emit('vibe_matched', { sessionId: session.id, roomId: room.id, mood, partnerCustomPrompt: customPrompt || null });
    }
  } catch (_) {}

  res.json({ searching: false, matched: true, session: await sessionShape(session, userId) });
}

// ──────────────────────────────────────────────
// GET /ticket/:id  — poll for match (fallback to socket)
// ──────────────────────────────────────────────
export const pollTicket = async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const ticket = await prisma.vibeTicket.findUnique({ where: { id } });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    if (ticket.status === 'matched' && ticket.matchedSessionId) {
      const session = await prisma.vibeSession.findUnique({ where: { id: ticket.matchedSessionId } });
      if (session) {
        return res.json({ matched: true, session: await sessionShape(session, req.user.id) });
      }
    }
    if (ticket.status === 'expired') {
      return res.json({ expired: true });
    }
    res.json({ searching: true, ticketId: id });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to poll ticket' });
  }
};

// ──────────────────────────────────────────────
// GET /session/:id — get session + messages (anonymous)
// ──────────────────────────────────────────────
export const getSession = async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const session = await prisma.vibeSession.findUnique({ where: { id } });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.user1Id !== userId && session.user2Id !== userId) {
      return res.status(403).json({ error: 'Not a participant' });
    }
    const messages = await prisma.message.findMany({
      where: { roomId: session.roomId },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    res.json({ session: await sessionShape(session, userId), messages });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to get session' });
  }
};

// ──────────────────────────────────────────────
// POST /session/:id/message — send anonymous message + score
// ──────────────────────────────────────────────
export const sendVibeMessage = async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const senderId = req.user.id;
    const { text } = req.body;

    const session = await prisma.vibeSession.findUnique({ where: { id } });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.user1Id !== senderId && session.user2Id !== senderId) {
      return res.status(403).json({ error: 'Not a participant' });
    }
    if (session.status !== 'active') {
      return res.status(400).json({ error: 'Session is not active' });
    }

    const recipientId = session.user1Id === senderId ? session.user2Id : session.user1Id;

    // Create message in the vibe room (skip privacy checks — room already exists)
    const message = await prisma.message.create({
      data: {
        roomId: session.roomId,
        senderId,
        text: text || null,
        type: 'text',
        status: 'SENT',
      },
      include: {
        sender: { select: { id: true, username: true, displayName: true, profilePicture: true } },
      },
    });

    // Update room timestamp
    await (prisma.chatRoom as any).update({ where: { id: session.roomId }, data: { updatedAt: new Date() } });

    // ─── Score update ───
    let bonus = MSG_POINTS;
    const now = Date.now();
    if (session.lastSenderId && session.lastSenderId !== senderId && session.lastMessageAt) {
      const diff = now - new Date(session.lastMessageAt).getTime();
      if (diff <= FAST_REPLY_WINDOW_MS) bonus += FAST_REPLY_BONUS;
    }
    const newScore = Math.min(SCORE_TARGET, session.score + bonus);
    const updated = await prisma.vibeSession.update({
      where: { id },
      data: {
        score: newScore,
        lastMessageAt: new Date(),
        lastSenderId: senderId,
      },
    });

    const percent = Math.round((newScore / SCORE_TARGET) * 100);

    // Real-time: deliver message + score
    try {
      const io = req.app.get('io');
      if (io) {
        if (isUserOnline(recipientId)) {
          io.to(`user:${recipientId}`).emit('new_message', message);
          await prisma.message.update({ where: { id: message.id }, data: { status: 'DELIVERED' } });
          message.status = 'DELIVERED';
          io.to(`user:${senderId}`).emit('message_delivered', { messageId: message.id });
        }
        io.to(`user:${recipientId}`).emit('vibe_score', { sessionId: id, score: newScore, percent });
        io.to(`user:${senderId}`).emit('vibe_score', { sessionId: id, score: newScore, percent });
      }
    } catch (_) {}

    // Auto-reveal at 100%
    if (percent >= 100 && updated.status === 'active') {
      await doReveal(req, id, true);
      return res.json({ ...message, vibeScore: newScore, vibePercent: percent, autoRevealed: true });
    }

    res.json({ ...message, vibeScore: newScore, vibePercent: percent });
  } catch (e: any) {
    console.error('Send Vibe Message Error:', e);
    res.status(500).json({ error: e.message || 'Failed to send message' });
  }
};

// ──────────────────────────────────────────────
// POST /session/:id/reveal — request/confirm identity reveal
// ──────────────────────────────────────────────
export const revealVibe = async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const session = await prisma.vibeSession.findUnique({ where: { id } });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.user1Id !== userId && session.user2Id !== userId) {
      return res.status(403).json({ error: 'Not a participant' });
    }
    if (session.status !== 'active') {
      return res.json({ session: await sessionShape(session, userId) });
    }

    // 80% gate
    const percent = Math.round((session.score / SCORE_TARGET) * 100);
    if (percent < 80) {
      return res.status(400).json({ error: 'Reveal unlocks at 80%. Keep chatting!', percent });
    }

    return await doReveal(req, id, false, userId);
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to reveal' });
  }
};

async function doReveal(req: any, sessionId: string, auto: boolean, requesterId?: string) {
  const session = await prisma.vibeSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error('Session not found');

  const isUser1 = (requesterId || '').toString() === session.user1Id;
  const data: any = {};
  if (requesterId) {
    if (isUser1) data.user1Revealed = true;
    else data.user2Revealed = true;
  }

  // Both revealed?
  const willBeBoth = (data.user1Revealed || session.user1Revealed) && (data.user2Revealed || session.user2Revealed);

  if (willBeBoth || auto) {
    data.user1Revealed = true;
    data.user2Revealed = true;
    data.status = 'revealed';
    const updated = await prisma.vibeSession.update({ where: { id: sessionId }, data });

    // Create mutual follow (both directions, accepted)
    try {
      await prisma.follow.createMany({
        data: [
          { followerId: session.user1Id, followingId: session.user2Id, status: 'accepted' },
          { followerId: session.user2Id, followingId: session.user1Id, status: 'accepted' },
        ],
        skipDuplicates: true,
      });
    } catch (_) {}
    // Reveal the room so it shows in normal chat list
    await (prisma.chatRoom as any).update({ where: { id: session.roomId }, data: { isVibe: false } });

    // Notify both
    try {
      const io = req.app.get('io');
      if (io) {
        io.to(`user:${session.user1Id}`).emit('vibe_revealed', { sessionId, roomId: session.roomId });
        io.to(`user:${session.user2Id}`).emit('vibe_revealed', { sessionId, roomId: session.roomId });
      }
    } catch (_) {}

    return { session: await sessionShape(updated, requesterId || session.user1Id), autoRevealed: auto };
  }

  const updated = await prisma.vibeSession.update({ where: { id: sessionId }, data });
  // Notify partner that the other requested reveal
  const partnerId = isUser1 ? session.user2Id : session.user1Id;
  try {
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${partnerId}`).emit('vibe_reveal_request', { sessionId });
    }
  } catch (_) {}

  return { session: await sessionShape(updated, requesterId || session.user1Id) };
}

// ──────────────────────────────────────────────
// POST /session/:id/quit — leave the vibe chat
// ──────────────────────────────────────────────
export const quitVibe = async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const session = await prisma.vibeSession.findUnique({ where: { id } });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.user1Id !== userId && session.user2Id !== userId) {
      return res.status(403).json({ error: 'Not a participant' });
    }

    const isUser1 = userId === session.user1Id;
    const partnerId = isUser1 ? session.user2Id : session.user1Id;

    await prisma.vibeSession.update({
      where: { id },
      data: {
        status: 'ended',
        endedAt: new Date(),
        ...(isUser1 ? { user1Quit: true } : { user2Quit: true }),
      },
    });

    // Refund the REMAINING (non-quitting) party's quota
    await refundQuota(partnerId);

    // Notify partner
    try {
      const io = req.app.get('io');
      if (io) {
        io.to(`user:${partnerId}`).emit('vibe_quit', { sessionId: id, byUserId: userId });
      }
    } catch (_) {}

    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to quit' });
  }
};

// ──────────────────────────────────────────────
// POST /ad-grant — grant +2 bonus uses after watching 2 ads
// ──────────────────────────────────────────────
export const grantAdBonus = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const date = todayStr();
    await prisma.vibeUsage.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, used: 0, bonusUses: 2 },
      update: { bonusUses: { increment: 2 } },
    });
    const quota = await computeQuota(userId);
    res.json({ ok: true, quota });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to grant bonus' });
  }
};

// ──────────────────────────────────────────────
// Disconnect handler (called from socket on disconnect)
// ──────────────────────────────────────────────
export async function handleVibeDisconnect(userId: string, io?: any) {
  try {
    // Find active session where this user is a participant
    const session = await prisma.vibeSession.findFirst({
      where: {
        status: 'active',
        OR: [{ user1Id: userId }, { user2Id: userId }],
      },
    });
    if (!session) return;

    const isUser1 = userId === session.user1Id;
    const partnerId = isUser1 ? session.user2Id : session.user1Id;

    await prisma.vibeSession.update({
      where: { id: session.id },
      data: {
        status: 'ended',
        endedAt: new Date(),
        ...(isUser1 ? { user1Quit: true } : { user2Quit: true }),
      },
    });

    // Refund the remaining (still-connected) party
    await refundQuota(partnerId);

    // Notify partner
    try {
      if (io) {
        io.to(`user:${partnerId}`).emit('vibe_quit', { sessionId: session.id, byUserId: userId });
      }
    } catch (_) {}
  } catch (e) {
    console.error('handleVibeDisconnect error:', e);
  }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
async function sessionShape(session: any, userId: string) {
  const isUser1 = session.user1Id === userId;
  const myCustom = isUser1 ? session.user1CustomPrompt : session.user2CustomPrompt;
  const partnerCustom = isUser1 ? session.user2CustomPrompt : session.user1CustomPrompt;
  const percent = Math.round((session.score / SCORE_TARGET) * 100);
  return {
    id: session.id,
    roomId: session.roomId,
    mood: session.mood,
    status: session.status,
    user1Revealed: session.user1Revealed,
    user2Revealed: session.user2Revealed,
    user1Quit: session.user1Quit,
    user2Quit: session.user2Quit,
    score: session.score,
    percent,
    myCustomPrompt: myCustom,
    partnerCustomPrompt: partnerCustom,
    canReveal: percent >= 80 && session.status === 'active',
    iRevealed: isUser1 ? session.user1Revealed : session.user2Revealed,
    partnerRevealed: isUser1 ? session.user2Revealed : session.user1Revealed,
    partnerId: isUser1 ? session.user2Id : session.user1Id,
    createdAt: session.createdAt,
  };
}
