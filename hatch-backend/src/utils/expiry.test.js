import { describe, it, expect } from 'vitest';
import { categorizeBatchesByExpiry } from './expiry.js';

const NOW = new Date('2026-06-10T12:00:00Z');

function batch(expiryDate, id = 'b1') {
  return { id, expiryDate, remainingQty: 5 };
}

describe('categorizeBatchesByExpiry', () => {
  it('puts past-expiry batches in expired with negative daysUntil', () => {
    const result = categorizeBatchesByExpiry([batch('2026-06-01T00:00:00Z')], NOW);
    expect(result.expired).toHaveLength(1);
    expect(result.expired[0].daysUntil).toBeLessThan(0);
    expect(result.critical).toHaveLength(0);
    expect(result.warning).toHaveLength(0);
  });

  it('puts batches expiring within 7 days in critical', () => {
    const result = categorizeBatchesByExpiry([batch('2026-06-15T00:00:00Z')], NOW);
    expect(result.critical).toHaveLength(1);
    expect(result.critical[0].daysUntil).toBe(5);
  });

  it('puts the 7-day boundary in critical, day 8 in warning', () => {
    const onBoundary = categorizeBatchesByExpiry([batch('2026-06-17T11:00:00Z')], NOW);
    expect(onBoundary.critical).toHaveLength(1);

    const dayEight = categorizeBatchesByExpiry([batch('2026-06-18T13:00:00Z')], NOW);
    expect(dayEight.warning).toHaveLength(1);
  });

  it('annotates daysUntil on every batch and preserves other fields', () => {
    const result = categorizeBatchesByExpiry([{ ...batch('2026-07-01T00:00:00Z'), sku: 'SKU-9' }], NOW);
    expect(result.warning[0].sku).toBe('SKU-9');
    expect(typeof result.warning[0].daysUntil).toBe('number');
  });

  it('handles an empty list', () => {
    const result = categorizeBatchesByExpiry([], NOW);
    expect(result).toEqual({ expired: [], critical: [], warning: [] });
  });
});
