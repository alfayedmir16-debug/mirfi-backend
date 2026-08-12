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
const e2eeRoutes_1 = __importDefault(require("./routes/e2eeRoutes"));
const groupRoutes_1 = __importDefault(require("./routes/groupRoutes"));
const highlightRoutes_1 = __importDefault(require("./routes/highlightRoutes"));
const messageRoutes_1 = __importDefault(require("./routes/messageRoutes"));
const monetizeRoutes_1 = __importDefault(require("./routes/monetizeRoutes"));
const noteRoutes_1 = __importDefault(require("./routes/noteRoutes"));
const postRoutes_1 = __importDefault(require("./routes/postRoutes"));
const soundRoutes_1 = __importDefault(require("./routes/soundRoutes"));
const storageRoutes_1 = __importDefault(require("./routes/storageRoutes"));
const storyRoutes_1 = __importDefault(require("./routes/storyRoutes"));
const supportRoutes_1 = __importDefault(require("./routes/supportRoutes"));
const userRoutes_1 = __importDefault(require("./routes/userRoutes"));
const utilsRoutes_1 = __importDefault(require("./routes/utilsRoutes"));
const vibeRoutes_1 = __importDefault(require("./routes/vibeRoutes"));
const socketHandler_1 = require("./utils/socketHandler");
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const PORT = process.env.PORT || 5000;
// Socket.IO
const io = new socket_io_1.Server(server, {
    cors: { origin: process.env.NODE_ENV === 'production' ? ['https://mirfi.app'] : '*' },
    path: '/ws',
});
exports.io = io;
(0, socketHandler_1.setupSocket)(io);
// Make io accessible in routes
app.set('io', io);
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' }));
// ─── API Rate Limiting ───
const rateLimitMap = new Map();
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
        if (now > entry.resetTime)
            rateLimitMap.delete(ip);
    }
}, 5 * 60 * 1000);
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
app.use('/api/highlights', highlightRoutes_1.default);
app.use('/api/monetize', monetizeRoutes_1.default);
app.use('/api/sounds', soundRoutes_1.default);
app.use('/api/support', supportRoutes_1.default);
app.use('/api/calls', callRoutes_1.default);
app.use('/api/e2ee', e2eeRoutes_1.default);
app.use('/api/vibe', vibeRoutes_1.default);
app.use('/api/utils', utilsRoutes_1.default);
// ─── App Version Config (Force/Soft Update) ───
app.get('/api/app/config', async (req, res) => {
    try {
        // Check if AppConfig table exists, otherwise use defaults
        let config = null;
        try {
            config = await db_1.default.appConfig.findFirst({ where: { key: 'app_update' } });
        }
        catch { }
        if (config?.value) {
            return res.json(JSON.parse(config.value));
        }
        // Default config (no force update)
        res.json({
            minVersion: '1.0.0', // Minimum allowed version (force update below this)
            latestVersion: '1.0.0', // Latest available version (soft update if below this)
            forceUpdate: false, // Master switch for force update
            softUpdate: false, // Master switch for soft update
            updateUrl: 'https://play.google.com/store/apps/details?id=com.mirfi',
            maintenanceMode: false, // If true, show maintenance screen
            maintenanceMessage: '',
        });
    }
    catch (e) {
        res.json({ minVersion: '1.0.0', latestVersion: '1.0.0', forceUpdate: false, softUpdate: false, updateUrl: '', maintenanceMode: false });
    }
});
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
