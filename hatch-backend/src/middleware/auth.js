import jwt from 'jsonwebtoken';
import prisma from '../utils/db.js';

// With auth enabled there is no fallback secret — index.js fails fast at
// startup if JWT_SECRET is missing. The dev fallback only exists so login
// works locally while AUTH_ENABLED is off.
function getJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.AUTH_ENABLED === 'true') {
    throw new Error('JWT_SECRET must be set when AUTH_ENABLED=true');
  }
  return 'dev-only-insecure-secret';
}

// Middleware to verify JWT token
export async function authMiddleware(req, res, next) {
  // Skip auth if disabled
  if (process.env.AUTH_ENABLED !== 'true') {
    return next();
  }

  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, getJwtSecret());

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, name: true, role: true },
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Optional auth - doesn't fail if no token
export async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, getJwtSecret());
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, name: true, role: true },
    });
    req.user = user;
  } catch (error) {
    // Ignore auth errors for optional auth
  }
  
  next();
}

// Admin only middleware
export function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ============ ROLE POLICY ============
//
// One auditable table instead of per-route sprinkling. The rule:
//   - Reads (GET/HEAD/OPTIONS): any authenticated user.
//   - Writes: admin only, EXCEPT the on-the-ground operational writes a
//     restocker needs on their phone (listed below).
// Like authMiddleware, this is a NO-OP while AUTH_ENABLED !== 'true', so the
// code is safe to deploy long before auth is switched on, and setting
// AUTH_ENABLED=false at any time reverts the whole API to no-auth (the
// documented lockout escape hatch).
//
// Paths here are checked against req.originalUrl's path (the full /api/...
// path), after the auth gate has populated req.user.
const OPERATIONAL_WRITE_ALLOWLIST = [
  // Machine stock check at the machine
  { method: 'POST', pattern: /^\/api\/inventory\/stock-checks$/ },
  // Loading a machine on the route run
  { method: 'POST', pattern: /^\/api\/inventory\/restocks$/ },
  // Taking packed stock out of the warehouse
  { method: 'POST', pattern: /^\/api\/inventory\/removals$/ },
  // Pick lists: generate, tick-off updates, complete, return leftovers
  { method: 'POST', pattern: /^\/api\/pick-lists(\/|$)/ },
  { method: 'PUT', pattern: /^\/api\/pick-lists\/[^/]+$/ },
  // Booking a delivery in (incl. fresh-meal flavour allocation)
  { method: 'POST', pattern: /^\/api\/orders\/[^/]+\/receive$/ },
  // Freshening machine stock from VendLive before/during a run
  { method: 'POST', pattern: /^\/api\/vendlive\/stock\/sync-location\/[^/]+$/ },
  // Changing your own password
  { method: 'POST', pattern: /^\/api\/auth\/me\/password$/ },
];

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function rolePolicy(req, res, next) {
  if (process.env.AUTH_ENABLED !== 'true') return next();
  if (READ_METHODS.has(req.method)) return next();
  if (req.user?.role === 'admin') return next();

  // /api/auth manages its own admin checks (login/register/users/reset)
  const path = req.originalUrl.split('?')[0];
  if (path.startsWith('/api/auth/') && !path.startsWith('/api/auth/me/')) return next();

  const allowed = OPERATIONAL_WRITE_ALLOWLIST.some(
    (rule) => rule.method === req.method && rule.pattern.test(path)
  );
  if (allowed) return next();

  return res.status(403).json({
    error: 'Admin access required for this action',
  });
}

// Generate JWT token
export function generateToken(userId) {
  return jwt.sign({ userId }, getJwtSecret(), { expiresIn: '7d' });
}
