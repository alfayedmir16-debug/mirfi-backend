import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function check() {
  const users = await prisma.user.findMany({ select: { id: true, username: true, email: true } });
  if (users.length === 0) { console.log('No users found - need to sign up'); }
  else { users.forEach(u => console.log('User:', u.username, u.email)); }
  await prisma.$disconnect();
}
check();
