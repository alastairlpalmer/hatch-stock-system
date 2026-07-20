import { describe, it, expect } from 'vitest';
import { exclusiveEndBound } from './date-range.js';

describe('exclusiveEndBound', () => {
  it('widens a date-only string to the start of the next day', () => {
    expect(exclusiveEndBound('2026-07-15').toISOString()).toBe('2026-07-16T00:00:00.000Z');
  });

  it('treats an explicit timestamp as an inclusive instant (+1ms), not a full extra day', () => {
    expect(exclusiveEndBound('2026-07-15T23:59:59.999Z').toISOString()).toBe('2026-07-16T00:00:00.000Z');
    expect(exclusiveEndBound('2026-07-15T14:30:00.000Z').toISOString()).toBe('2026-07-15T14:30:00.001Z');
  });

  it('widens a Date at UTC midnight (previousPeriod boundary) to the whole day', () => {
    expect(exclusiveEndBound(new Date('2026-07-15T00:00:00.000Z')).toISOString()).toBe('2026-07-16T00:00:00.000Z');
  });

  it('treats a mid-day Date as an inclusive instant', () => {
    expect(exclusiveEndBound(new Date('2026-07-15T10:00:00.000Z')).toISOString()).toBe('2026-07-15T10:00:00.001Z');
  });

  it('rolls over month ends correctly', () => {
    expect(exclusiveEndBound('2026-06-30').toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });
});
