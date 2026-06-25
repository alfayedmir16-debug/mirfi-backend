"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const db_1 = __importDefault(require("./config/db"));
const postController_1 = require("./controllers/postController");
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const callRoutes_1 = __importDefault(require("./routes/callRoutes"));
const creatorRoutes_1 = __importDefault(require("./routes/creatorRoutes"));
const groupRoutes_1 = __importDefault(require("./routes/groupRoutes"));
const messageRoutes_1 = __importDefault(require("./routes/messageRoutes"));
const noteRoutes_1 = __importDefault(require("./routes/noteRoutes"));
const postRoutes_1 = __importDefault(require("./routes/postRoutes"));
const storageRoutes_1 = __importDefault(require("./routes/storageRoutes"));
const storyRoutes_1 = __importDefault(require("./routes/storyRoutes"));
const supportRoutes_1 = __importDefault(require("./routes/supportRoutes"));
const userRoutes_1 = __importDefault(require("./routes/userRoutes"));
const utilsRoutes_1 = __importDefault(require("./routes/utilsRoutes"));
const socketHandler_1 = require("./utils/socketHandler");
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const PORT = process.env.PORT || 5000;
// Socket.IO
const io = new socket_io_1.Server(server, {
    cors: { origin: '*' },
    path: '/ws',
});
exports.io = io;
(0, socketHandler_1.setupSocket)(io);
// Make io accessible in routes
app.set('io', io);
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' }));
// Routes
app.use('/api/auth', authRoutes_1.default);
app.use('/api/posts', postRoutes_1.default);
app.use('/api/creator', creatorRoutes_1.default);
app.use('/api/storage', storageRoutes_1.default);
app.use('/api/users', userRoutes_1.default);
app.use('/api/stories', storyRoutes_1.default);
app.use('/api/messages', messageRoutes_1.default);
app.use('/api/notes', noteRoutes_1.default);
app.use('/api/groups', groupRoutes_1.default);
app.use('/api/support', supportRoutes_1.default);
app.use('/api/calls', callRoutes_1.default);
app.use('/api/utils', utilsRoutes_1.default);
// Basic Health Check Endpoint
app.get('/health', async (req, res) => {
    try {
        await db_1.default.$queryRaw `SELECT 1`;
        res.status(200).json({
            status: 'UP',
            message: 'MirFi Express Server & PostgreSQL Database are live! 🚀'
        });
    }
    catch (error) {
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
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(err.status || 500).json({
        error: err.message || 'Internal Server Error',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
});
server.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT} 🚀`);
    (0, postController_1.startPostScheduler)();
});
