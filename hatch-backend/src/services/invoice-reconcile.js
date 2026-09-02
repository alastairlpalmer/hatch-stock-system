/**
 * Supplier invoice reconciliation.
 *
 * The weekly buy ends at "goods on the shelf" today: a PO is raised from the
 * buying list at CATALOGUE cost, receiving records quantity/expiry/damage, and
 * the supplier's invoice is retyped into a spreadsheet by hand — so what we
 * actually paid, and every discount we were given, never reaches the system.
 * Margin is computed from a cost that is at best a guess.
 *
 * This module is the pure half of the fix: parse a pasted invoice table, match
 * its lines to the catalogue and to the PO, spread the whole-invoice discount
 * across the lines, and produce a per-line variance view. Everything here is
 * side-effect free and unit tested; persistence lives in routes/invoices.js.
 *
 * Nothing in here talks to the supplier's own PDF. The operator converts the
 * PDF to CSV (an LLM does this fine) and pastes it — parsing PDFs reliably is
 * a much larger problem than this workflow needs.
 */

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
// Unit costs keep four decimals: a 24-unit case at £13.99 is £0.5829 each, and
// rounding that to £0.58 loses 5p per case — real money at this volume.
const round4 = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000;

// ============ PARSING ============

/**
 * Split one delimited line, honouring double-quoted fields (which may contain
 * the delimiter) and the CSV "" escape for a literal quote.
 * Pure; exported for tests.
 */
export function splitDelimited(line, delimiter) {
  const out = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(field);
      field = '';
    } else field += ch;
  }
  out.push(field);
  return out.map((f) => f.trim());
}

/**
 * Guess the delimiter of a pasted table. Tab wins outright when present (a
 * paste straight out of a spreadsheet), otherwise whichever of comma or
 * semicolon appears most consistently across the first few lines.
 * Pure; exported for tests.
 */
export function detectDelimiter(lines) {
  const sample = lines.slice(0, 5);
  if (sample.some((l) => l.includes('\t'))) return '\t';
  const score = (d) => sample.reduce((a, l) => a + (l.split(d).length - 1), 0);
  return score(';') > score(',') ? ';' : ',';
}

// Header synonyms, longest/most specific first — "unit price" must beat the
// bare "price" rule, and "line total" must beat "total".
const COLUMN_RULES = [
  ['unitPrice', ['unit price', 'unit cost', 'price each', 'price per unit', 'each', 'unit £', 'net price', 'price/unit']],
  ['lineTotal', ['line total', 'net amount', 'line amount', 'goods value', 'value', 'amount', 'total']],
  ['discount', ['discount %', 'disc %', 'discount', 'disc', 'rebate']],
  ['quantity', ['qty', 'quantity', 'units', 'qty invoiced', 'qty supplied', 'cases', 'pack qty']],
  ['code', ['product code', 'item code', 'supplier code', 'sku', 'code', 'item', 'part no', 'product no']],
  ['name', ['description', 'product name', 'product', 'name', 'item description', 'details']],
  ['unitPrice', ['price']], // last-resort: a bare "price" column
];

const normalizeHeader = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9%£ ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Map header cells to canonical field names. Each field is claimed at most
 * once (the leftmost matching column wins) so a table with both "Price" and
 * "Unit Price" doesn't bind both to unitPrice. Pure; exported for tests.
 * @returns {{ [columnIndex: number]: string }}
 */
export function mapHeaderColumns(headerCells) {
  const mapping = {};
  const claimed = new Set();
  const normalized = headerCells.map(normalizeHeader);

  for (const [field, synonyms] of COLUMN_RULES) {
    if (claimed.has(field)) continue;
    for (const synonym of synonyms) {
      const idx = normalized.findIndex(
        (h, i) => mapping[i] === undefined && (h === synonym || h.includes(synonym)),
      );
      if (idx !== -1) {
        mapping[idx] = field;
        claimed.add(field);
        break;
      }
    }
  }
  return mapping;
}

// "£1,234.56", "(12.00)" (accounting negative), "12.5%" → number. Blank/junk
// returns null so a missing cell stays missing rather than becoming 0.
export function parseNumber(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/[£$€,\s]/g, '').replace(/%$/, '');
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

const isPercentColumn = (header) => /%|percent/i.test(String(header || ''));

/**
 * Parse a pasted invoice table into raw lines.
 *
 * The header row is the first row that maps to at least a quantity-ish and a
 * money-ish column; rows above it (supplier letterhead pasted along with the
 * table) are ignored. A row whose every mapped cell is blank, or that has no
 * usable quantity AND no usable money value, is skipped as a spacer/subtotal.
 *
 * Missing values are DERIVED where they can be, and only where the arithmetic
 * is unambiguous: lineTotal from qty × price, or unitPrice from total ÷ qty.
 * Nothing is invented — a line with neither stays flagged for the operator.
 *
 * Pure; exported for tests.
 * @returns {{ lines: Array, headerRow: string[]|null, mapping: Object, skipped: number, warnings: string[] }}
 */
export function parseInvoiceTable(text) {
  const warnings = [];
  const rawLines = String(text || '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);

  if (rawLines.length === 0) {
    return { lines: [], headerRow: null, mapping: {}, skipped: 0, warnings: ['Nothing to parse.'] };
  }

  const delimiter = detectDelimiter(rawLines);
  const rows = rawLines.map((l) => splitDelimited(l, delimiter));

  // Find the header: the first row that yields both a quantity column and at
  // least one money column. Scanning (rather than assuming row 0) is what lets
  // a whole invoice — address block and all — be pasted in one go.
  let headerIdx = -1;
  let mapping = {};
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const candidate = mapHeaderColumns(rows[i]);
    const fields = new Set(Object.values(candidate));
    if (fields.has('quantity') && (fields.has('unitPrice') || fields.has('lineTotal'))) {
      headerIdx = i;
      mapping = candidate;
      break;
    }
  }

  if (headerIdx === -1) {
    return {
      lines: [],
      headerRow: null,
      mapping: {},
      skipped: 0,
      warnings: ['Could not find a header row — the table needs a quantity column and a price or total column.'],
    };
  }

  const headerRow = rows[headerIdx];
  const fieldsFound = new Set(Object.values(mapping));
  if (!fieldsFound.has('code') && !fieldsFound.has('name')) {
    warnings.push('No product code or description column found — lines will need matching by hand.');
  }

  // A discount column headed "%" is a rate, not an amount.
  const discountIdx = Object.entries(mapping).find(([, f]) => f === 'discount')?.[0];
  const discountIsPercent = discountIdx != null && isPercentColumn(headerRow[discountIdx]);

  const lines = [];
  let skipped = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = rows[i];
    const get = (field) => {
      const idx = Object.entries(mapping).find(([, f]) => f === field)?.[0];
      return idx == null ? null : cells[idx];
    };

    const rawCode = (get('code') || '').trim() || null;
    const rawName = (get('name') || '').trim() || null;
    let quantity = parseNumber(get('quantity'));
    let unitPrice = parseNumber(get('unitPrice'));
    let lineTotal = parseNumber(get('lineTotal'));
    const discountRaw = parseNumber(get('discount'));

    // Spacer rows, and trailing summary rows ("Subtotal", "VAT", "TOTAL") that
    // carry a money value but no quantity.
    if (quantity == null && unitPrice == null && lineTotal == null) { skipped++; continue; }
    if (quantity == null && !rawCode) { skipped++; continue; }

    // Fill in the third value when two of qty/price/total are present.
    if (lineTotal == null && quantity != null && unitPrice != null) {
      lineTotal = round2(quantity * unitPrice);
    } else if (unitPrice == null && quantity != null && quantity !== 0 && lineTotal != null) {
      unitPrice = round4(lineTotal / quantity);
    } else if (quantity == null && unitPrice != null && unitPrice !== 0 && lineTotal != null) {
      quantity = round2(lineTotal / unitPrice);
    }

    if (quantity == null || lineTotal == null) { skipped++; continue; }

    // A percentage discount column is converted to the £ it takes off this
    // line, so every downstream figure is in one unit (pounds).
    let lineDiscount = 0;
    if (discountRaw != null && discountRaw !== 0) {
      const gross = quantity * (unitPrice ?? 0);
      lineDiscount = discountIsPercent ? round2(gross * (discountRaw / 100)) : round2(discountRaw);
    }

    lines.push({
      rowNumber: i - headerIdx,
      rawCode,
      rawName,
      quantity,
      unitPrice: unitPrice ?? round4(lineTotal / (quantity || 1)),
      lineDiscount,
      lineTotal,
    });
  }

  if (lines.length === 0) warnings.push('Header found, but no usable product lines below it.');

  return { lines, headerRow, mapping, skipped, warnings };
}

// ============ MATCHING ============

const normalizeName = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const STOPWORDS = new Set(['the', 'and', 'with', 'pack', 'box', 'case', 'x', 'of', 'ltd']);

const tokensOf = (s) => new Set(normalizeName(s).split(' ').filter((t) => t && !STOPWORDS.has(t)));

/**
 * Jaccard token overlap between two product names, 0–1. Deliberately crude:
 * it only ever produces a SUGGESTION the operator confirms, so precision
 * matters more than cleverness. Pure; exported for tests.
 */
export function nameSimilarity(a, b) {
  const ta = tokensOf(a);
  const tb = tokensOf(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

// Confidence tiers. `exact` matches are applied silently; `likely` is
// pre-selected but visibly flagged; below NAME_SUGGEST_THRESHOLD nothing is
// proposed at all — a wrong silent match corrupts cost data, which is worse
// than making the operator pick from a list.
const NAME_MATCH_THRESHOLD = 0.7;
const NAME_SUGGEST_THRESHOLD = 0.4;

/**
 * Match one parsed invoice line to a catalogue product.
 *
 * Order: supplier code (learned from a previous reconcile) → SKU → barcode →
 * name similarity. The first three are exact identity and match outright; a
 * name match only auto-selects above NAME_MATCH_THRESHOLD and is always
 * reported as `likely` so the UI can mark it.
 *
 * Pure; exported for tests.
 * @param {Object} line parsed line ({ rawCode, rawName, ... })
 * @param {Array} products [{ sku, name, barcode, supplierCode }]
 * @returns {{ sku: string|null, confidence: 'exact'|'likely'|'none', matchedBy: string|null, candidates: Array }}
 */
export function matchLineToProduct(line, products) {
  const code = String(line.rawCode || '').trim().toLowerCase();
  const none = { sku: null, confidence: 'none', matchedBy: null, candidates: [] };

  if (code) {
    const bySupplierCode = products.find(
      (p) => p.supplierCode && String(p.supplierCode).toLowerCase() === code,
    );
    if (bySupplierCode) {
      return { sku: bySupplierCode.sku, confidence: 'exact', matchedBy: 'supplierCode', candidates: [] };
    }
    const bySku = products.find((p) => String(p.sku).toLowerCase() === code);
    if (bySku) return { sku: bySku.sku, confidence: 'exact', matchedBy: 'sku', candidates: [] };

    const byBarcode = products.find((p) => p.barcode && String(p.barcode).toLowerCase() === code);
    if (byBarcode) return { sku: byBarcode.sku, confidence: 'exact', matchedBy: 'barcode', candidates: [] };
  }

  if (!line.rawName) return none;

  const scored = products
    .map((p) => ({ sku: p.sku, name: p.name, score: round2(nameSimilarity(line.rawName, p.name)) }))
    .filter((c) => c.score >= NAME_SUGGEST_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (scored.length === 0) return none;
  // An ambiguous top score (two products equally close) is no match at all —
  // "Coke 330ml" against "Coke Zero 330ml" must not silently pick one.
  const decisive = scored.length === 1 || scored[0].score > scored[1].score;
  if (scored[0].score >= NAME_MATCH_THRESHOLD && decisive) {
    return { sku: scored[0].sku, confidence: 'likely', matchedBy: 'name', candidates: scored };
  }
  return { ...none, candidates: scored };
}

// ============ COSTING ============

/**
 * Apply a whole-invoice discount (and optionally the delivery charge) across
 * the lines pro rata by line value, and return each line's effective unit cost
 * — what a single unit of that product actually cost us, all discounts in.
 *
 * Delivery is EXCLUDED by default: it is a cost of the order, not of the
 * product, and folding it in makes this week's unit cost depend on how much
 * else happened to be on the same van. `spreadDelivery` is there for the
 * suppliers who quote ex-delivery prices and expect it landed.
 *
 * Zero-value lines (a free case, a promotional unit) take no share of the
 * discount — pro rata on a zero base would divide by zero — and their
 * effective cost is whatever their own line says, normally £0.
 *
 * Pure; exported for tests.
 * @returns {{ lines: Array, netGoods: number, allocatedDiscount: number }}
 */
export function applyInvoiceCosting({
  lines = [],
  orderDiscount = 0,
  deliveryCharge = 0,
  spreadDelivery = false,
}) {
  const netOf = (l) => (l.lineTotal || 0) - (l.lineDiscount || 0);
  const base = lines.reduce((a, l) => a + Math.max(0, netOf(l)), 0);
  // toAllocate is the £ to take OFF the lines: the order discount, less the
  // delivery charge when delivery is being landed onto the goods (which pushes
  // unit costs UP, hence the subtraction).
  const toAllocate = (orderDiscount || 0) - (spreadDelivery ? (deliveryCharge || 0) : 0);

  let allocated = 0;
  const out = lines.map((l, i) => {
    const net = netOf(l);
    let share = 0;
    if (base > 0 && net > 0 && toAllocate !== 0) {
      share = round2(toAllocate * (net / base));
      allocated += share;
    }
    return { ...l, _net: net, _share: share, _idx: i };
  });

  // Rounding each share independently loses (or gains) a penny or two against
  // the invoice total. Push the remainder onto the largest line so the sum of
  // the effective line values equals the invoice exactly.
  const remainder = round2(toAllocate - allocated);
  if (remainder !== 0 && out.length > 0 && base > 0) {
    const largest = out.reduce((a, b) => (b._net > a._net ? b : a));
    largest._share = round2(largest._share + remainder);
  }

  const costed = out.map(({ _net, _share, _idx, ...l }) => {
    const effectiveTotal = round2(_net - _share);
    const qty = l.quantity || 0;
    return {
      ...l,
      effectiveLineTotal: effectiveTotal,
      effectiveUnitCost: qty > 0 ? round4(effectiveTotal / qty) : null,
      discountShare: _share,
    };
  });

  return {
    lines: costed,
    netGoods: round2(costed.reduce((a, l) => a + l.effectiveLineTotal, 0)),
    allocatedDiscount: round2(toAllocate),
  };
}

// ============ RECONCILIATION ============

// A price is "off" when it moves by more than 5% AND by more than 2p a unit —
// both, so a 1p move on a 15p item doesn't cry wolf and a 3% move on a £20
// case still does.
export const PRICE_TOLERANCE_PCT = 0.05;
export const PRICE_TOLERANCE_ABS = 0.02;

/**
 * True when an invoiced unit cost differs materially from what was expected.
 * Pure; exported for tests.
 */
export function isPriceVariance(expected, actual) {
  if (expected == null || actual == null) return false;
  const abs = Math.abs(actual - expected);
  if (abs <= PRICE_TOLERANCE_ABS) return false;
  if (expected === 0) return abs > PRICE_TOLERANCE_ABS;
  return abs / Math.abs(expected) > PRICE_TOLERANCE_PCT;
}

/**
 * Build the side-by-side reconciliation view: one row per SKU across the PO
 * and the invoice, plus the header checks.
 *
 * Rows come in three shapes and every one is kept — the point of the screen is
 * that nothing goes missing:
 *  - `both`         on the PO and on the invoice
 *  - `invoiceOnly`  charged for but never ordered (substitution, or an error)
 *  - `orderOnly`    ordered and not invoiced (yet — a second invoice may follow)
 *
 * Quantity is compared against what was RECEIVED where a receipt exists, and
 * against what was ordered otherwise: being invoiced for 40 when 36 turned up
 * is the variance worth money, and ordered-vs-invoiced would hide it whenever
 * the supplier short-shipped and invoiced correctly.
 *
 * Pure; exported for tests.
 * @param {Object} p
 * @param {Array} p.orderItems [{ sku, name, quantity, receivedQty, unitPrice }]
 * @param {Array} p.invoiceLines costed lines [{ sku, quantity, effectiveUnitCost, ... }]
 * @param {Object} p.header { goodsTotal, orderDiscount, deliveryCharge, vat, invoiceTotal }
 */
export function buildReconciliation({ orderItems = [], invoiceLines = [], header = {} }) {
  const bySku = new Map();

  for (const item of orderItems) {
    bySku.set(item.sku, {
      sku: item.sku,
      name: item.name || item.sku,
      kind: 'orderOnly',
      orderedQty: item.quantity || 0,
      receivedQty: item.receivedQty || 0,
      expectedUnitPrice: item.unitPrice ?? null,
      invoicedQty: 0,
      invoicedValue: 0,
      invoicedUnitCost: null,
    });
  }

  // Suppliers split a SKU across several invoice lines (two date lots, a
  // part-case). Sum them and derive one weighted unit cost, or the comparison
  // would be against whichever line happened to come last.
  for (const line of invoiceLines) {
    if (!line.sku) continue;
    const existing = bySku.get(line.sku);
    const row = existing || {
      sku: line.sku,
      name: line.rawName || line.sku,
      kind: 'invoiceOnly',
      orderedQty: 0,
      receivedQty: 0,
      expectedUnitPrice: null,
      invoicedQty: 0,
      invoicedValue: 0,
      invoicedUnitCost: null,
    };
    if (existing) row.kind = 'both';
    row.invoicedQty = round2(row.invoicedQty + (line.quantity || 0));
    row.invoicedValue = round2(row.invoicedValue + (line.effectiveLineTotal ?? line.lineTotal ?? 0));
    row.invoicedUnitCost = row.invoicedQty > 0 ? round4(row.invoicedValue / row.invoicedQty) : null;
    bySku.set(row.sku, row);
  }

  const rows = [...bySku.values()].map((row) => {
    // Compare against receipts once anything has been booked in; before that,
    // the ordered quantity is the only truth we have.
    const compareQty = row.receivedQty > 0 ? row.receivedQty : row.orderedQty;
    const qtyVariance = row.kind === 'orderOnly' ? 0 : round2(row.invoicedQty - compareQty);
    const priceVariance = row.expectedUnitPrice != null && row.invoicedUnitCost != null
      ? round4(row.invoicedUnitCost - row.expectedUnitPrice)
      : null;
    const flags = [];
    if (row.kind === 'invoiceOnly') flags.push('not_on_order');
    if (row.kind === 'orderOnly') flags.push('not_invoiced');
    if (qtyVariance !== 0 && row.kind === 'both') flags.push(qtyVariance > 0 ? 'over_invoiced' : 'under_invoiced');
    if (isPriceVariance(row.expectedUnitPrice, row.invoicedUnitCost)) {
      flags.push(priceVariance > 0 ? 'price_up' : 'price_down');
    }
    return {
      ...row,
      compareQty,
      compareBasis: row.receivedQty > 0 ? 'received' : 'ordered',
      qtyVariance,
      priceVariance,
      priceVariancePct: row.expectedUnitPrice
        ? round2(((row.invoicedUnitCost - row.expectedUnitPrice) / row.expectedUnitPrice) * 100)
        : null,
      valueVariance: row.expectedUnitPrice != null
        ? round2(row.invoicedValue - row.expectedUnitPrice * row.invoicedQty)
        : null,
      flags,
      ok: flags.length === 0,
    };
  });

  // Issues to the top, then biggest money first — the screen should open on
  // whatever is worth arguing with the supplier about.
  rows.sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? 1 : -1;
    return Math.abs(b.valueVariance ?? 0) - Math.abs(a.valueVariance ?? 0);
  });

  // Header arithmetic: do the lines actually add up to the invoice's own
  // printed total? A mismatch here is nearly always a keying slip, and
  // catching it now beats discovering it in the accounts.
  const linesTotal = round2(invoiceLines.reduce((a, l) => a + (l.effectiveLineTotal ?? l.lineTotal ?? 0), 0));
  const expectedTotal = header.invoiceTotal != null
    ? round2(header.invoiceTotal - (header.vat || 0) - (header.deliveryCharge || 0))
    : null;
  const headerMismatch = expectedTotal != null && Math.abs(linesTotal - expectedTotal) > 0.02
    ? round2(linesTotal - expectedTotal)
    : null;

  const unmatchedLines = invoiceLines.filter((l) => !l.sku).length;

  return {
    rows,
    totals: {
      linesTotal,
      expectedTotal,
      headerMismatch,
      orderExpected: round2(orderItems.reduce((a, i) => a + (i.quantity || 0) * (i.unitPrice || 0), 0)),
      invoicedValue: round2(rows.reduce((a, r) => a + r.invoicedValue, 0)),
      totalValueVariance: round2(rows.reduce((a, r) => a + (r.valueVariance ?? 0), 0)),
    },
    counts: {
      total: rows.length,
      issues: rows.filter((r) => !r.ok).length,
      unmatchedLines,
    },
  };
}
