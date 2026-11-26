/**
 * Applies the newest, purely additive schema changes to the database in
 * DATABASE_URL, skipping anything that already exists (safe to run twice):
 *
 *   - Review* tables (8)        (Google review module)
 *   - LeadFollowUp table        (sales follow-up engine)
 *   - DripSequence / DripEnrollment tables (drip sequences)
 *   - FlowRun.resumeAt column   (flow delay step)
 *   - GymPackage / GymMember / GymMembership / MemberMessageLog (health & fitness members)
 *   - ReviewBusiness.socialLinks + ReviewEngagementEvent.platform (universal QR page)
 *
 * Why not `prisma migrate deploy`: this database was not created with
 * Prisma Migrate (there is no _prisma_migrations table), so `migrate deploy`
 * would try to replay the baseline and fail. These statements only add
 * objects; nothing is altered or dropped.
 *
 *   node scripts/apply-new-tables.js            # apply
 *   node scripts/apply-new-tables.js --dry-run  # show what would run
 */

require('dotenv').config({ path: '.env' });
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

const STEPS = [
  { dir: '20261122000000_google_review_module', table: 'ReviewBusiness' },
  { dir: '20261123000000_lead_follow_up', table: 'LeadFollowUp' },
  { dir: '20261124000000_drip_sequences', table: 'DripSequence' },
  { dir: '20261125000000_flow_delay_resume', table: 'FlowRun', column: 'resumeAt' },
  { dir: '20261126000000_gym_members_packages', table: 'GymPackage' },
  { dir: '20261127000000_review_social_links', table: 'ReviewBusiness', column: 'socialLinks' },
];

async function exists({ table, column }) {
  const rows = column
    ? await prisma.$queryRawUnsafe('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', table, column)
    : await prisma.$queryRawUnsafe('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', table);
  return rows.length > 0;
}

(async () => {
  for (const step of STEPS) {
    const label = step.column ? `${step.table}.${step.column}` : step.table;
    if (await exists(step)) {
      console.log(`✓ ${label} already exists - skipped`);
      continue;
    }
    const file = path.join(__dirname, '..', 'prisma', 'migrations', step.dir, 'migration.sql');
    const statements = fs
      .readFileSync(file, 'utf8')
      .split(/;\s*(?:\r?\n|$)/)
      .map((s) => s.trim())
      .filter(Boolean);
    console.log(`→ ${label}: ${statements.length} statement(s) from ${step.dir}`);
    if (dryRun) continue;
    for (const sql of statements) await prisma.$executeRawUnsafe(sql);
    console.log(`✓ ${label} created`);
  }
  await prisma.$disconnect();
})().catch(async (error) => {
  console.error('Failed:', error.message);
  await prisma.$disconnect();
  process.exit(1);
});
