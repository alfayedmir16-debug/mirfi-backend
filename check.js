const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function main() {
  const count = await p.follow.count({ where: { followingId: '886f1247-c24e-4a48-bc79-1ff239f94c52', status: 'accepted' } });
  console.log('DB Followers:', count);
  const user = await p.user.findUnique({ where: { id: '886f1247-c24e-4a48-bc79-1ff239f94c52' }, select: { id: true, username: true } });
  console.log('User:', user);
}
main().finally(() => p.$disconnect());
