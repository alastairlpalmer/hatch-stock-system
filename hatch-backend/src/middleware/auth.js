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

// Generate JWT token
export function generateToken(userId) {
  return jwt.sign({ userId }, getJwtSecret(), { expiresIn: '7d' });
}
