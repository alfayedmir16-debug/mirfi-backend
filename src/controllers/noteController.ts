import prisma from '../config/db';

// Get notes from people I follow (for display on chat list top)
export const getNotesFeed = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Get people I follow
    const following = await prisma.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });

    const followingIds = following.map((f) => f.followingId);

    // Get active notes from them (not expired)
    const notes = await prisma.note.findMany({
      where: {
        userId: { in: followingIds },
        expiresAt: { gt: new Date() },
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
      orderBy: { createdAt: 'desc' },
    });

    res.json(notes);
  } catch (e: any) {
    console.error('getNotesFeed error:', e);
    res.status(500).json({ error: e.message || 'Failed to fetch notes' });
  }
};

// Get my current note
export const getMyNote = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const note = await prisma.note.findUnique({
      where: { userId },
    });

    res.json(note);
  } catch (e: any) {
    console.error('getMyNote error:', e);
    res.status(500).json({ error: e.message || 'Failed to fetch note' });
  }
};

// Create or update my note (24h expiry)
export const upsertNote = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { text, emoji } = req.body;
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Note text is required' });
    }
    if (text.length > 60) {
      return res.status(400).json({ error: 'Note text must be 60 characters or less' });
    }

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const note = await prisma.note.upsert({
      where: { userId },
      create: {
        userId,
        text: text.trim(),
        emoji: emoji || null,
        expiresAt,
      },
      update: {
        text: text.trim(),
        emoji: emoji || null,
        expiresAt,
      },
    });

    res.json(note);
  } catch (e: any) {
    console.error('upsertNote error:', e);
    res.status(500).json({ error: e.message || 'Failed to save note' });
  }
};

// Delete my note
export const deleteNote = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    await prisma.note.delete({
      where: { userId },
    });

    res.json({ success: true });
  } catch (e: any) {
    console.error('deleteNote error:', e);
    res.status(500).json({ error: e.message || 'Failed to delete note' });
  }
};
