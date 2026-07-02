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
    expect(result).toEqual({ expired: [], critical: [], warning: [], missing: [] });
  });

  it('flags batches with no expiry date as missing instead of dropping them', () => {
    const result = categorizeBatchesByExpiry(
      [batch(null, 'no-expiry'), batch('2026-06-15T00:00:00Z', 'dated')],
      NOW,
    );
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].id).toBe('no-expiry');
    expect(result.missing[0].daysUntil).toBeNull();
    // the dated batch is still categorized normally
    expect(result.critical).toHaveLength(1);
  });

  it('treats undefined expiry the same as null', () => {
    const result = categorizeBatchesByExpiry([{ id: 'b2', remainingQty: 3 }], NOW);
    expect(result.missing).toHaveLength(1);
  });
});

describe('calendar-day boundaries', () => {
  it('puts a batch that expired yesterday in expired with daysUntil -1', () => {
    const result = categorizeBatchesByExpiry([batch('2026-06-09T12:00:00Z')], NOW);
    expect(result.expired).toHaveLength(1);
    expect(result.expired[0].daysUntil).toBe(-1);
    expect(result.critical).toHaveLength(0);
  });

  it('puts a batch that expired only hours ago (yesterday evening) in expired, not critical', () => {
    // 6h before "now" but on the previous calendar day — the old elapsed-time
    // ceil() rounded this to 0 and filed it under critical.
    const earlyMorning = new Date('2026-06-10T04:00:00Z');
    const result = categorizeBatchesByExpiry([batch('2026-06-09T22:00:00Z')], earlyMorning);
    expect(result.expired).toHaveLength(1);
    expect(result.expired[0].daysUntil).toBe(-1);
    expect(result.critical).toHaveLength(0);
  });

  it('counts a batch expiring today as critical with daysUntil 0', () => {
    // Later than "now" on the same day AND earlier than "now" on the same day:
    // both are "expires today", never expired.
    const later = categorizeBatchesByExpiry([batch('2026-06-10T18:00:00Z')], NOW);
    expect(later.critical).toHaveLength(1);
    expect(later.critical[0].daysUntil).toBe(0);
    expect(later.expired).toHaveLength(0);

    const earlier = categorizeBatchesByExpiry([batch('2026-06-10T06:00:00Z')], NOW);
    expect(earlier.critical).toHaveLength(1);
    expect(earlier.critical[0].daysUntil).toBe(0);
    expect(earlier.expired).toHaveLength(0);
  });

  it('puts exactly 7 days out in critical and 8 days out in warning', () => {
    const seven = categorizeBatchesByExpiry([batch('2026-06-17T00:00:00Z')], NOW);
    expect(seven.critical).toHaveLength(1);
    expect(seven.critical[0].daysUntil).toBe(7);

    const eight = categorizeBatchesByExpiry([batch('2026-06-18T00:00:00Z')], NOW);
    expect(eight.warning).toHaveLength(1);
    expect(eight.warning[0].daysUntil).toBe(8);
  });
});
