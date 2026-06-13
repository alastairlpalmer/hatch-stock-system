import { describe, it, expect } from 'vitest';
import { renderReportPdf, previousCalendarMonth } from './client-report.js';

const dto = {
  meta: { clientName: 'Acme Ltd', siteName: 'Acme HQ', periodLabel: 'May 2026', periodStart: '2026-05-01', periodEnd: '2026-05-31', scopeLabel: 'All locations' },
  usage: { transactions: 1720, units: 1840, activeDays: 28, busiestDay: 'Tuesday', busiestHour: 12, timezone: 'Europe/London' },
  topProducts: [
    { name: 'Coca-Cola 330ml', units: 420 },
    { name: 'Walkers Crisps', units: 360 },
  ],
  categoryMix: [
    { category: 'Drinks', units: 700, share: 51 },
    { category: 'Snacks', units: 360, share: 26 },
  ],
  dailyTransactions: [
    { date: '2026-05-01', transactions: 60 },
    { date: '2026-05-02', transactions: 75 },
    { date: '2026-05-03', transactions: 0 },
  ],
  summary: 'During May 2026, the Acme HQ machines recorded 1,720 transactions and 1,840 items dispensed across 28 active days.',
};

describe('renderReportPdf', () => {
  it('produces a valid, non-trivial PDF buffer', async () => {
    const pdf = await renderReportPdf(dto);
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.slice(0, 5).toString()).toBe('%PDF-'); // PDF magic header
  });

  it('refuses to render a DTO that contains forbidden (money) data', async () => {
    const poisoned = { ...dto, usage: { ...dto.usage, revenue: 5000 } };
    await expect(renderReportPdf(poisoned)).rejects.toThrow(/forbidden/i);
  });
});

describe('previousCalendarMonth', () => {
  it('returns the previous calendar month for a mid-month date', () => {
    const { start, end } = previousCalendarMonth(new Date('2026-06-13T10:00:00'));
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(4); // May (0-indexed)
    expect(start.getDate()).toBe(1);
    expect(end.getMonth()).toBe(4); // last day of May
    expect(end.getDate()).toBe(31);
  });
});
