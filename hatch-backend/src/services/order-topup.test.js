import { describe, it, expect } from 'vitest';
import {
  computeShortfall,
  coverPerBox,
  rankTopupCandidates,
  planTopup,
  DEFAULT_MAX_COVER_DAYS,
} from './order-topup.js';

describe('computeShortfall', () => {
  it('reports a value shortfall', () => {
    const s = computeShortfall({ subtotal: 120, minOrderValue: 150 });
    expect(s.value).toBe(30);
    expect(s.blocked).toBe(true);
  });

  it('reports no shortfall once the minimum is met', () => {
    const s = computeShortfall({ subtotal: 150, minOrderValue: 150 });
    expect(s.value).toBe(0);
    expect(s.blocked).toBe(false);
  });

  it('reports a unit shortfall independently of value', () => {
    const s = computeShortfall({ subtotal: 500, totalUnits: 40, minOrderUnits: 60 });
    expect(s.value).toBe(0);
    expect(s.units).toBe(20);
    expect(s.blocked).toBe(true);
  });

  it('reports both when a supplier sets both', () => {
    const s = computeShortfall({
      subtotal: 100, totalUnits: 40, minOrderValue: 150, minOrderUnits: 60,
    });
    expect(s).toMatchObject({ value: 50, units: 20, blocked: true });
  });

  it('keeps free delivery OUT of the blocking shortfall', () => {
    // Minimum met, free-delivery threshold not — an order that will be
    // accepted, just with a delivery charge. Different urgency entirely.
    const s = computeShortfall({ subtotal: 160, minOrderValue: 150, freeDeliveryValue: 200 });
    expect(s.blocked).toBe(false);
    expect(s.freeDelivery).toBe(40);
    expect(s.meetsFreeDelivery).toBe(false);
  });

  it('reports free delivery met', () => {
    const s = computeShortfall({ subtotal: 220, freeDeliveryValue: 200 });
    expect(s.freeDelivery).toBe(0);
    expect(s.meetsFreeDelivery).toBe(true);
  });

  it('is silent when the supplier sets no minimum at all', () => {
    const s = computeShortfall({ subtotal: 10, totalUnits: 2 });
    expect(s).toMatchObject({ value: 0, units: 0, blocked: false, meetsFreeDelivery: false });
  });
});

describe('coverPerBox', () => {
  it('is box size over daily velocity', () => {
    expect(coverPerBox({ unitsPerBox: 24, velocityPerDay: 4 })).toBe(6);
  });

  it('treats a missing box size as 1', () => {
    expect(coverPerBox({ velocityPerDay: 2 })).toBe(0.5);
  });

  it('is infinite for a product with no sales — never a top-up candidate', () => {
    expect(coverPerBox({ unitsPerBox: 24, velocityPerDay: 0 })).toBe(Infinity);
  });
});

describe('rankTopupCandidates', () => {
  it('puts the fastest-turning box first', () => {
    const ranked = rankTopupCandidates([
      { sku: 'SLOW', unitsPerBox: 24, velocityPerDay: 0.5 }, // 48 days per box
      { sku: 'FAST', unitsPerBox: 24, velocityPerDay: 6 },   // 4 days per box
      { sku: 'MID', unitsPerBox: 12, velocityPerDay: 2 },    // 6 days per box
    ]);
    expect(ranked.map((c) => c.sku)).toEqual(['FAST', 'MID', 'SLOW']);
  });

  it('breaks a tie towards the product we are shortest of', () => {
    const ranked = rankTopupCandidates([
      { sku: 'FULL', unitsPerBox: 10, velocityPerDay: 1, currentUnits: 50 },
      { sku: 'EMPTY', unitsPerBox: 10, velocityPerDay: 1, currentUnits: 2 },
    ]);
    expect(ranked[0].sku).toBe('EMPTY');
  });

  it('is stable on a full tie', () => {
    const ranked = rankTopupCandidates([
      { sku: 'B', unitsPerBox: 10, velocityPerDay: 1, currentUnits: 0 },
      { sku: 'A', unitsPerBox: 10, velocityPerDay: 1, currentUnits: 0 },
    ]);
    expect(ranked.map((c) => c.sku)).toEqual(['A', 'B']);
  });
});

describe('planTopup', () => {
  const fast = { sku: 'FAST', name: 'Fast mover', unitsPerBox: 10, unitCost: 1, velocityPerDay: 5, currentUnits: 10 };
  const slow = { sku: 'SLOW', name: 'Slow mover', unitsPerBox: 10, unitCost: 1, velocityPerDay: 0.2, currentUnits: 10 };

  it('proposes nothing when there is no shortfall', () => {
    const plan = planTopup({ candidates: [fast], valueShortfall: 0, unitsShortfall: 0 });
    expect(plan.additions).toEqual([]);
    expect(plan.exhausted).toBe(false);
  });

  it('fills a value shortfall from the fastest mover', () => {
    const plan = planTopup({ candidates: [fast, slow], valueShortfall: 30 });
    expect(plan.additions).toHaveLength(1);
    expect(plan.additions[0]).toMatchObject({ sku: 'FAST', boxes: 3, units: 30, lineTotal: 30 });
    expect(plan.valueAdded).toBe(30);
    expect(plan.valueRemaining).toBe(0);
  });

  it('respects box size rather than proposing loose units', () => {
    const plan = planTopup({ candidates: [fast], valueShortfall: 25 });
    // 3 boxes of 10 = £30: the smallest whole-box amount that clears £25.
    expect(plan.additions[0].boxes).toBe(3);
    expect(plan.valueAdded).toBe(30);
  });

  it('never pushes a product past the cover ceiling', () => {
    // 5/day, starting at 10 units, ceiling 20 days = 100 units max, so 90 more
    // = 9 boxes and no further.
    const plan = planTopup({ candidates: [fast], valueShortfall: 500, maxCoverDays: 20 });
    expect(plan.additions[0].boxes).toBe(9);
    expect(plan.additions[0].coverAfterDays).toBe(20);
    expect(plan.exhausted).toBe(true);
    expect(plan.valueRemaining).toBe(410);
  });

  it('moves on to the next candidate once the first is capped', () => {
    const second = { sku: 'MID', name: 'Mid', unitsPerBox: 10, unitCost: 1, velocityPerDay: 2, currentUnits: 0 };
    const plan = planTopup({ candidates: [fast, second], valueShortfall: 120, maxCoverDays: 20 });
    const bySku = Object.fromEntries(plan.additions.map((a) => [a.sku, a]));
    expect(bySku.FAST.boxes).toBe(9);  // capped at 100 units
    expect(bySku.MID.boxes).toBe(3);   // 30 more units, 15 days cover
    expect(plan.valueAdded).toBe(120);
    expect(plan.exhausted).toBe(false);
  });

  it('refuses to buy a product with no sales history at any price', () => {
    const dead = { sku: 'DEAD', name: 'Dead', unitsPerBox: 10, unitCost: 1, velocityPerDay: 0, currentUnits: 0 };
    const plan = planTopup({ candidates: [dead], valueShortfall: 50 });
    expect(plan.additions).toEqual([]);
    expect(plan.exhausted).toBe(true);
    expect(plan.valueRemaining).toBe(50);
  });

  it('says so honestly when the minimum cannot be reached sensibly', () => {
    const plan = planTopup({ candidates: [slow], valueShortfall: 500, maxCoverDays: 20 });
    expect(plan.exhausted).toBe(true);
    expect(plan.valueRemaining).toBeGreaterThan(0);
  });

  it('fills a units-only shortfall', () => {
    const plan = planTopup({ candidates: [fast], valueShortfall: 0, unitsShortfall: 25 });
    expect(plan.unitsAdded).toBe(30); // 3 boxes of 10
    expect(plan.unitsRemaining).toBe(0);
  });

  it('satisfies a value AND a units minimum together', () => {
    const cheap = { sku: 'CHEAP', name: 'Cheap', unitsPerBox: 10, unitCost: 0.1, velocityPerDay: 5, currentUnits: 0 };
    const plan = planTopup({ candidates: [cheap], valueShortfall: 4, unitsShortfall: 60, maxCoverDays: 30 });
    expect(plan.valueAdded).toBeGreaterThanOrEqual(4);
    expect(plan.unitsAdded).toBeGreaterThanOrEqual(60);
  });

  it('excludes an uncosted product from a VALUE shortfall', () => {
    const noCost = { sku: 'NOCOST', name: 'No cost', unitsPerBox: 10, unitCost: null, velocityPerDay: 9, currentUnits: 0 };
    const plan = planTopup({ candidates: [noCost, fast], valueShortfall: 20 });
    expect(plan.additions.map((a) => a.sku)).toEqual(['FAST']);
  });

  it('allows an uncosted product to satisfy a UNITS-only shortfall', () => {
    const noCost = { sku: 'NOCOST', name: 'No cost', unitsPerBox: 10, unitCost: null, velocityPerDay: 9, currentUnits: 0 };
    const plan = planTopup({ candidates: [noCost], valueShortfall: 0, unitsShortfall: 20 });
    expect(plan.additions.map((a) => a.sku)).toEqual(['NOCOST']);
    expect(plan.unitsAdded).toBe(20);
  });

  it('reports cover after the top-up so the operator can sanity-check it', () => {
    const plan = planTopup({ candidates: [fast], valueShortfall: 20 });
    // 10 current + 20 added = 30 units at 5/day
    expect(plan.additions[0].coverAfterDays).toBe(6);
    expect(plan.additions[0].reason).toMatch(/6 days of cover/);
  });

  it('lists the biggest contribution first', () => {
    const a = { sku: 'A', name: 'A', unitsPerBox: 10, unitCost: 1, velocityPerDay: 10, currentUnits: 0 };
    const b = { sku: 'B', name: 'B', unitsPerBox: 10, unitCost: 1, velocityPerDay: 4, currentUnits: 0 };
    const plan = planTopup({ candidates: [a, b], valueShortfall: 130, maxCoverDays: 10 });
    expect(plan.additions[0].lineTotal).toBeGreaterThanOrEqual(plan.additions[1].lineTotal);
  });

  it('handles having no candidates at all', () => {
    const plan = planTopup({ candidates: [], valueShortfall: 50 });
    expect(plan.additions).toEqual([]);
    expect(plan.exhausted).toBe(true);
  });

  it('defaults the cover ceiling to four selling weeks', () => {
    expect(DEFAULT_MAX_COVER_DAYS).toBe(20);
  });

  it('terminates rather than looping when every candidate is already capped', () => {
    const capped = { sku: 'C', name: 'C', unitsPerBox: 10, unitCost: 1, velocityPerDay: 1, currentUnits: 999 };
    const plan = planTopup({ candidates: [capped], valueShortfall: 50, maxCoverDays: 20 });
    expect(plan.additions).toEqual([]);
    expect(plan.exhausted).toBe(true);
  });
});
