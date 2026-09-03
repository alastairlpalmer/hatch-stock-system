import { describe, it, expect } from 'vitest';
import { costInForceAt, planCostBackfill, COST_EPSILON } from './cost-backfill.js';

const JUNE = '2026-06-15T10:00:00Z';
const JULY = '2026-07-15T10:00:00Z';
const AUG = '2026-08-15T10:00:00Z';

describe('costInForceAt', () => {
  const history = [
    { unitCost: 0.40, effectiveFrom: '2026-06-01T00:00:00Z' },
    { unitCost: 0.50, effectiveFrom: '2026-07-01T00:00:00Z' },
    { unitCost: 0.62, effectiveFrom: '2026-08-01T00:00:00Z' },
  ];

  it('returns the cost in force on the day of the sale', () => {
    expect(costInForceAt(history, JUNE)).toBe(0.40);
    expect(costInForceAt(history, JULY)).toBe(0.50);
    expect(costInForceAt(history, AUG)).toBe(0.62);
  });

  it('does NOT let a later price rise rewrite an earlier sale', () => {
    // The whole point: August's 62p must not be applied to a June sale.
    expect(costInForceAt(history, JUNE)).not.toBe(0.62);
  });

  it('returns null for a sale predating every invoice', () => {
    expect(costInForceAt(history, '2026-05-01T00:00:00Z')).toBeNull();
  });

  it('applies a cost effective at the exact moment of the sale', () => {
    expect(costInForceAt(history, '2026-07-01T00:00:00Z')).toBe(0.50);
  });

  it('returns null for an empty history', () => {
    expect(costInForceAt([], JUNE)).toBeNull();
  });
});

describe('planCostBackfill', () => {
  const historyBySku = {
    COKE: [
      { unitCost: 0.40, effectiveFrom: '2026-06-01T00:00:00Z' },
      { unitCost: 0.60, effectiveFrom: '2026-08-01T00:00:00Z' },
    ],
  };

  const sale = (over = {}) => ({
    id: 's1', sku: 'COKE', quantity: 1, charged: 1.20, costPrice: 0.30, timestamp: JUNE, ...over,
  });

  it('restates a sale to the cost proved for its date', () => {
    const plan = planCostBackfill([sale()], historyBySku);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({ id: 's1', from: 0.30, to: 0.40, costDelta: 0.1 });
  });

  it('uses the LATER cost only for the later sale', () => {
    const plan = planCostBackfill(
      [sale({ id: 'june', timestamp: JUNE }), sale({ id: 'aug', timestamp: AUG })],
      historyBySku,
    );
    const byId = Object.fromEntries(plan.changes.map((c) => [c.id, c]));
    expect(byId.june.to).toBe(0.40);
    expect(byId.aug.to).toBe(0.60);
  });

  it('leaves a sale alone when the proved cost already matches', () => {
    const plan = planCostBackfill([sale({ costPrice: 0.40 })], historyBySku);
    expect(plan.changes).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it('ignores float noise below the epsilon', () => {
    const plan = planCostBackfill([sale({ costPrice: 0.40 + COST_EPSILON / 2 })], historyBySku);
    expect(plan.changes).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it('skips a SKU with no invoice history at all', () => {
    const plan = planCostBackfill([sale({ sku: 'UNKNOWN' })], historyBySku);
    expect(plan.changes).toEqual([]);
    expect(plan.noHistory).toBe(1);
  });

  it('skips a sale that predates every invoice for its SKU', () => {
    const plan = planCostBackfill([sale({ timestamp: '2026-05-01T00:00:00Z' })], historyBySku);
    expect(plan.changes).toEqual([]);
    expect(plan.noHistory).toBe(1);
  });

  it('restates a sale that had NO cost recorded at all', () => {
    const plan = planCostBackfill([sale({ costPrice: null })], historyBySku);
    expect(plan.changes[0]).toMatchObject({ from: null, to: 0.40, costDelta: 0.4 });
  });

  it('multiplies the delta by quantity', () => {
    const plan = planCostBackfill([sale({ quantity: 5 })], historyBySku);
    expect(plan.changes[0].costDelta).toBe(0.5); // (0.40 - 0.30) x 5
  });

  it('reports profit falling when cost was under-stated', () => {
    const plan = planCostBackfill([sale()], historyBySku);
    expect(plan.costDelta).toBe(0.1);
    expect(plan.profitDelta).toBe(-0.1);
  });

  it('reports profit rising when cost was over-stated', () => {
    const plan = planCostBackfill([sale({ costPrice: 0.90 })], historyBySku);
    expect(plan.costDelta).toBe(-0.5);
    expect(plan.profitDelta).toBe(0.5);
  });

  it('reports the margin points moved across the affected rows', () => {
    // 10p more cost on £1.20 of revenue = 8.33 margin points lost.
    const plan = planCostBackfill([sale()], historyBySku);
    expect(plan.marginDeltaPct).toBe(-8.33);
  });

  it('reports no margin percentage when nothing was charged', () => {
    const plan = planCostBackfill([sale({ charged: 0 })], historyBySku);
    expect(plan.marginDeltaPct).toBeNull();
    expect(plan.costDelta).toBe(0.1);
  });

  it('handles an empty sale set', () => {
    const plan = planCostBackfill([], historyBySku);
    expect(plan).toMatchObject({ changes: [], unchanged: 0, noHistory: 0, costDelta: 0 });
  });

  it('counts unchanged, skipped and changed separately', () => {
    const plan = planCostBackfill(
      [
        sale({ id: 'a' }),                       // changes
        sale({ id: 'b', costPrice: 0.40 }),      // unchanged
        sale({ id: 'c', sku: 'NOPE' }),          // no history
      ],
      historyBySku,
    );
    expect(plan.changes.map((c) => c.id)).toEqual(['a']);
    expect(plan.unchanged).toBe(1);
    expect(plan.noHistory).toBe(1);
  });
});
