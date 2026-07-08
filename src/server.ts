import dotenv from 'dotenv';
dotenv.config();

import cors from 'cors';
import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import prisma from './config/db';
import { startPostScheduler } from './controllers/postController';
import authRoutes from './routes/authRoutes';
import callRoutes from './routes/callRoutes';
import creatorRoutes from './routes/creatorRoutes';
import e2eeRoutes from './routes/e2eeRoutes';
import groupRoutes from './routes/groupRoutes';
import highlightRoutes from './routes/highlightRoutes';
import messageRoutes from './routes/messageRoutes';
import monetizeRoutes from './routes/monetizeRoutes';
import noteRoutes from './routes/noteRoutes';
import postRoutes from './routes/postRoutes';
import soundRoutes from './routes/soundRoutes';
import storageRoutes from './routes/storageRoutes';
import storyRoutes from './routes/storyRoutes';
import supportRoutes from './routes/supportRoutes';
import userRoutes from './routes/userRoutes';
import utilsRoutes from './routes/utilsRoutes';
import { setupSocket } from './utils/socketHandler';

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

// Socket.IO
const io = new SocketIOServer(server, {
  cors: { origin: process.env.NODE_ENV === 'production' ? ['https://mirfi.app'] : '*' },
  path: '/ws',
});
setupSocket(io);

// Make io accessible in routes
app.set('io', io);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ─── API Rate Limiting ───
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 100; // max requests per window
const RATE_WINDOW = 60 * 1000; // 1 minute window

app.use((req, res, next) => {
  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
    return next();
  }

  if (entry.count >= RATE_LIMIT) {
    return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }

  entry.count++;
  next();
});

// Clean up rate limit map every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetTime) rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/creator', creatorRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/users', userRoutes);
app.use('/api/stories', storyRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/highlights', highlightRoutes);
app.use('/api/monetize', monetizeRoutes);
app.use('/api/sounds', soundRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/e2ee', e2eeRoutes);
app.use('/api/utils', utilsRoutes);

// Basic Health Check Endpoint
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      status: 'UP',
      message: 'MirFi Express Server & PostgreSQL Database are live! 🚀'
    });
  } catch (error: any) {
    res.status(500).json({
      status: 'DOWN',
      message: 'Failed to connect to the database.',
      error: error.message
    });
  }
});

// 404 handler — return JSON instead of HTML
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.path });
});

// Error handler — return JSON instead of HTML
app.use((err: any, req: any, res: any, next: any) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
});

server.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT} 🚀`);
  startPostScheduler();
});

export { io };

