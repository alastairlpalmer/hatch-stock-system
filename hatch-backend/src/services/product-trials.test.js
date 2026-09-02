import { describe, it, expect } from 'vitest';
import {
  trialWindow,
  marginPerUnit,
  benchmarkMarginPerDay,
  computeTrialVerdict,
  trialNeedAtLocation,
  trialsByLocation,
  MIN_TRADING_DAYS,
} from './product-trials.js';
import { countTradingDaysInWindow } from '../utils/trading-days.js';

const countTradingDays = countTradingDaysInWindow;

// 2026-06-29 was a Monday.
const MON_29_JUN = new Date('2026-06-29T09:00:00Z');
const MON_27_JUL = new Date('2026-07-27T09:00:00Z'); // 4 weeks later

describe('trialWindow', () => {
  it('reports an unstarted trial as not started, with no elapsed time', () => {
    const w = trialWindow({ weeks: 4, startedAt: null }, MON_27_JUL, countTradingDays);
    expect(w.started).toBe(false);
    expect(w.tradingDaysElapsed).toBe(0);
    expect(w.windowComplete).toBe(false);
    expect(w.plannedTradingDays).toBe(20);
  });

  it('counts trading days from startedAt, not calendar days', () => {
    const w = trialWindow({ weeks: 4, startedAt: MON_29_JUN }, MON_27_JUL, countTradingDays);
    expect(w.calendarDaysElapsed).toBe(28);
    // Inclusive of both ends — the product was on sale on the Monday it went
    // in and on the Monday we are counting on: four weeks of Mon–Fri plus that
    // closing Monday.
    expect(w.tradingDaysElapsed).toBe(21);
    expect(w.windowComplete).toBe(true);
    expect(w.progressPct).toBe(100);
  });

  it('reports partial progress mid-window', () => {
    const twoWeeksIn = new Date('2026-07-13T09:00:00Z');
    const w = trialWindow({ weeks: 4, startedAt: MON_29_JUN }, twoWeeksIn, countTradingDays);
    expect(w.windowComplete).toBe(false);
    expect(w.tradingDaysElapsed).toBe(11); // inclusive of both Mondays
    expect(w.progressPct).toBe(55);
  });

  it('defaults to a 4-week window when weeks is missing', () => {
    expect(trialWindow({ startedAt: null }, MON_27_JUL, countTradingDays).plannedTradingDays).toBe(20);
  });

  it('never reports negative elapsed time for a future start', () => {
    const w = trialWindow({ weeks: 4, startedAt: MON_27_JUL }, MON_29_JUN, countTradingDays);
    expect(w.calendarDaysElapsed).toBe(0);
    expect(w.tradingDaysElapsed).toBeGreaterThanOrEqual(0);
  });
});

describe('marginPerUnit', () => {
  it('subtracts cost from sale price', () => {
    expect(marginPerUnit({ salePrice: 1.5, unitCost: 0.6 })).toBe(0.9);
  });

  it('returns null when either side is unknown', () => {
    expect(marginPerUnit({ salePrice: 1.5, unitCost: null })).toBeNull();
    expect(marginPerUnit({ salePrice: null, unitCost: 0.6 })).toBeNull();
    expect(marginPerUnit(null)).toBeNull();
  });

  it('allows a genuinely zero margin', () => {
    expect(marginPerUnit({ salePrice: 1, unitCost: 1 })).toBe(0);
  });
});

describe('benchmarkMarginPerDay', () => {
  const peers = [
    { sku: 'A', unitsSold: 20, marginPerUnit: 0.5 },  // £10 over the window
    { sku: 'B', unitsSold: 40, marginPerUnit: 0.5 },  // £20
    { sku: 'C', unitsSold: 60, marginPerUnit: 0.5 },  // £30
  ];

  it('takes the median, not the mean', () => {
    // Median of 10/20/30 over 20 days = £20 / 20 = £1.00
    expect(benchmarkMarginPerDay(peers, 20)).toBe(1);
  });

  it('is not dragged up by one runaway seller', () => {
    const withStar = [...peers, { sku: 'D', unitsSold: 2000, marginPerUnit: 0.5 }];
    // Median of 10/20/30/1000 = (20+30)/2 = 25 over 20 days = £1.25
    expect(benchmarkMarginPerDay(withStar, 20)).toBe(1.25);
  });

  it('excludes dead facings so they cannot drag the bar to zero', () => {
    const withDead = [...peers, { sku: 'E', unitsSold: 0, marginPerUnit: 0.5 }];
    expect(benchmarkMarginPerDay(withDead, 20)).toBe(1);
  });

  it('excludes peers with no known margin', () => {
    const withUnknown = [...peers, { sku: 'F', unitsSold: 100, marginPerUnit: null }];
    expect(benchmarkMarginPerDay(withUnknown, 20)).toBe(1);
  });

  it('returns null when there is nothing to compare against', () => {
    expect(benchmarkMarginPerDay([], 20)).toBeNull();
    expect(benchmarkMarginPerDay([{ sku: 'X', unitsSold: 0, marginPerUnit: 1 }], 20)).toBeNull();
  });

  it('averages the middle two for an even count', () => {
    const four = [
      { sku: 'A', unitsSold: 10, marginPerUnit: 1 },
      { sku: 'B', unitsSold: 20, marginPerUnit: 1 },
      { sku: 'C', unitsSold: 30, marginPerUnit: 1 },
      { sku: 'D', unitsSold: 40, marginPerUnit: 1 },
    ];
    expect(benchmarkMarginPerDay(four, 10)).toBe(2.5); // (20+30)/2 / 10
  });
});

describe('computeTrialVerdict', () => {
  const base = { marginPerUnit: 0.5, tradingDaysElapsed: 20, benchmark: 1, windowComplete: true };

  it('refuses to judge before the minimum trading days', () => {
    const v = computeTrialVerdict({ ...base, tradingDaysElapsed: 4, unitsSold: 40 });
    expect(v.verdict).toBe('too_early');
    expect(v.reason).toMatch(String(MIN_TRADING_DAYS));
  });

  it('refuses to judge on too few units while the window is still running', () => {
    const v = computeTrialVerdict({ ...base, unitsSold: 3, windowComplete: false });
    expect(v.verdict).toBe('too_early');
  });

  it('DOES judge a barely-selling product once the window is complete', () => {
    // Four units in four weeks is itself the answer.
    const v = computeTrialVerdict({ ...base, unitsSold: 4, windowComplete: true });
    expect(v.verdict).toBe('reject');
  });

  it('adopts a product earning its keep', () => {
    // 40 units x £0.50 over 20 days = £1.00/day vs a £1.00 benchmark.
    const v = computeTrialVerdict({ ...base, unitsSold: 40 });
    expect(v.verdict).toBe('adopt');
    expect(v.marginPerDay).toBe(1);
    expect(v.ratio).toBe(1);
  });

  it('adopts at the 0.8 boundary — the benchmark is a median, not a bar to beat', () => {
    // 32 x 0.5 / 20 = £0.80/day vs £1.00 => ratio 0.8
    const v = computeTrialVerdict({ ...base, unitsSold: 32 });
    expect(v.ratio).toBe(0.8);
    expect(v.verdict).toBe('adopt');
  });

  it('calls the middle band marginal rather than deciding for you', () => {
    // 24 x 0.5 / 20 = £0.60/day => ratio 0.6
    const v = computeTrialVerdict({ ...base, unitsSold: 24 });
    expect(v.verdict).toBe('marginal');
    expect(v.reason).toMatch(/your call/i);
  });

  it('rejects below half a normal facing', () => {
    // 16 x 0.5 / 20 = £0.40/day => ratio 0.4
    const v = computeTrialVerdict({ ...base, unitsSold: 16 });
    expect(v.verdict).toBe('reject');
  });

  it('flags zero recorded sales as a VendLive setup problem, not a rejection', () => {
    const v = computeTrialVerdict({ ...base, unitsSold: 0, stockInMachines: 16 });
    expect(v.verdict).toBe('no_sales');
    expect(v.reason).toMatch(/VendLive/);
  });

  it('does NOT use the no_sales verdict when the stock never reached a machine', () => {
    // Nothing on the shelf means nothing could have sold — that is a picking
    // problem, and the units guard already covers it.
    const v = computeTrialVerdict({ ...base, unitsSold: 0, stockInMachines: 0 });
    expect(v.verdict).toBe('reject');
  });

  it('still judges normally once even one sale has come back', () => {
    const v = computeTrialVerdict({ ...base, unitsSold: 40, stockInMachines: 16 });
    expect(v.verdict).toBe('adopt');
  });

  it('reports a data gap instead of failing a product with no margin', () => {
    const v = computeTrialVerdict({ ...base, unitsSold: 100, marginPerUnit: null });
    expect(v.verdict).toBe('no_margin');
    expect(v.reason).toMatch(/cost or sale price/i);
  });

  it('falls back to absolute movement when there is no benchmark', () => {
    const good = computeTrialVerdict({ ...base, benchmark: null, unitsSold: 40 }); // 2/day
    expect(good.verdict).toBe('adopt');
    expect(good.ratio).toBeNull();

    const bad = computeTrialVerdict({ ...base, benchmark: null, unitsSold: 8 }); // 0.4/day
    expect(bad.verdict).toBe('reject');
  });

  it('treats a zero benchmark as no benchmark', () => {
    const v = computeTrialVerdict({ ...base, benchmark: 0, unitsSold: 40 });
    expect(v.ratio).toBeNull();
    expect(v.verdict).toBe('adopt');
  });

  it('never divides by zero on a zero-day window', () => {
    const v = computeTrialVerdict({ ...base, tradingDaysElapsed: 0, unitsSold: 0 });
    expect(v.verdict).toBe('too_early');
    expect(Number.isFinite(v.unitsPerDay)).toBe(true);
  });
});

describe('trialNeedAtLocation', () => {
  it('fills an empty machine to the trial quantity', () => {
    expect(trialNeedAtLocation({ trialQty: 12, machineStock: 0 })).toBe(12);
  });

  it('tops up a partly stocked machine', () => {
    expect(trialNeedAtLocation({ trialQty: 12, machineStock: 5 })).toBe(7);
  });

  it('asks for nothing when the machine is already at target', () => {
    expect(trialNeedAtLocation({ trialQty: 12, machineStock: 12 })).toBe(0);
  });

  it('never returns a negative need when the machine is over target', () => {
    expect(trialNeedAtLocation({ trialQty: 12, machineStock: 20 })).toBe(0);
  });
});

describe('trialsByLocation', () => {
  const trials = [
    { id: 't1', sku: 'NEW-1', status: 'planned', trialQty: 10, locationIds: ['L1', 'L2'] },
    { id: 't2', sku: 'NEW-2', status: 'live', trialQty: 6, locationIds: ['L2'] },
    { id: 't3', sku: 'OLD-1', status: 'adopted', trialQty: 10, locationIds: ['L1'] },
    { id: 't4', sku: 'OLD-2', status: 'rejected', trialQty: 10, locationIds: ['L1'] },
  ];

  it('indexes active trials by location', () => {
    const map = trialsByLocation(trials);
    expect(map.get('L1').map((t) => t.sku)).toEqual(['NEW-1']);
    expect(map.get('L2').map((t) => t.sku).sort()).toEqual(['NEW-1', 'NEW-2']);
  });

  it('drops adopted and rejected trials — those must stop being ordered', () => {
    const skus = [...trialsByLocation(trials).values()].flat().map((t) => t.sku);
    expect(skus).not.toContain('OLD-1');
    expect(skus).not.toContain('OLD-2');
  });

  it('tolerates a malformed locationIds value', () => {
    const map = trialsByLocation([{ id: 't', sku: 'X', status: 'planned', trialQty: 1, locationIds: null }]);
    expect(map.size).toBe(0);
  });

  it('returns an empty map for no trials', () => {
    expect(trialsByLocation([]).size).toBe(0);
  });
});
