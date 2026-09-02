import { describe, it, expect } from 'vitest';
import {
  splitDelimited,
  detectDelimiter,
  mapHeaderColumns,
  parseNumber,
  parseInvoiceTable,
  nameSimilarity,
  matchLineToProduct,
  applyInvoiceCosting,
  isPriceVariance,
  buildReconciliation,
} from './invoice-reconcile.js';

describe('splitDelimited', () => {
  it('splits a plain comma row', () => {
    expect(splitDelimited('A,B,C', ',')).toEqual(['A', 'B', 'C']);
  });

  it('keeps a delimiter inside quotes', () => {
    expect(splitDelimited('"Crisps, salted",12,4.50', ',')).toEqual(['Crisps, salted', '12', '4.50']);
  });

  it('unescapes a doubled quote', () => {
    expect(splitDelimited('"6"" sub",1', ',')).toEqual(['6" sub', '1']);
  });

  it('preserves empty trailing cells', () => {
    expect(splitDelimited('A,,C,', ',')).toEqual(['A', '', 'C', '']);
  });
});

describe('detectDelimiter', () => {
  it('prefers tab when present (spreadsheet paste)', () => {
    expect(detectDelimiter(['a\tb\tc', 'd,e\tf'])).toBe('\t');
  });

  it('picks semicolon when it dominates', () => {
    expect(detectDelimiter(['a;b;c', 'd;e;f'])).toBe(';');
  });

  it('defaults to comma', () => {
    expect(detectDelimiter(['a,b,c'])).toBe(',');
  });
});

describe('mapHeaderColumns', () => {
  it('maps the common invoice headers', () => {
    const m = mapHeaderColumns(['Product Code', 'Description', 'Qty', 'Unit Price', 'Line Total']);
    expect(m).toEqual({ 0: 'code', 1: 'name', 2: 'quantity', 3: 'unitPrice', 4: 'lineTotal' });
  });

  it('binds "Unit Price" rather than a bare "Price" when both exist', () => {
    const m = mapHeaderColumns(['SKU', 'Qty', 'Price', 'Unit Price', 'Amount']);
    expect(m[3]).toBe('unitPrice');
    expect(m[2]).not.toBe('unitPrice');
  });

  it('claims each field at most once', () => {
    const m = mapHeaderColumns(['Code', 'Item Code', 'Qty', 'Each']);
    const fields = Object.values(m);
    expect(new Set(fields).size).toBe(fields.length);
  });
});

describe('parseNumber', () => {
  it('strips currency and thousands separators', () => {
    expect(parseNumber('£1,234.56')).toBe(1234.56);
  });

  it('reads an accounting negative', () => {
    expect(parseNumber('(12.00)')).toBe(-12);
  });

  it('drops a trailing percent sign', () => {
    expect(parseNumber('12.5%')).toBe(12.5);
  });

  it('returns null for blanks and junk, not 0', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('  ')).toBeNull();
    expect(parseNumber('n/a')).toBeNull();
    expect(parseNumber(null)).toBeNull();
  });
});

describe('parseInvoiceTable', () => {
  it('parses a clean CSV', () => {
    const { lines, warnings } = parseInvoiceTable(
      'Code,Description,Qty,Unit Price,Total\n'
      + 'ABC1,Salted Crisps,24,0.42,10.08\n'
      + 'ABC2,Cola 330ml,48,0.35,16.80\n',
    );
    expect(warnings).toEqual([]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ rawCode: 'ABC1', quantity: 24, unitPrice: 0.42, lineTotal: 10.08 });
  });

  it('skips a letterhead pasted above the table', () => {
    const { lines } = parseInvoiceTable(
      'BIG WHOLESALE LTD\n'
      + '12 Trade Park, Bristol\n'
      + 'Invoice 88231\n'
      + 'Code,Description,Qty,Unit Price,Total\n'
      + 'ABC1,Crisps,24,0.42,10.08\n',
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].rawCode).toBe('ABC1');
  });

  it('skips subtotal rows that carry money but no quantity', () => {
    const { lines, skipped } = parseInvoiceTable(
      'Code,Description,Qty,Unit Price,Total\n'
      + 'ABC1,Crisps,24,0.42,10.08\n'
      + ',Subtotal,,,10.08\n'
      + ',VAT,,,2.02\n',
    );
    expect(lines).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  it('derives the line total from qty x price', () => {
    const { lines } = parseInvoiceTable('Code,Qty,Unit Price\nABC1,10,1.5\n');
    expect(lines[0].lineTotal).toBe(15);
  });

  it('derives the unit price from total / qty', () => {
    const { lines } = parseInvoiceTable('Code,Qty,Total\nABC1,24,13.99\n');
    expect(lines[0].unitPrice).toBe(0.5829);
  });

  it('converts a percentage discount column into pounds', () => {
    const { lines } = parseInvoiceTable('Code,Qty,Unit Price,Discount %,Total\nABC1,10,2.00,10,18.00\n');
    expect(lines[0].lineDiscount).toBe(2);
  });

  it('takes an absolute discount column as pounds', () => {
    const { lines } = parseInvoiceTable('Code,Qty,Unit Price,Discount,Total\nABC1,10,2.00,1.50,18.50\n');
    expect(lines[0].lineDiscount).toBe(1.5);
  });

  it('handles a tab-separated spreadsheet paste', () => {
    const { lines } = parseInvoiceTable('Code\tDescription\tQty\tUnit Price\tTotal\nABC1\tCrisps\t24\t0.42\t10.08');
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(24);
  });

  it('warns instead of guessing when there is no recognisable header', () => {
    const res = parseInvoiceTable('some\nrandom\ntext');
    expect(res.lines).toEqual([]);
    expect(res.warnings[0]).toMatch(/header/i);
  });

  it('warns when there is no code or description column', () => {
    const res = parseInvoiceTable('Qty,Unit Price,Total\n10,1.00,10.00\n');
    expect(res.warnings.join(' ')).toMatch(/matching by hand/i);
  });
});

describe('nameSimilarity', () => {
  it('scores an exact name 1', () => {
    expect(nameSimilarity('Salted Crisps', 'salted crisps')).toBe(1);
  });

  it('scores unrelated names 0', () => {
    expect(nameSimilarity('Salted Crisps', 'Orange Juice')).toBe(0);
  });

  it('ignores punctuation and stopwords', () => {
    expect(nameSimilarity('Coke & Pack', 'coke')).toBe(1);
  });
});

describe('matchLineToProduct', () => {
  const products = [
    { sku: 'CRISP-SALT', name: 'Salted Crisps 40g', barcode: '5010001', supplierCode: 'BW-771' },
    { sku: 'COLA-330', name: 'Cola 330ml', barcode: '5010002', supplierCode: null },
    { sku: 'COLA-ZERO-330', name: 'Cola Zero 330ml', barcode: '5010003', supplierCode: null },
  ];

  it('matches on a learned supplier code first', () => {
    const m = matchLineToProduct({ rawCode: 'BW-771', rawName: 'anything' }, products);
    expect(m).toMatchObject({ sku: 'CRISP-SALT', confidence: 'exact', matchedBy: 'supplierCode' });
  });

  it('matches on our own SKU', () => {
    const m = matchLineToProduct({ rawCode: 'cola-330', rawName: null }, products);
    expect(m).toMatchObject({ sku: 'COLA-330', matchedBy: 'sku' });
  });

  it('matches on barcode', () => {
    const m = matchLineToProduct({ rawCode: '5010002', rawName: null }, products);
    expect(m).toMatchObject({ sku: 'COLA-330', matchedBy: 'barcode' });
  });

  it('falls back to a name match, flagged as likely', () => {
    const m = matchLineToProduct({ rawCode: 'ZZZ', rawName: 'Salted Crisps 40g' }, products);
    expect(m).toMatchObject({ sku: 'CRISP-SALT', confidence: 'likely', matchedBy: 'name' });
  });

  it('refuses to pick between two equally close names', () => {
    const two = [
      { sku: 'A', name: 'Cola 330ml' },
      { sku: 'B', name: 'Cola 330ml' },
    ];
    const m = matchLineToProduct({ rawCode: null, rawName: 'Cola 330ml' }, two);
    expect(m.sku).toBeNull();
    expect(m.candidates).toHaveLength(2);
  });

  it('offers candidates without auto-selecting a weak match', () => {
    const m = matchLineToProduct({ rawCode: null, rawName: 'Cola' }, products);
    expect(m.sku).toBeNull();
    expect(m.candidates.length).toBeGreaterThan(0);
  });

  it('returns no match for an unknown line', () => {
    const m = matchLineToProduct({ rawCode: 'XXX', rawName: 'Widget' }, products);
    expect(m).toMatchObject({ sku: null, confidence: 'none', candidates: [] });
  });
});

describe('applyInvoiceCosting', () => {
  const lines = [
    { quantity: 24, unitPrice: 0.5, lineDiscount: 0, lineTotal: 12 },
    { quantity: 12, unitPrice: 1, lineDiscount: 0, lineTotal: 12 },
  ];

  it('leaves unit costs alone with no discount', () => {
    const { lines: out } = applyInvoiceCosting({ lines });
    expect(out[0].effectiveUnitCost).toBe(0.5);
    expect(out[1].effectiveUnitCost).toBe(1);
  });

  it('spreads a whole-invoice discount pro rata by line value', () => {
    const { lines: out, netGoods } = applyInvoiceCosting({ lines, orderDiscount: 2.4 });
    // Equal line values, so the £2.40 splits £1.20/£1.20.
    expect(out[0].discountShare).toBe(1.2);
    expect(out[0].effectiveUnitCost).toBe(0.45);
    expect(out[1].effectiveUnitCost).toBe(0.9);
    expect(netGoods).toBe(21.6);
  });

  it('subtracts a line discount before spreading', () => {
    const withLineDisc = [{ quantity: 10, unitPrice: 2, lineDiscount: 5, lineTotal: 20 }];
    const { lines: out } = applyInvoiceCosting({ lines: withLineDisc });
    expect(out[0].effectiveLineTotal).toBe(15);
    expect(out[0].effectiveUnitCost).toBe(1.5);
  });

  it('excludes delivery from unit cost by default', () => {
    const { lines: out } = applyInvoiceCosting({ lines, deliveryCharge: 6 });
    expect(out[0].effectiveUnitCost).toBe(0.5);
  });

  it('lands delivery onto the goods when asked, pushing unit cost up', () => {
    const { lines: out } = applyInvoiceCosting({ lines, deliveryCharge: 6, spreadDelivery: true });
    expect(out[0].effectiveUnitCost).toBe(0.625); // 12 + 3 = 15 over 24 units
    expect(out[1].effectiveUnitCost).toBe(1.25);
  });

  it('pushes the rounding remainder onto the largest line so the total is exact', () => {
    const odd = [
      { quantity: 3, unitPrice: 1, lineDiscount: 0, lineTotal: 3 },
      { quantity: 3, unitPrice: 1, lineDiscount: 0, lineTotal: 3 },
      { quantity: 4, unitPrice: 1, lineDiscount: 0, lineTotal: 4 },
    ];
    const { lines: out, netGoods } = applyInvoiceCosting({ lines: odd, orderDiscount: 1 });
    expect(netGoods).toBe(9); // 10 - 1, to the penny
    expect(out.reduce((a, l) => a + l.discountShare, 0)).toBeCloseTo(1, 10);
  });

  it('gives a zero-value line no share of the discount', () => {
    const withFreebie = [
      { quantity: 10, unitPrice: 1, lineDiscount: 0, lineTotal: 10 },
      { quantity: 2, unitPrice: 0, lineDiscount: 0, lineTotal: 0 },
    ];
    const { lines: out } = applyInvoiceCosting({ lines: withFreebie, orderDiscount: 1 });
    expect(out[1].discountShare).toBe(0);
    expect(out[1].effectiveUnitCost).toBe(0);
    expect(out[0].effectiveUnitCost).toBe(0.9);
  });

  it('handles an empty invoice without dividing by zero', () => {
    const { lines: out, netGoods } = applyInvoiceCosting({ lines: [], orderDiscount: 5 });
    expect(out).toEqual([]);
    expect(netGoods).toBe(0);
  });
});

describe('isPriceVariance', () => {
  it('ignores a penny move on a cheap line', () => {
    expect(isPriceVariance(0.15, 0.16)).toBe(false);
  });

  it('flags a 10% move above the absolute floor', () => {
    expect(isPriceVariance(1.0, 1.15)).toBe(true);
  });

  it('ignores a 3% move on a large price', () => {
    expect(isPriceVariance(20, 20.5)).toBe(false);
  });

  it('is silent when either side is unknown', () => {
    expect(isPriceVariance(null, 1)).toBe(false);
    expect(isPriceVariance(1, null)).toBe(false);
  });
});

describe('buildReconciliation', () => {
  const orderItems = [
    { sku: 'A', name: 'Crisps', quantity: 24, receivedQty: 24, unitPrice: 0.5 },
    { sku: 'B', name: 'Cola', quantity: 12, receivedQty: 10, unitPrice: 1 },
    { sku: 'C', name: 'Water', quantity: 6, receivedQty: 6, unitPrice: 0.4 },
  ];

  it('pairs matched lines and reports a clean row as ok', () => {
    const { rows } = buildReconciliation({
      orderItems: [orderItems[0]],
      invoiceLines: [{ sku: 'A', quantity: 24, effectiveLineTotal: 12, effectiveUnitCost: 0.5 }],
    });
    expect(rows[0]).toMatchObject({ kind: 'both', ok: true, qtyVariance: 0 });
  });

  it('compares against RECEIVED quantity when a receipt exists', () => {
    const { rows } = buildReconciliation({
      orderItems: [orderItems[1]], // ordered 12, received 10
      invoiceLines: [{ sku: 'B', quantity: 12, effectiveLineTotal: 12, effectiveUnitCost: 1 }],
    });
    const row = rows.find((r) => r.sku === 'B');
    expect(row.compareBasis).toBe('received');
    expect(row.qtyVariance).toBe(2);
    expect(row.flags).toContain('over_invoiced');
  });

  it('falls back to ordered quantity before anything is received', () => {
    const { rows } = buildReconciliation({
      orderItems: [{ sku: 'A', name: 'Crisps', quantity: 24, receivedQty: 0, unitPrice: 0.5 }],
      invoiceLines: [{ sku: 'A', quantity: 24, effectiveLineTotal: 12, effectiveUnitCost: 0.5 }],
    });
    expect(rows[0].compareBasis).toBe('ordered');
    expect(rows[0].qtyVariance).toBe(0);
  });

  it('flags a price rise and reports the money', () => {
    const { rows } = buildReconciliation({
      orderItems: [orderItems[0]],
      invoiceLines: [{ sku: 'A', quantity: 24, effectiveLineTotal: 14.4, effectiveUnitCost: 0.6 }],
    });
    expect(rows[0].flags).toContain('price_up');
    expect(rows[0].priceVariance).toBe(0.1);
    expect(rows[0].valueVariance).toBe(2.4);
  });

  it('flags a discount as a price fall (the good kind of variance)', () => {
    const { rows } = buildReconciliation({
      orderItems: [orderItems[0]],
      invoiceLines: [{ sku: 'A', quantity: 24, effectiveLineTotal: 9.6, effectiveUnitCost: 0.4 }],
    });
    expect(rows[0].flags).toContain('price_down');
    expect(rows[0].valueVariance).toBe(-2.4);
  });

  it('keeps an invoice line that was never on the order', () => {
    const { rows, counts } = buildReconciliation({
      orderItems: [orderItems[0]],
      invoiceLines: [
        { sku: 'A', quantity: 24, effectiveLineTotal: 12, effectiveUnitCost: 0.5 },
        { sku: 'Z', rawName: 'Mystery bar', quantity: 5, effectiveLineTotal: 5, effectiveUnitCost: 1 },
      ],
    });
    const extra = rows.find((r) => r.sku === 'Z');
    expect(extra.kind).toBe('invoiceOnly');
    expect(extra.flags).toContain('not_on_order');
    expect(counts.issues).toBe(1);
  });

  it('keeps an ordered line that was never invoiced', () => {
    const { rows } = buildReconciliation({
      orderItems,
      invoiceLines: [{ sku: 'A', quantity: 24, effectiveLineTotal: 12, effectiveUnitCost: 0.5 }],
    });
    const missing = rows.filter((r) => r.flags.includes('not_invoiced')).map((r) => r.sku);
    expect(missing.sort()).toEqual(['B', 'C']);
  });

  it('sums several invoice lines for one SKU into a weighted unit cost', () => {
    const { rows } = buildReconciliation({
      orderItems: [{ sku: 'A', name: 'Crisps', quantity: 30, receivedQty: 30, unitPrice: 0.5 }],
      invoiceLines: [
        { sku: 'A', quantity: 10, effectiveLineTotal: 4, effectiveUnitCost: 0.4 },
        { sku: 'A', quantity: 20, effectiveLineTotal: 12, effectiveUnitCost: 0.6 },
      ],
    });
    expect(rows[0].invoicedQty).toBe(30);
    expect(rows[0].invoicedUnitCost).toBeCloseTo(0.5333, 4);
    expect(rows[0].qtyVariance).toBe(0);
  });

  it('reports a header total that does not match the lines', () => {
    const { totals } = buildReconciliation({
      orderItems: [orderItems[0]],
      invoiceLines: [{ sku: 'A', quantity: 24, effectiveLineTotal: 12, effectiveUnitCost: 0.5 }],
      header: { invoiceTotal: 20, vat: 2, deliveryCharge: 4 }, // implies goods of 14
    });
    expect(totals.expectedTotal).toBe(14);
    expect(totals.headerMismatch).toBe(-2);
  });

  it('reports no mismatch when the header adds up', () => {
    const { totals } = buildReconciliation({
      orderItems: [orderItems[0]],
      invoiceLines: [{ sku: 'A', quantity: 24, effectiveLineTotal: 12, effectiveUnitCost: 0.5 }],
      header: { invoiceTotal: 18, vat: 2, deliveryCharge: 4 },
    });
    expect(totals.headerMismatch).toBeNull();
  });

  it('counts invoice lines that matched nothing', () => {
    const { counts } = buildReconciliation({
      orderItems: [orderItems[0]],
      invoiceLines: [
        { sku: 'A', quantity: 24, effectiveLineTotal: 12, effectiveUnitCost: 0.5 },
        { sku: null, rawName: 'Unknown thing', quantity: 1, effectiveLineTotal: 1 },
      ],
    });
    expect(counts.unmatchedLines).toBe(1);
  });

  it('sorts issues above clean rows, biggest money first', () => {
    const { rows } = buildReconciliation({
      orderItems,
      invoiceLines: [
        { sku: 'A', quantity: 24, effectiveLineTotal: 12, effectiveUnitCost: 0.5 },   // clean
        { sku: 'B', quantity: 10, effectiveLineTotal: 15, effectiveUnitCost: 1.5 },   // +£5
        { sku: 'C', quantity: 6, effectiveLineTotal: 3.6, effectiveUnitCost: 0.6 },   // +£1.20
      ],
    });
    expect(rows.map((r) => r.sku)).toEqual(['B', 'C', 'A']);
  });
});
