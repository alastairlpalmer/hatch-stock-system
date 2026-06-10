import express from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { generateToken, authMiddleware, optionalAuth } from '../middleware/auth.js';

const router = express.Router();

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

export default router;
