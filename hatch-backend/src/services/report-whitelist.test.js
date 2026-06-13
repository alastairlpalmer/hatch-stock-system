import { describe, it, expect } from 'vitest';
import { toClientSafe, assertClientSafe, FORBIDDEN_KEYS } from './report-whitelist.js';

// A dashboard payload that is FULL of money fields — the whitelist must drop
// every one of them.
const dashboard = {
  headline: { units: 1840, revenue: 1623.4, transactions: 1720, avgTransactionValue: 0.94, cost: 800, profit: 823.4 },
  timing: { timezone: 'Europe/London', busiestDay: { dow: 2, label: 'Tuesday' }, busiestHour: { hour: 12 } },
  products: {
    topByUnits: [
      { sku: 'A', name: 'Coca-Cola 330ml', units: 420, revenue: 378, cost: 168, profit: 210, marginPct: 55.6 },
      { sku: 'B', name: 'Walkers Crisps', units: 360, revenue: 288, cost: 180, marginPct: 37.5 },
    ],
    categories: [
      { category: 'Drinks', units: 700, revenue: 574, transactions: 700 },
      { category: 'Snacks', units: 300, revenue: 255, transactions: 300 },
    ],
  },
  margin: { portfolioMarginPct: 42.5 },
};
const daily = [
  { date: '2026-06-01', transactions: 120, revenue: 110 },
  { date: '2026-06-02', transactions: 0, revenue: 0 },
  { date: '2026-06-03', transactions: 95, revenue: 88 },
];
const meta = {
  clientName: 'Acme Ltd', siteName: 'Acme HQ', periodLabel: 'June 2026',
  periodStart: '2026-06-01', periodEnd: '2026-06-30', scopeLabel: 'All locations',
};

describe('toClientSafe', () => {
  const dto = toClientSafe(dashboard, daily, meta);

  it('keeps the allow-listed client-safe fields', () => {
    expect(dto.usage.transactions).toBe(1720);
    expect(dto.usage.units).toBe(1840);
    expect(dto.usage.activeDays).toBe(2); // 2 of 3 days had transactions
    expect(dto.usage.busiestDay).toBe('Tuesday');
    expect(dto.usage.busiestHour).toBe(12);
    expect(dto.topProducts).toEqual([
      { name: 'Coca-Cola 330ml', units: 420 },
      { name: 'Walkers Crisps', units: 360 },
    ]);
    expect(dto.categoryMix[0]).toEqual({ category: 'Drinks', units: 700, share: 70 });
    expect(dto.dailyTransactions).toEqual([
      { date: '2026-06-01', transactions: 120 },
      { date: '2026-06-02', transactions: 0 },
      { date: '2026-06-03', transactions: 95 },
    ]);
  });

  it('drops EVERY money field — no revenue/cost/margin/profit/price anywhere', () => {
    const json = JSON.stringify(dto).toLowerCase();
    for (const term of ['revenue', 'cost', 'margin', 'profit', 'charged', 'price', '£']) {
      expect(json).not.toContain(term);
    }
  });

  it('produces a summary paragraph with counts but no money', () => {
    expect(dto.summary).toContain('1,720 transactions');
    expect(dto.summary).toContain('Coca-Cola 330ml');
    expect(dto.summary).not.toContain('£');
  });
});

describe('assertClientSafe', () => {
  it('throws when a forbidden key is present', () => {
    expect(() => assertClientSafe({ usage: { revenue: 100 } })).toThrow(/forbidden key/i);
    expect(() => assertClientSafe({ items: [{ name: 'x', marginPct: 5 }] })).toThrow(/forbidden/i);
  });

  it('throws when a string smuggles in a currency figure', () => {
    expect(() => assertClientSafe({ summary: 'We earned £4,200 this month' })).toThrow(/forbidden content/i);
  });

  it('passes a clean payload through unchanged', () => {
    const clean = { usage: { transactions: 5, units: 7 }, topProducts: [{ name: 'A', units: 2 }] };
    expect(assertClientSafe(clean)).toBe(clean);
  });

  it('covers the documented forbidden vocabulary', () => {
    expect(FORBIDDEN_KEYS).toContain('revenue');
    expect(FORBIDDEN_KEYS).toContain('margin');
    expect(FORBIDDEN_KEYS).toContain('waste');
  });
});
