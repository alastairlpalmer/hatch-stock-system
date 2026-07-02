import express from 'express';
import { z } from 'zod';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { contentDispositionAttachment } from '../utils/http.js';
import { generateAndStoreReport, previousCalendarMonth, REPORT_LIST_SELECT } from '../services/client-report.js';

const router = express.Router();

// Client report generator. startDate/endDate default to the previous calendar
// month. locationName (string|array) or routeId scope the report; omit both for
// all locations. The report is strictly client-safe (no revenue/cost/margin/
// waste) — enforced by services/report-whitelist.js.
export const generateReportSchema = z.object({
  clientName: z.string().min(1, 'Client name is required'),
  siteName: z.string().min(1, 'Site name is required'),
  startDate: z.string().min(1).optional(),
  endDate: z.string().min(1).optional(),
  locationName: z.union([z.string(), z.array(z.string())]).optional(),
  routeId: z.string().min(1).optional(),
  generatedBy: z.string().optional(),
});

router.post('/client', asyncHandler(async (req, res) => {
  const input = generateReportSchema.parse(req.body);

  // Default to the previous calendar month (end-of-day inclusive).
  let { startDate, endDate } = input;
  if (!startDate || !endDate) {
    const { start, end } = previousCalendarMonth();
    const endOfDay = new Date(end);
    endOfDay.setHours(23, 59, 59, 999);
    startDate = start.toISOString();
    endDate = endOfDay.toISOString();
  }

  const report = await generateAndStoreReport({ ...input, startDate, endDate });
  res.status(201).json(report);
}));

// Filing system: list generated reports (metadata only — never the PDF bytes),
// newest first.
router.get('/client', asyncHandler(async (req, res) => {
  const reports = await prisma.clientReport.findMany({
    orderBy: { generatedAt: 'desc' },
    take: 200,
    select: REPORT_LIST_SELECT,
  });
  res.json(reports);
}));

// ============ WASTE REPORT (internal) ============

// Mounted at /api/reports with NO auth exemption (unlike the client-report
// PDFs this includes costs) — it is an INTERNAL report and must never pass
// through the client-safe whitelist path.

/** 'YYYY-MM' month key for a timestamp's UTC date part. */
function monthKey(date) {
  return new Date(date).toISOString().slice(0, 7);
}

/**
 * The last `months` calendar-month keys (UTC), oldest first, ending with the
 * month containing `now`. Pure; exported for tests.
 */
export function lastMonthKeys(months, now = new Date()) {
  const keys = [];
  for (let i = months - 1; i >= 0; i--) {
    keys.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  }
  return keys;
}

/**
 * Loss-oriented variance for a stock-check item. VendLive-generated checks
 * store variance = expected − confirmed (POSITIVE = loss), while manual checks
 * store variance = counted − expected (NEGATIVE = loss) — mirrors the
 * normalisation on the Shrinkage page. Returns units oriented so positive =
 * loss, negative = overage. Pure; exported for tests.
 */
export function lossOrientedVariance(check, item) {
  const isVendlive = check.source === 'vendlive';
  if (item.variance != null) {
    return isVendlive ? item.variance : -item.variance;
  }
  // Fallback when variance is missing: expected − counted (positive = loss)
  return (item.expected ?? 0) - (item.counted ?? 0);
}

/**
 * Bucket write-off removals and expired/damaged shrinkage into calendar
 * months, oldest first. Every month in the window is present (zero-filled).
 * Write-offs are costed at the product's current unit cost; shrinkage only
 * counts LOSSES (overages never reduce waste). Pure; exported for tests.
 *
 * @param {object} args
 * @param {Array<{ createdAt, items: Array<{ sku, quantity }> }>} args.writeOffs
 * @param {Array<{ createdAt, source, items: Array<{ reason?, variance?, expected?, counted? }> }>} args.stockChecks
 * @param {Map<string, number>} args.unitCostBySku
 * @param {number} args.months
 * @param {Date} [args.now]
 * @returns {Array<{ month, writeOffUnits, writeOffCost, shrinkageExpiredUnits, shrinkageDamagedUnits }>}
 */
export function bucketWasteByMonth({ writeOffs, stockChecks, unitCostBySku, months, now = new Date() }) {
  const buckets = new Map(lastMonthKeys(months, now).map((key) => [key, {
    month: key,
    writeOffUnits: 0,
    writeOffCost: 0,
    shrinkageExpiredUnits: 0,
    shrinkageDamagedUnits: 0,
  }]));

  for (const removal of writeOffs || []) {
    const bucket = buckets.get(monthKey(removal.createdAt));
    if (!bucket) continue; // outside the window
    for (const item of Array.isArray(removal.items) ? removal.items : []) {
      const qty = item.quantity || 0;
      bucket.writeOffUnits += qty;
      bucket.writeOffCost += qty * (unitCostBySku?.get(item.sku) || 0);
    }
  }

  for (const check of stockChecks || []) {
    const bucket = buckets.get(monthKey(check.createdAt));
    if (!bucket) continue;
    for (const item of Array.isArray(check.items) ? check.items : []) {
      if (item.reason !== 'expired' && item.reason !== 'damaged') continue;
      const loss = lossOrientedVariance(check, item);
      if (loss <= 0) continue;
      if (item.reason === 'expired') bucket.shrinkageExpiredUnits += loss;
      else bucket.shrinkageDamagedUnits += loss;
    }
  }

  return [...buckets.values()];
}

// Waste report: per-calendar-month write-offs (StockRemovals journalled by
// POST /api/inventory/batches/:id/write-off, which stamps routeName
// 'Write-off (<reason>)' — that marker is the filter) and expired/damaged
// shrinkage from stock checks, plus a snapshot of expired-but-still-on-shelf
// warehouse batches.
router.get('/waste', asyncHandler(async (req, res) => {
  // Explicit parse, not `parseInt(...) || 6`: months=0 must be rejected as
  // out of range, not silently coerced to the default.
  const months = req.query.months === undefined ? 6 : Number(req.query.months);
  if (!Number.isInteger(months) || months < 1 || months > 24) {
    return res.status(400).json({ error: 'months must be an integer between 1 and 24' });
  }

  const now = new Date();
  const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const [writeOffs, stockChecks, expiredBatches] = await Promise.all([
    prisma.stockRemoval.findMany({
      where: { routeName: { startsWith: 'Write-off' }, createdAt: { gte: windowStart } },
      select: { createdAt: true, items: true },
    }),
    prisma.stockCheck.findMany({
      where: { createdAt: { gte: windowStart } },
      select: { createdAt: true, source: true, items: true },
    }),
    // Expired-but-still-on-shelf: expiry DATE-PART strictly before today.
    // Expiry dates are stored at UTC midnight, so `< today's UTC midnight`
    // IS the date-part comparison (a batch expiring today is not yet waste).
    prisma.stockBatch.findMany({
      where: { remainingQty: { gt: 0 }, expiryDate: { lt: todayUtc } },
      include: {
        product: { select: { name: true, unitCost: true } },
        warehouse: { select: { name: true } },
      },
      orderBy: { expiryDate: 'asc' },
    }),
  ]);

  // Cost write-offs at the product's CURRENT unit cost — the removal journal
  // doesn't capture cost at write-off time, so this is the best proxy.
  const writeOffSkus = new Set();
  for (const removal of writeOffs) {
    for (const item of Array.isArray(removal.items) ? removal.items : []) writeOffSkus.add(item.sku);
  }
  const products = writeOffSkus.size
    ? await prisma.product.findMany({
        where: { sku: { in: [...writeOffSkus] } },
        select: { sku: true, unitCost: true },
      })
    : [];
  const unitCostBySku = new Map(products.map((p) => [p.sku, p.unitCost || 0]));

  res.json({
    months: bucketWasteByMonth({ writeOffs, stockChecks, unitCostBySku, months, now }),
    currentExpiredOnShelf: {
      units: expiredBatches.reduce((sum, b) => sum + b.remainingQty, 0),
      cost: expiredBatches.reduce((sum, b) => sum + b.remainingQty * (b.product?.unitCost || 0), 0),
      batches: expiredBatches.map((b) => ({
        sku: b.sku,
        name: b.product?.name || b.sku,
        warehouseName: b.warehouse?.name || b.warehouseId,
        remainingQty: b.remainingQty,
        expiryDate: b.expiryDate,
      })),
    },
  });
}));

// Download a stored report PDF.
router.get('/client/:id/download', asyncHandler(async (req, res) => {
  const report = await prisma.clientReport.findUnique({
    where: { id: req.params.id },
    select: { fileName: true, pdfData: true },
  });
  if (!report) return res.status(404).json({ error: 'Report not found' });

  res.setHeader('Content-Type', 'application/pdf');
  // ASCII-safe header — a non-ASCII char in fileName (e.g. an en-dash from a
  // multi-month period) would otherwise throw ERR_INVALID_CHAR and 500.
  res.setHeader('Content-Disposition', contentDispositionAttachment(report.fileName));
  res.send(Buffer.from(report.pdfData));
}));

export default router;
