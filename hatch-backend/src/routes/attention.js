import express from 'express';
import { z } from 'zod';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

// Dismissals for the Dashboard "Needs attention" rail. Reads are open to any
// signed-in user; the POST/DELETE writes are NOT on the operational-write
// allowlist, so rolePolicy makes them admin-only automatically (and no-ops
// while AUTH_ENABLED is off, matching the rest of the API).

const dismissSchema = z.object({
  itemId: z.string().min(1).max(100),
  // The item's rendered title — counts live in it, so a changed signal breaks
  // the signature match and the item resurfaces.
  signature: z.string().min(1).max(300),
});

// Active dismissals (the frontend applies the 7-day expiry + signature match).
router.get('/', asyncHandler(async (req, res) => {
  const dismissals = await prisma.attentionDismissal.findMany({
    orderBy: { createdAt: 'desc' },
  });
  res.json(dismissals);
}));

// Dismiss (or re-dismiss with a fresh signature) an item.
router.post('/', asyncHandler(async (req, res) => {
  const { itemId, signature } = dismissSchema.parse(req.body);

  const dismissal = await prisma.attentionDismissal.upsert({
    where: { itemId },
    create: { itemId, signature, dismissedBy: req.user?.email ?? null },
    update: { signature, dismissedBy: req.user?.email ?? null, createdAt: new Date() },
  });

  res.status(201).json(dismissal);
}));

// Restore a dismissed item.
router.delete('/:itemId', asyncHandler(async (req, res) => {
  await prisma.attentionDismissal.deleteMany({ where: { itemId: req.params.itemId } });
  res.json({ success: true });
}));

export default router;
