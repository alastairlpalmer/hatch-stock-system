import { PrismaClient } from '@prisma/client';

// Guard against the June 2026 outage class: on Supabase the app must connect
// through the transaction pooler (port 6543) with pgbouncer=true and an
// explicit connection_limit — the session pooler caps at ~15 clients and
// Prisma's default pool exhausts it (EMAXCONNSESSION), silently halting the
// sales poll. Misconfiguration is loud at boot instead of a silent outage
// weeks later. Warning only — non-Supabase URLs (local dev) pass through.
function checkPoolConfig(url) {
  if (!url || !url.includes('supabase.com')) return;
  const problems = [];
  if (!url.includes('pooler.supabase.com:6543')) {
    problems.push('not using the transaction pooler (expected pooler.supabase.com:6543)');
  }
  if (!url.includes('pgbouncer=true')) problems.push('missing pgbouncer=true');
  if (!url.includes('connection_limit=')) problems.push('missing an explicit connection_limit');
  if (problems.length > 0) {
    console.warn(
      `⚠️  DATABASE_URL pool config: ${problems.join('; ')}. ` +
      'See hatch-backend/.env.example — the session pooler exhausts under load and silently halts the VendLive sales poll.'
    );
  }
}
// Prevent multiple instances in development
const globalForPrisma = globalThis;

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Test database connection
export async function testConnection() {
  // Checked here rather than at module scope: static imports evaluate before
  // index.js runs dotenv.config(), so DATABASE_URL isn't visible any earlier.
  checkPoolConfig(process.env.DATABASE_URL);
  try {
    await prisma.$connect();
    console.log('✅ Database connection successful');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
}

export default prisma;
