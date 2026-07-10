const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const users = await prisma.user.findMany({
      include: { profile: true }
    });
    console.log('=== USERS ===');
    console.log(JSON.stringify(users, null, 2));

    const contacts = await prisma.contact.findMany();
    console.log('=== CONTACTS ===');
    console.log(JSON.stringify(contacts, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
