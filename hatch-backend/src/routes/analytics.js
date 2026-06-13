import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getDashboard } from '../services/analytics.js';

const router = express.Router();

/**
 * GET /api/analytics/dashboard
 * One payload for the whole Sales analytics dashboard: headline stats (+ vs
 * previous period), sales timing, product performance, margin analysis and
 * rule-based suggestions — all for a single date range + location scope so
 * every section is computed from the same numbers.
 *
 * Query: startDate, endDate, locationName (string or repeated), routeId
 */
router.get('/dashboard', asyncHandler(async (req, res) => {
  const data = await getDashboard(req.query);
  res.json(data);
}));

export default router;
