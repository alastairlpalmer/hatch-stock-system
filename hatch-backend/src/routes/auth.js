import express from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { generateToken, authMiddleware, optionalAuth, adminOnly } from '../middleware/auth.js';

const router = express.Router();

// Shared validation. Exported so the schema tests can exercise them directly.
export const createUserSchema = z.object({
  email: z.string().trim().min(1).email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().trim().min(1).optional(),
});

export const resetPasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

// Register new user.
// Bootstrap: the first user ever created becomes admin. Once any user exists
// and auth is enabled, only admins may register further accounts — otherwise
// the open endpoint would let anyone mint themselves access.
router.post('/register', optionalAuth, asyncHandler(async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const userCount = await prisma.user.count();

  if (userCount > 0 && process.env.AUTH_ENABLED === 'true' && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can register new users' });
  }

  // Check if user exists
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Create user
  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name,
      role: userCount === 0 ? 'admin' : 'user',
    },
    select: { id: true, email: true, name: true, role: true },
  });

  const token = generateToken(user.id);

  res.status(201).json({ user, token });
}));

// Login
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  // Find user
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Check password
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = generateToken(user.id);

  res.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    token,
  });
}));

// Get current user
router.get('/me', authMiddleware, asyncHandler(async (req, res) => {
  res.json(req.user);
}));

// Public setup status — drives the login page: the "create admin account"
// bootstrap form is only offered while no user exists. Deliberately exposes
// nothing beyond a boolean and whether auth is enforced.
router.get('/setup-status', asyncHandler(async (req, res) => {
  const userCount = await prisma.user.count();
  res.json({
    needsBootstrap: userCount === 0,
    authEnabled: process.env.AUTH_ENABLED === 'true',
  });
}));

// Change your OWN password (any authenticated user — restockers included).
// Requires the current password so a stolen unlocked phone can't silently
// take over the account.
export const changeOwnPasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

router.post('/me/password', authMiddleware, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = changeOwnPasswordSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(401).json({ error: 'User not found' });

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) return res.status(403).json({ error: 'Current password is incorrect' });

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { password: hashedPassword } });
  res.json({ success: true });
}));

// ============ ADMIN USER MANAGEMENT ============
// All routes below require an authenticated admin. The real enforcement lives
// here (the frontend only hides the UI). When AUTH_ENABLED is off, authMiddleware
// is a no-op and req.user is undefined, so adminOnly blocks these in that mode —
// user management is only meaningful with auth enabled anyway.

// List all users (no password hashes).
router.get('/users', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  res.json(users);
}));

// Create a user login (always role 'user' — there is a single admin).
router.post('/users', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { email, password, name } = createUserSchema.parse(req.body);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, password: hashedPassword, name, role: 'user' },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  res.status(201).json(user);
}));

// Delete a user. Guard against an admin deleting themselves or the last admin.
router.delete('/users/:id', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (id === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (target.role === 'admin') {
    const adminCount = await prisma.user.count({ where: { role: 'admin' } });
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last admin account' });
    }
  }

  await prisma.user.delete({ where: { id } });
  res.json({ success: true });
}));

// Reset a user's password.
router.post('/users/:id/reset-password', authMiddleware, adminOnly, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { password } = resetPasswordSchema.parse(req.body);

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return res.status(404).json({ error: 'User not found' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  await prisma.user.update({ where: { id }, data: { password: hashedPassword } });
  res.json({ success: true });
}));

export default router;
