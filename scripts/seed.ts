import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import prisma from '../src/config/db';

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

const getRandom = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

async function seed(): Promise<void> {
  try {
    console.log('🌱 Starting database seed...');

    const userCount = await prisma.user.count();
    if (userCount > 0) {
      console.log('⚠️  Database already has users. Skipping seed to avoid data loss.');
      console.log(`Found ${userCount} existing users.`);
      await prisma.$disconnect();
      return;
    }

    await prisma.like.deleteMany();
    await prisma.comment.deleteMany();
    await prisma.save.deleteMany();
    await prisma.post.deleteMany();
    await prisma.follow.deleteMany();
    await prisma.user.deleteMany();

    const users = [];
    for (let i = 0; i < SEED_USERS.length; i++) {
      const hashedPassword = await bcrypt.hash('password123', 10);
      const user = await prisma.user.create({
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
        await prisma.post.create({
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
        await prisma.post.create({
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
          await prisma.follow.create({
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
  } catch (error: any) {
    console.error('❌ Seed error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seed();
