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
require("dotenv/config");
const bcrypt = __importStar(require("bcryptjs"));
const db_1 = __importDefault(require("../src/config/db"));
const VALID_VIDEO_URLS = [
    'https://www.w3schools.com/html/mov_bbb.mp4',
    'https://www.w3schools.com/html/movie.mp4',
    'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4',
    'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_30MB.mp4',
    'https://test-videos.co.uk/vids/testvideo/mp4/h264/720/Big_Buck_Bunny_720_10s_5MB.mp4',
];
const getRandomVideo = () => VALID_VIDEO_URLS[Math.floor(Math.random() * VALID_VIDEO_URLS.length)];
const SEED_USERS = [
    { email: 'alice@mirfi.app', username: 'alice_wonder', displayName: 'Alice Wonderland', bio: 'Photographer & dreamer' },
    { email: 'bob@mirfi.app', username: 'bob_builder', displayName: 'Bob The Builder', bio: 'Building things that matter' },
    { email: 'charlie@mirfi.app', username: 'charlie_chaplin', displayName: 'Charlie Chaplin', bio: 'Life is a comedy' },
    { email: 'diana@mirfi.app', username: 'diana_prince', displayName: 'Diana Prince', bio: 'Warrior for justice' },
    { email: 'echo@mirfi.app', username: 'echo_fox', displayName: 'Echo Fox', bio: 'Gamer & streamer' },
];
const AVATARS = [
    'https://api.dicebear.com/7.x/adventurer/svg?seed=alice',
    'https://api.dicebear.com/7.x/adventurer/svg?seed=bob',
    'https://api.dicebear.com/7.x/adventurer/svg?seed=charlie',
    'https://api.dicebear.com/7.x/adventurer/svg?seed=diana',
    'https://api.dicebear.com/7.x/adventurer/svg?seed=echo',
];
const REEL_CATEGORIES = ['entertainment', 'education', 'music', 'dance'];
const IMAGE_CATEGORIES = ['travel', 'food', 'lifestyle'];
const CAPTIONS = [
    'Living my best life! #lifestyle',
    'Check out this amazing view #travel',
    'Nothing beats homemade pasta #food',
    'Dancing like nobody is watching #dance',
    'Code, sleep, repeat #tech',
    'Nature is the best therapy #travel',
    'Good vibes only #music',
    'Game on! #gaming',
];
const getRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];
async function seed() {
    try {
        console.log('🌱 Starting database seed...');
        const userCount = await db_1.default.user.count();
        if (userCount > 0) {
            console.log('⚠️  Database already has users. Skipping seed to avoid data loss.');
            console.log(`Found ${userCount} existing users.`);
            await db_1.default.$disconnect();
            return;
        }
        await db_1.default.like.deleteMany();
        await db_1.default.comment.deleteMany();
        await db_1.default.save.deleteMany();
        await db_1.default.post.deleteMany();
        await db_1.default.follow.deleteMany();
        await db_1.default.user.deleteMany();
        const users = [];
        for (let i = 0; i < SEED_USERS.length; i++) {
            const hashedPassword = await bcrypt.hash('password123', 10);
            const user = await db_1.default.user.create({
                data: {
                    email: SEED_USERS[i].email,
                    username: SEED_USERS[i].username,
                    displayName: SEED_USERS[i].displayName,
                    profilePicture: AVATARS[i],
                    passwordHash: hashedPassword,
                    bio: SEED_USERS[i].bio,
                    isVerified: i < 3,
                },
            });
            users.push(user);
            console.log(`✅ Created user: ${user.username}`);
        }
        for (const user of users) {
            for (let i = 0; i < 3; i++) {
                await db_1.default.post.create({
                    data: {
                        userId: user.id,
                        type: 'reel',
                        mediaUrl: getRandomVideo(),
                        thumbnailUrl: `https://picsum.photos/seed/reel_${user.username}_${i}/400/400`,
                        caption: getRandom(CAPTIONS),
                        category: getRandom(REEL_CATEGORIES),
                    },
                });
            }
            for (let i = 0; i < 2; i++) {
                await db_1.default.post.create({
                    data: {
                        userId: user.id,
                        type: 'image',
                        mediaUrl: `https://picsum.photos/seed/${user.username}_${i}/640/920`,
                        thumbnailUrl: `https://picsum.photos/seed/thumb_${user.username}_${i}/400/400`,
                        caption: getRandom(CAPTIONS),
                        category: getRandom(IMAGE_CATEGORIES),
                    },
                });
            }
        }
        console.log('✅ Created posts & reels');
        for (let i = 0; i < users.length; i++) {
            for (let j = 0; j < users.length; j++) {
                if (i !== j && Math.random() > 0.5) {
                    await db_1.default.follow.create({
                        data: {
                            followerId: users[i].id,
                            followingId: users[j].id,
                        },
                    });
                }
            }
        }
        console.log('✅ Created follows');
        console.log('🎉 Database seeded successfully!');
    }
    catch (error) {
        console.error('❌ Seed error:', error.message);
        process.exit(1);
    }
    finally {
        await db_1.default.$disconnect();
    }
}
seed();
