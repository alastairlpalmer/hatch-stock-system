import { describe, it, expect } from 'vitest';
import { findLegacyDuplicates } from './sales-dedupe.js';

const legacy = (id, sku, timestamp, charged = 2.5) => ({ id, sku, timestamp, charged });
const vl = (id, sku, timestamp) => ({ id, sku, timestamp });

describe('findLegacyDuplicates', () => {
  it('matches a CSV row to a VendLive row at the exact same time', () => {
    const dupes = findLegacyDuplicates(
      [legacy('100', 'SKU-1', '2025-10-08T10:40:00Z', 4.99)],
      [vl('vl-1-1', 'SKU-1', '2025-10-08T10:40:00Z')],
    );
    expect(dupes).toHaveLength(1);
    expect(dupes[0]).toMatchObject({ legacyId: '100', vendliveId: 'vl-1-1', charged: 4.99 });
  });

  it('matches across minute-rounding skew (CSV timestamps are rounded)', () => {
    const dupes = findLegacyDuplicates(
      [legacy('100', 'SKU-1', '2025-10-08T10:40:00Z')],
      [vl('vl-1-1', 'SKU-1', '2025-10-08T10:40:47Z')],
    );
    expect(dupes).toHaveLength(1);
  });

  it('does NOT match beyond the tolerance window', () => {
    const dupes = findLegacyDuplicates(
      [legacy('100', 'SKU-1', '2025-10-08T10:40:00Z')],
      [vl('vl-1-1', 'SKU-1', '2025-10-08T11:00:00Z')],
    );
    expect(dupes).toHaveLength(0);
  });

  it('does NOT match different SKUs at the same time', () => {
    const dupes = findLegacyDuplicates(
      [legacy('100', 'SKU-1', '2025-10-08T10:40:00Z')],
      [vl('vl-1-1', 'SKU-2', '2025-10-08T10:40:00Z')],
    );
    expect(dupes).toHaveLength(0);
  });

  it('pairs one-to-one: two genuine same-SKU purchases survive as two pairs', () => {
    // Customer bought the same drink twice, 3 minutes apart. Both feeds
    // recorded both sales: 2 CSV rows + 2 VendLive rows. Each CSV row must
    // consume its own VendLive row — exactly 2 duplicates, never 1 or 3.
    const dupes = findLegacyDuplicates(
      [
        legacy('100', 'SKU-1', '2025-10-08T10:40:00Z'),
        legacy('101', 'SKU-1', '2025-10-08T10:43:00Z'),
      ],
      [
        vl('vl-1-1', 'SKU-1', '2025-10-08T10:40:30Z'),
        vl('vl-2-2', 'SKU-1', '2025-10-08T10:43:30Z'),
      ],
    );
    expect(dupes).toHaveLength(2);
    expect(new Set(dupes.map(d => d.vendliveId)).size).toBe(2); // distinct VendLive rows consumed
  });

  it('a lone VendLive row absorbs only ONE of two nearby CSV rows', () => {
    // If only one VendLive row exists, the second CSV row is a real extra
    // sale and must be kept.
    const dupes = findLegacyDuplicates(
      [
        legacy('100', 'SKU-1', '2025-10-08T10:40:00Z'),
        legacy('101', 'SKU-1', '2025-10-08T10:41:00Z'),
      ],
      [vl('vl-1-1', 'SKU-1', '2025-10-08T10:40:00Z')],
    );
    expect(dupes).toHaveLength(1);
    expect(dupes[0].legacyId).toBe('100'); // nearest wins
  });

  it('prefers the nearest VendLive candidate', () => {
    const dupes = findLegacyDuplicates(
      [legacy('100', 'SKU-1', '2025-10-08T10:40:00Z')],
      [
        vl('vl-far', 'SKU-1', '2025-10-08T10:44:00Z'),
        vl('vl-near', 'SKU-1', '2025-10-08T10:40:10Z'),
      ],
    );
    expect(dupes[0].vendliveId).toBe('vl-near');
  });

  it('sums to the diagnosed real-world shape: dupes flagged, unique rows kept', () => {
    const legacyRows = [
      legacy('1', 'A', '2025-09-22T19:11:00Z', 2.5),  // duplicate
      legacy('2', 'B', '2025-09-24T14:41:00Z', 2.75), // unique — poll never ingested it
    ];
    const vlRows = [vl('vl-9-9', 'A', '2025-09-22T19:11:00Z')];
    const dupes = findLegacyDuplicates(legacyRows, vlRows);
    expect(dupes).toHaveLength(1);
    expect(dupes.reduce((a, d) => a + d.charged, 0)).toBe(2.5);
  });
});
