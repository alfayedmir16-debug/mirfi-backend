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
import messageRoutes from './routes/messageRoutes';
import noteRoutes from './routes/noteRoutes';
import postRoutes from './routes/postRoutes';
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
  cors: { origin: '*' },
  path: '/ws',
});
setupSocket(io);

// Make io accessible in routes
app.set('io', io);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

