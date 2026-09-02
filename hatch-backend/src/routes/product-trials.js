import express from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { SALE_LOCATION_JOINS, SALE_LOCATION_ID } from '../utils/sales-location.js';
import { countTradingDaysInWindow } from '../utils/trading-days.js';
import {
  trialWindow,
  marginPerUnit,
  benchmarkMarginPerDay,
  computeTrialVerdict,
  ACTIVE_TRIAL_STATUSES,
} from '../services/product-trials.js';

const router = express.Router();

const createSchema = z.object({
  sku: z.string().min(1),
  locationIds: z.array(z.string().min(1)).min(1, 'Pick at least one machine to trial in'),
  trialQty: z.coerce.number().int().positive(),
  weeks: z.coerce.number().int().min(1).max(26).default(4),
  notes: z.string().nullish(),
  createdBy: z.string().nullish(),
});

const updateSchema = z.object({
  locationIds: z.array(z.string().min(1)).min(1).optional(),
  trialQty: z.coerce.number().int().positive().optional(),
  weeks: z.coerce.number().int().min(1).max(26).optional(),
  notes: z.string().nullish(),
  status: z.enum(['planned', 'ordered', 'live']).optional(),
});

const decideSchema = z.object({
  decision: z.enum(['adopt', 'reject']),
  note: z.string().nullish(),
  decidedBy: z.string().nullish(),
});

/**
 * Units sold per SKU at a set of locations since a date. One query however
 * many locations. Refunds excluded, matching the velocity engine.
 */
async function unitsSoldSince(locationIds, since) {
  if (!locationIds.length) return {};
  const rows = await prisma.$queryRaw`
    SELECT s.sku, COALESCE(SUM(s.quantity), 0)::int AS units
    FROM sales s
    ${SALE_LOCATION_JOINS}
    WHERE s.is_refunded = false
      AND ${SALE_LOCATION_ID} IN (${Prisma.join(locationIds)})
      AND s."timestamp" >= ${since}
    GROUP BY s.sku
  `;
  return Object.fromEntries(rows.map((r) => [r.sku, r.units]));
}

/**
 * Everything the UI needs to show one trial: where it is in its window, how it
 * is selling, what a typical facing in the same machines earns, and the
 * verdict that follows.
 *
 * The benchmark is computed over the SAME machines and the SAME period as the
 * trial. Comparing against a company-wide average would punish a product
 * trialled in a quiet machine and flatter one trialled in a busy one.
 */
async function decorateTrial(trial, now = new Date()) {
  const locationIds = Array.isArray(trial.locationIds) ? trial.locationIds : [];
  const window = trialWindow(trial, now, countTradingDaysInWindow);

  const [locations, product] = await Promise.all([
    prisma.location.findMany({
      where: { id: { in: locationIds } },
      select: { id: true, name: true },
    }),
    prisma.product.findUnique({
      where: { sku: trial.sku },
      select: { sku: true, name: true, unitCost: true, salePrice: true, lifecycle: true, category: true },
    }),
  ]);

  const base = {
    ...trial,
    product,
    locations,
    window,
  };

  // Nothing to measure until the product is actually in a machine.
  if (!window.started) {
    return {
      ...base,
      unitsSold: 0,
      benchmark: null,
      verdict: {
        verdict: 'too_early',
        unitsPerDay: 0,
        marginPerDay: null,
        ratio: null,
        reason: 'Not started yet — the clock starts when trial stock first reaches a machine.',
      },
    };
  }

  const [soldBySku, stockRows] = await Promise.all([
    unitsSoldSince(locationIds, new Date(trial.startedAt)),
    // Needed to tell "in the machine and not selling" apart from "never made
    // it into the machine" — see the no_sales verdict.
    prisma.locationStock.findMany({
      where: { locationId: { in: locationIds }, sku: trial.sku },
      select: { quantity: true },
    }),
  ]);
  const unitsSold = soldBySku[trial.sku] || 0;
  const stockInMachines = stockRows.reduce((a, r) => a + (r.quantity || 0), 0);

  // Peers = everything else that sold in these machines over the window. Costs
  // and prices come from the catalogue; a peer with either missing is dropped
  // by benchmarkMarginPerDay rather than counted as zero-margin.
  const peerSkus = Object.keys(soldBySku).filter((sku) => sku !== trial.sku);
  const peerProducts = peerSkus.length
    ? await prisma.product.findMany({
        where: { sku: { in: peerSkus } },
        select: { sku: true, unitCost: true, salePrice: true },
      })
    : [];

  const benchmark = benchmarkMarginPerDay(
    peerProducts.map((p) => ({
      sku: p.sku,
      unitsSold: soldBySku[p.sku] || 0,
      marginPerUnit: marginPerUnit(p),
    })),
    window.tradingDaysElapsed,
  );

  const verdict = computeTrialVerdict({
    unitsSold,
    marginPerUnit: marginPerUnit(product),
    tradingDaysElapsed: window.tradingDaysElapsed,
    benchmark,
    windowComplete: window.windowComplete,
    stockInMachines,
  });

  return { ...base, unitsSold, stockInMachines, benchmark, verdict, peerCount: peerProducts.length };
}

// ============ ROUTES ============

// List trials. `status` filters; `active=1` is the shorthand for the three
// statuses that still affect ordering and picking.
router.get('/', asyncHandler(async (req, res) => {
  const { status, active } = req.query;
  const where = status
    ? { status }
    : active === '1'
      ? { status: { in: ACTIVE_TRIAL_STATUSES } }
      : undefined;

  const trials = await prisma.productTrial.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(parseInt(req.query.limit) || 100, 200),
  });

  const now = new Date();
  const decorated = await Promise.all(trials.map((t) => decorateTrial(t, now)));
  res.json(decorated);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const trial = await prisma.productTrial.findUnique({ where: { id: req.params.id } });
  if (!trial) return res.status(404).json({ error: 'Trial not found' });
  res.json(await decorateTrial(trial));
}));

// Start a trial. Flips the product to `trial` lifecycle, which is what the
// ordering and picking lanes read.
router.post('/', asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);

  const product = await prisma.product.findUnique({ where: { sku: data.sku } });
  if (!product) return res.status(404).json({ error: `No product with SKU ${data.sku}` });

  // One open trial per product: two overlapping trials would order the SKU
  // twice and neither verdict would be measuring a clean window.
  const existing = await prisma.productTrial.findFirst({
    where: { sku: data.sku, status: { in: ACTIVE_TRIAL_STATUSES } },
  });
  if (existing) {
    return res.status(409).json({
      error: `${product.name} is already being trialled`,
      code: 'TRIAL_IN_PROGRESS',
      trialId: existing.id,
    });
  }

  const locations = await prisma.location.findMany({
    where: { id: { in: data.locationIds }, archivedAt: null },
    select: { id: true },
  });
  if (locations.length !== data.locationIds.length) {
    return res.status(400).json({ error: 'One or more of those machines does not exist or is archived' });
  }

  const trial = await prisma.$transaction(async (tx) => {
    const created = await tx.productTrial.create({
      data: {
        sku: data.sku,
        locationIds: data.locationIds,
        trialQty: data.trialQty,
        weeks: data.weeks,
        notes: data.notes ?? null,
        createdBy: data.createdBy ?? null,
      },
    });
    await tx.product.update({ where: { sku: data.sku }, data: { lifecycle: 'trial' } });
    return created;
  });

  res.status(201).json(await decorateTrial(trial));
}));

// Edit an undecided trial. A decided trial is history — reopening it would
// silently rewrite the window a verdict was already given on.
router.put('/:id', asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const existing = await prisma.productTrial.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Trial not found' });
  if (!ACTIVE_TRIAL_STATUSES.includes(existing.status)) {
    return res.status(409).json({ error: `This trial is already ${existing.status}` });
  }

  const trial = await prisma.productTrial.update({
    where: { id: existing.id },
    data: {
      ...(data.locationIds !== undefined && { locationIds: data.locationIds }),
      ...(data.trialQty !== undefined && { trialQty: data.trialQty }),
      ...(data.weeks !== undefined && { weeks: data.weeks }),
      ...(data.notes !== undefined && { notes: data.notes ?? null }),
      ...(data.status !== undefined && { status: data.status }),
    },
  });

  res.json(await decorateTrial(trial));
}));

/**
 * Mark a trial live — trial stock has reached a machine and the clock starts.
 *
 * Idempotent on purpose: this is called from the restock flow, which can
 * legitimately confirm the same location twice, and re-stamping startedAt
 * would keep resetting the window so it never completed.
 */
router.post('/:id/start', asyncHandler(async (req, res) => {
  const { startedAt } = z.object({
    startedAt: z.string().nullish().refine(
      (v) => v == null || v === '' || !isNaN(Date.parse(v)),
      { message: 'startedAt must be a valid date' },
    ),
  }).parse(req.body ?? {});

  const existing = await prisma.productTrial.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Trial not found' });
  if (existing.startedAt) return res.json(await decorateTrial(existing));

  const trial = await prisma.productTrial.update({
    where: { id: existing.id },
    data: { status: 'live', startedAt: startedAt ? new Date(startedAt) : new Date() },
  });

  res.json(await decorateTrial(trial));
}));

/**
 * Adopt or reject.
 *
 * Adopt flips the product back to `active` — from here it is ordered by the
 * normal engine, which means it needs a planogram slot or a location config to
 * be picked. The response says so explicitly rather than leaving the operator
 * to discover a silently un-ordered product next week.
 *
 * Reject flips it to `discontinued`: sales history is kept, suggestions stop.
 * Neither touches stock — whatever is in the machines sells through.
 */
router.post('/:id/decide', asyncHandler(async (req, res) => {
  const { decision, note, decidedBy } = decideSchema.parse(req.body);

  const existing = await prisma.productTrial.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Trial not found' });
  if (!ACTIVE_TRIAL_STATUSES.includes(existing.status)) {
    return res.status(409).json({ error: `This trial is already ${existing.status}` });
  }

  const trial = await prisma.$transaction(async (tx) => {
    const updated = await tx.productTrial.update({
      where: { id: existing.id },
      data: {
        status: decision === 'adopt' ? 'adopted' : 'rejected',
        decision,
        decisionNote: note ?? null,
        decidedAt: new Date(),
      },
    });
    await tx.product.update({
      where: { sku: existing.sku },
      data: { lifecycle: decision === 'adopt' ? 'active' : 'discontinued' },
    });
    return updated;
  });

  const decorated = await decorateTrial(trial);

  res.json({
    trial: decorated,
    decidedBy: decidedBy ?? null,
    // The one thing an adopted product still needs from a human.
    nextStep: decision === 'adopt'
      ? 'Give it a slot on each machine’s planogram (or a min/max in Location Stock) — until then the weekly buy will not reorder it.'
      : 'It will stop appearing on buying lists. Whatever is already in the machines will sell through.',
  });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const existing = await prisma.productTrial.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Trial not found' });

  await prisma.$transaction(async (tx) => {
    await tx.productTrial.delete({ where: { id: existing.id } });
    // Only reset the product when no OTHER open trial still needs the flag.
    const stillTrialled = await tx.productTrial.findFirst({
      where: { sku: existing.sku, status: { in: ACTIVE_TRIAL_STATUSES } },
    });
    if (!stillTrialled) {
      await tx.product.updateMany({
        where: { sku: existing.sku, lifecycle: 'trial' },
        data: { lifecycle: 'active' },
      });
    }
  });

  res.json({ success: true });
}));

export default router;
