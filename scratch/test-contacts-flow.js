// Quick test: call the supabase-compat endpoint the same way the contacts page would
const http = require('http');

const payload = JSON.stringify({
  table: 'contacts',
  method: 'select',
  filters: [],
  data: null,
  order: { field: 'created_at', ascending: false },
  limit: null,
  countMode: 'exact',
  single: false,
  isUpsert: false,
  range: { from: 0, to: 24 }
});

// We need cookies to authenticate. Let's just use prisma directly to verify.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const tenantId = 'ce75ad7b-fd5f-45d7-bd90-ad2c964dcbb6';
  
  // Simulate what the compat endpoint does
  const count = await prisma.contact.count({ where: { tenantId } });
  console.log('Contact count:', count);
  
  const contacts = await prisma.contact.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 25,
    skip: 0
  });
  console.log('Contacts:', JSON.stringify(contacts, null, 2));
  
  if (contacts.length > 0) {
    const contactIds = contacts.map(c => c.id);
    const contactTags = await prisma.contactTag.findMany({
      where: { contactId: { in: contactIds } }
    });
    console.log('ContactTags:', JSON.stringify(contactTags, null, 2));
  }
  
  await prisma.$disconnect();
}

run().catch(console.error);
