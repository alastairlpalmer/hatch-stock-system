import { describe, it, expect } from 'vitest';
import { normalizeStockReport } from './vendlive.js';

describe('normalizeStockReport', () => {
  it('maps a flat results array with common key names', () => {
    const rows = normalizeStockReport({
      results: [
        { productName: 'Wrap', externalId: 'WRP-1', currentStock: 3, prediction: 8 },
      ],
    });
    expect(rows).toEqual([
      { name: 'Wrap', sku: 'WRP-1', currentStock: 3, predicted: 8 },
    ]);
  });

  it('handles nested product objects and alternate prediction keys', () => {
    const rows = normalizeStockReport([
      { product: { name: 'Juice', id: 42 }, stockLevel: '5', suggestedRestock: '12' },
    ]);
    expect(rows).toEqual([
      { name: 'Juice', sku: '42', currentStock: 5, predicted: 12 },
    ]);
  });

  it('never throws on missing keys — falls back to nulls and a placeholder name', () => {
    const rows = normalizeStockReport({ results: [{}] });
    expect(rows).toEqual([
      { name: 'Unknown product', sku: null, currentStock: null, predicted: null },
    ]);
  });

  it('returns [] for unrecognised payload shapes', () => {
    expect(normalizeStockReport(null)).toEqual([]);
    expect(normalizeStockReport({ foo: 'bar' })).toEqual([]);
    expect(normalizeStockReport('nope')).toEqual([]);
  });

  it('ignores non-numeric stock values rather than producing NaN', () => {
    const rows = normalizeStockReport([{ name: 'Bar', currentStock: 'n/a', predicted: '' }]);
    expect(rows[0].currentStock).toBeNull();
    expect(rows[0].predicted).toBeNull();
  });
});
