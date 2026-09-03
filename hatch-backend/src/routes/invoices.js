import express from 'express';
import { z } from 'zod';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  parseInvoiceTable,
  matchLineToProduct,
  applyInvoiceCosting,
  buildReconciliation,
} from '../services/invoice-reconcile.js';
import { planCostBackfill } from '../services/cost-backfill.js';

const router = express.Router();

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const round4 = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000;

const money = z.coerce.number().nullish();

const lineSchema = z.object({
  sku: z.string().min(1).nullish(),
  rawCode: z.string().nullish(),
  rawName: z.string().nullish(),
  quantity: z.coerce.number(),
  unitPrice: z.coerce.number(),
  lineDiscount: z.coerce.number().default(0),
  lineTotal: z.coerce.number(),
  matchedBy: z.enum(['supplierCode', 'sku', 'barcode', 'name', 'manual']).nullish(),
});

const headerSchema = {
  orderId: z.string().min(1).nullish(),
  supplierId: z.string().min(1).nullish(),
  invoiceRef: z.string().min(1),
  invoiceDate: z.string().nullish().refine(
    (v) => v == null || v === '' || !isNaN(Date.parse(v)),
    { message: 'invoiceDate must be a valid date' },
  ),
  goodsTotal: money,
  orderDiscount: money,
  deliveryCharge: money,
  vat: money,
  invoiceTotal: money,
  spreadDelivery: z.coerce.boolean().default(false),
  notes: z.string().nullish(),
};

const createSchema = z.object({
  ...headerSchema,
  lines: z.array(lineSchema).default([]),
});

const updateSchema = z.object({
  ...headerSchema,
  invoiceRef: z.string().min(1).optional(),
  lines: z.array(lineSchema).optional(),
}).partial();

const toDate = (v) => (v ? new Date(v) : null);

// Cost the lines with the header's discount rules, so what we persist as
// effectiveUnitCost is the same number the reconcile view showed.
function costLines(lines, header) {
  return applyInvoiceCosting({
    lines,
    orderDiscount: header.orderDiscount ?? 0,
    deliveryCharge: header.deliveryCharge ?? 0,
    spreadDelivery: !!header.spreadDelivery,
  }).lines;
}

const invoiceInclude = {
  lines: true,
  supplier: { select: { id: true, name: true } },
  order: {
    select: {
      id: true, status: true, totalAmount: true, expectedDate: true, createdAt: true,
      supplier: { select: { id: true, name: true } },
    },
  },
};

// ============ PARSE ============

// Parse a pasted invoice table and match its lines to the catalogue. Stateless
// — nothing is saved. The UI calls this on paste so the operator sees the
// matched grid before committing to anything.
//
// Product matching is scoped to the invoice's supplier when one is given (plus
// products with no preferred supplier, which are usually just unconfigured):
// a supplier's own product code is only meaningful within that supplier, and
// matching against the whole catalogue invites cross-supplier collisions.
router.post('/parse', asyncHandler(async (req, res) => {
  const { text, supplierId } = z.object({
    text: z.string(),
    supplierId: z.string().min(1).nullish(),
  }).parse(req.body);

  const parsed = parseInvoiceTable(text);

  const products = await prisma.product.findMany({
    where: supplierId
      ? { OR: [{ preferredSupplierId: supplierId }, { preferredSupplierId: null }] }
      : undefined,
    select: { sku: true, name: true, barcode: true, supplierCode: true, unitCost: true },
  });

  const costOf = Object.fromEntries(products.map((p) => [p.sku, p.unitCost]));

  const lines = parsed.lines.map((line) => {
    const match = matchLineToProduct(line, products);
    return {
      ...line,
      sku: match.sku,
      matchedBy: match.matchedBy,
      confidence: match.confidence,
      candidates: match.candidates,
      currentUnitCost: match.sku ? costOf[match.sku] ?? null : null,
    };
  });

  res.json({
    lines,
    headerRow: parsed.headerRow,
    skipped: parsed.skipped,
    warnings: parsed.warnings,
    matched: lines.filter((l) => l.sku).length,
    unmatched: lines.filter((l) => !l.sku).length,
  });
}));

// ============ CRUD ============

// List invoices, newest first. `status` and `supplierId` filter; `orderId`
// fetches the invoices raised against one PO.
router.get('/', asyncHandler(async (req, res) => {
  const { status, supplierId, orderId } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  const invoices = await prisma.supplierInvoice.findMany({
    where: {
      ...(status && { status }),
      ...(supplierId && { supplierId }),
      ...(orderId && { orderId }),
    },
    include: {
      supplier: { select: { id: true, name: true } },
      order: { select: { id: true, status: true } },
      _count: { select: { lines: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  res.json(invoices);
}));

// Get one invoice WITH its reconciliation against the linked PO. This is the
// screen's single fetch: header, lines, variance rows and totals.
router.get('/:id', asyncHandler(async (req, res) => {
  const invoice = await prisma.supplierInvoice.findUnique({
    where: { id: req.params.id },
    include: invoiceInclude,
  });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const orderItems = invoice.orderId
    ? await prisma.orderItem.findMany({
        where: { orderId: invoice.orderId },
        include: { product: { select: { name: true } } },
      })
    : [];

  const costed = costLines(invoice.lines, invoice);
  const reconciliation = buildReconciliation({
    orderItems: orderItems.map((i) => ({
      sku: i.sku,
      name: i.product?.name || i.sku,
      quantity: i.quantity,
      receivedQty: i.receivedQty,
      unitPrice: i.unitPrice,
    })),
    invoiceLines: costed,
    header: invoice,
  });

  res.json({ ...invoice, lines: costed, reconciliation });
}));

// Create an invoice. Lines are costed on the way in so effectiveUnitCost is
// stored, not recomputed differently later.
router.post('/', asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);

  // Inherit the supplier from the PO when the caller didn't name one — the
  // common path is "reconcile THIS order", where the supplier is implied.
  let supplierId = data.supplierId ?? null;
  if (data.orderId) {
    const order = await prisma.order.findUnique({
      where: { id: data.orderId },
      select: { id: true, supplierId: true },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    supplierId = supplierId ?? order.supplierId;
  }

  const costed = costLines(data.lines, data);

  try {
    const invoice = await prisma.supplierInvoice.create({
      data: {
        orderId: data.orderId ?? null,
        supplierId,
        invoiceRef: data.invoiceRef,
        invoiceDate: toDate(data.invoiceDate),
        goodsTotal: data.goodsTotal ?? null,
        orderDiscount: data.orderDiscount ?? null,
        deliveryCharge: data.deliveryCharge ?? null,
        vat: data.vat ?? null,
        invoiceTotal: data.invoiceTotal ?? null,
        spreadDelivery: !!data.spreadDelivery,
        notes: data.notes ?? null,
        lines: {
          create: costed.map((l) => ({
            sku: l.sku ?? null,
            rawCode: l.rawCode ?? null,
            rawName: l.rawName ?? null,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            lineDiscount: l.lineDiscount ?? 0,
            lineTotal: l.lineTotal,
            effectiveUnitCost: l.effectiveUnitCost ?? null,
            matchedBy: l.matchedBy ?? null,
          })),
        },
      },
      include: invoiceInclude,
    });
    res.status(201).json(invoice);
  } catch (err) {
    // Unique (supplier_id, invoice_ref) — the same invoice pasted twice would
    // otherwise double-count the spend.
    if (err.code === 'P2002') {
      return res.status(409).json({
        error: `Invoice ${data.invoiceRef} is already recorded for this supplier`,
        code: 'DUPLICATE_INVOICE',
      });
    }
    throw err;
  }
}));

// Update a draft invoice. Lines are replaced wholesale when supplied — the
// grid is edited as a unit, and diffing individual rows would buy nothing.
// A reconciled invoice is frozen: it has already written costs to products,
// and silently changing it would leave those costs unexplained.
router.put('/:id', asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);

  const existing = await prisma.supplierInvoice.findUnique({
    where: { id: req.params.id },
    include: { lines: true },
  });
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  if (existing.status === 'reconciled') {
    return res.status(409).json({
      error: 'This invoice is reconciled — unreconcile it before editing',
      code: 'ALREADY_RECONCILED',
    });
  }

  // Costing depends on the header discount fields, so a header-only edit still
  // has to re-cost the stored lines.
  const header = {
    orderDiscount: data.orderDiscount !== undefined ? data.orderDiscount : existing.orderDiscount,
    deliveryCharge: data.deliveryCharge !== undefined ? data.deliveryCharge : existing.deliveryCharge,
    spreadDelivery: data.spreadDelivery !== undefined ? data.spreadDelivery : existing.spreadDelivery,
  };
  const sourceLines = data.lines ?? existing.lines;
  const costed = costLines(sourceLines, header);

  const invoice = await prisma.$transaction(async (tx) => {
    await tx.supplierInvoiceLine.deleteMany({ where: { invoiceId: existing.id } });
    return tx.supplierInvoice.update({
      where: { id: existing.id },
      data: {
        ...(data.orderId !== undefined && { orderId: data.orderId ?? null }),
        ...(data.supplierId !== undefined && { supplierId: data.supplierId ?? null }),
        ...(data.invoiceRef !== undefined && { invoiceRef: data.invoiceRef }),
        ...(data.invoiceDate !== undefined && { invoiceDate: toDate(data.invoiceDate) }),
        ...(data.goodsTotal !== undefined && { goodsTotal: data.goodsTotal ?? null }),
        ...(data.orderDiscount !== undefined && { orderDiscount: data.orderDiscount ?? null }),
        ...(data.deliveryCharge !== undefined && { deliveryCharge: data.deliveryCharge ?? null }),
        ...(data.vat !== undefined && { vat: data.vat ?? null }),
        ...(data.invoiceTotal !== undefined && { invoiceTotal: data.invoiceTotal ?? null }),
        ...(data.spreadDelivery !== undefined && { spreadDelivery: !!data.spreadDelivery }),
        ...(data.notes !== undefined && { notes: data.notes ?? null }),
        lines: {
          create: costed.map((l) => ({
            sku: l.sku ?? null,
            rawCode: l.rawCode ?? null,
            rawName: l.rawName ?? null,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            lineDiscount: l.lineDiscount ?? 0,
            lineTotal: l.lineTotal,
            effectiveUnitCost: l.effectiveUnitCost ?? null,
            matchedBy: l.matchedBy ?? null,
          })),
        },
      },
      include: invoiceInclude,
    });
  });

  res.json(invoice);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const existing = await prisma.supplierInvoice.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  if (existing.status === 'reconciled') {
    return res.status(409).json({
      error: 'This invoice is reconciled — unreconcile it before deleting',
      code: 'ALREADY_RECONCILED',
    });
  }
  await prisma.supplierInvoice.delete({ where: { id: existing.id } });
  res.json({ success: true });
}));

// ============ RECONCILE ============

/**
 * Accept the invoice as the truth about what we paid.
 *
 * Four writes, one transaction:
 *  1. order_items gain invoicedQty / invoicedUnitPrice, so the PO carries the
 *     ordered / received / invoiced triple.
 *  2. price_history gains a row per SKU whose effective cost MOVED (an
 *     unchanged price is not a price change and would only pad the trail).
 *  3. products.unit_cost is set to the effective cost, and cost_locked is set
 *     so the VendLive catalog sync can't overwrite a figure proved by an
 *     invoice with VendLive's own guess.
 *  4. lines matched by hand promote their rawCode to products.supplier_code,
 *     so this supplier's next invoice matches that line automatically.
 *
 * Step 4 is why the job gets quicker every week rather than staying constant.
 */
router.post('/:id/reconcile', asyncHandler(async (req, res) => {
  const { reconciledBy, updateCosts = true } = z.object({
    reconciledBy: z.string().nullish(),
    // The escape hatch for a genuinely odd invoice (a one-off promo price, a
    // sample order) that shouldn't reset the standing cost.
    updateCosts: z.coerce.boolean().default(true),
  }).parse(req.body ?? {});

  const invoice = await prisma.supplierInvoice.findUnique({
    where: { id: req.params.id },
    include: { lines: true },
  });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status === 'reconciled') {
    return res.status(409).json({ error: 'Invoice is already reconciled', code: 'ALREADY_RECONCILED' });
  }

  const costed = costLines(invoice.lines, invoice);
  const matched = costed.filter((l) => l.sku && l.effectiveUnitCost != null);

  // Several invoice lines can carry the same SKU (two lots, a part case).
  // Collapse to one weighted cost per SKU before writing anything.
  const perSku = new Map();
  for (const line of matched) {
    const row = perSku.get(line.sku) || { sku: line.sku, qty: 0, value: 0 };
    row.qty += line.quantity || 0;
    row.value += line.effectiveLineTotal ?? 0;
    perSku.set(line.sku, row);
  }
  const skuCosts = [...perSku.values()]
    .filter((r) => r.qty > 0)
    .map((r) => ({ sku: r.sku, qty: round2(r.qty), unitCost: round4(r.value / r.qty) }));

  const effectiveFrom = invoice.invoiceDate ?? new Date();

  const result = await prisma.$transaction(async (tx) => {
    // 1. Write the invoiced figures onto the PO lines.
    let orderLinesUpdated = 0;
    if (invoice.orderId) {
      for (const { sku, qty, unitCost } of skuCosts) {
        const { count } = await tx.orderItem.updateMany({
          where: { orderId: invoice.orderId, sku },
          data: { invoicedQty: qty, invoicedUnitPrice: unitCost },
        });
        orderLinesUpdated += count;
      }
    }

    // 2/3. Cost trail + current cost.
    //
    // Two different things happen here, and conflating them was a bug:
    //
    //   * price_history gets a row only when the cost MOVED. An invoice that
    //     confirms last week's price is not a price change, and recording it
    //     as one would fill the trail with noise and make a real rise hard to
    //     spot.
    //   * cost_locked is set for EVERY matched SKU regardless. The invoice
    //     proves the cost whether or not it changed, and leaving a confirmed
    //     cost unlocked let the next VendLive sync overwrite it with their
    //     figure — silently undoing the reconciliation for exactly the
    //     products whose price was stable.
    const priceChanges = [];
    if (updateCosts && skuCosts.length > 0) {
      const products = await tx.product.findMany({
        where: { sku: { in: skuCosts.map((s) => s.sku) } },
        select: { sku: true, unitCost: true },
      });
      const previousOf = Object.fromEntries(products.map((p) => [p.sku, p.unitCost]));

      for (const { sku, unitCost } of skuCosts) {
        if (!(sku in previousOf)) continue; // product deleted since the paste
        const previous = previousOf[sku];
        // Round both sides to the pound-and-pence a human would compare, so a
        // 0.0001 float wobble doesn't register as a price change.
        const moved = previous == null || round4(previous) !== unitCost;

        if (moved) {
          await tx.priceHistory.create({
            data: {
              sku,
              supplierId: invoice.supplierId,
              unitCost,
              source: 'invoice',
              invoiceId: invoice.id,
              effectiveFrom,
            },
          });
          priceChanges.push({ sku, previous, unitCost, delta: round4(unitCost - (previous ?? unitCost)) });
        }

        await tx.product.update({
          where: { sku },
          data: { unitCost, costLocked: true },
        });
      }
    }

    // 4. Learn the supplier's product codes from hand-matched lines.
    let codesLearned = 0;
    const handMatched = costed.filter((l) => l.sku && l.matchedBy === 'manual' && l.rawCode);
    for (const line of handMatched) {
      const { count } = await tx.product.updateMany({
        // Only fill a BLANK code: an operator correcting one line must not
        // silently retag a product whose code we already know.
        where: { sku: line.sku, supplierCode: null },
        data: { supplierCode: line.rawCode },
      });
      codesLearned += count;
    }

    const updated = await tx.supplierInvoice.update({
      where: { id: invoice.id },
      data: { status: 'reconciled', reconciledAt: new Date(), reconciledBy: reconciledBy ?? null },
      include: invoiceInclude,
    });

    return { invoice: updated, priceChanges, orderLinesUpdated, codesLearned };
  });

  res.json(result);
}));

// Reopen a reconciled invoice for editing. Deliberately does NOT roll back the
// costs it wrote: products.unit_cost is "what we last paid", and the invoice
// that proved it having been reopened doesn't make the payment un-happen. The
// price_history rows stay too — the trail is append-only by design. Correcting
// a cost that was reconciled in error means fixing the invoice and reconciling
// it again, which appends the correction.
router.post('/:id/unreconcile', asyncHandler(async (req, res) => {
  const invoice = await prisma.supplierInvoice.findUnique({ where: { id: req.params.id } });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status !== 'reconciled') {
    return res.status(409).json({ error: 'Invoice is not reconciled' });
  }

  const updated = await prisma.supplierInvoice.update({
    where: { id: invoice.id },
    data: { status: 'draft', reconciledAt: null, reconciledBy: null },
    include: invoiceInclude,
  });

  res.json(updated);
}));

// ============ COST BACKFILL ============

/**
 * Restate historical sales.cost_price from the invoice trail.
 *
 * Every margin figure in the app comes from sales.cost_price, a snapshot taken
 * at ingest. Before invoices were reconcilable that snapshot could only be
 * VendLive's costPrice, so all historical margin is computed against a number
 * nobody could prove. Reconciling fixes new sales; this fixes the old ones.
 *
 * Defaults to a DRY RUN. Restating cost moves reported profit on closed
 * periods — that is not something to do on a single click without first
 * showing the operator, in pounds and in margin points, exactly what it will
 * change.
 *
 * Refunded sales are excluded by default: they are already netted out of every
 * revenue figure, so restating their cost moves nothing and only inflates the
 * change count.
 */
router.post('/backfill-sale-costs', asyncHandler(async (req, res) => {
  const { dryRun, sku, since, until, includeRefunded, limit } = z.object({
    // Opt IN to writing. A misread dry run is recoverable; a surprise
    // restatement of a closed quarter is not.
    dryRun: z.coerce.boolean().default(true),
    sku: z.string().min(1).nullish(),
    since: z.string().nullish().refine((v) => v == null || !isNaN(Date.parse(v)), { message: 'since must be a valid date' }),
    until: z.string().nullish().refine((v) => v == null || !isNaN(Date.parse(v)), { message: 'until must be a valid date' }),
    includeRefunded: z.coerce.boolean().default(false),
    limit: z.coerce.number().int().min(1).max(200000).default(100000),
  }).parse(req.body ?? {});

  // Only invoice-proved history counts. The 'manual' baselines seeded by
  // manual-sql/033 were copied FROM products.unit_cost — restating a sale from
  // one would launder the guess we are trying to correct.
  const history = await prisma.priceHistory.findMany({
    where: { source: 'invoice', ...(sku ? { sku } : {}) },
    select: { sku: true, unitCost: true, effectiveFrom: true },
    orderBy: [{ sku: 'asc' }, { effectiveFrom: 'asc' }],
  });

  if (history.length === 0) {
    return res.json({
      dryRun,
      applied: 0,
      message: 'No invoice-proved costs yet — reconcile an invoice first, then run this.',
      plan: { changes: [], unchanged: 0, noHistory: 0, costDelta: 0, profitDelta: 0, marginDeltaPct: null },
    });
  }

  const historyBySku = {};
  for (const row of history) (historyBySku[row.sku] ||= []).push(row);

  const sales = await prisma.sale.findMany({
    where: {
      sku: { in: Object.keys(historyBySku) },
      ...(includeRefunded ? {} : { isRefunded: false }),
      ...(since || until ? {
        timestamp: {
          ...(since ? { gte: new Date(since) } : {}),
          ...(until ? { lte: new Date(until) } : {}),
        },
      } : {}),
    },
    select: { id: true, sku: true, quantity: true, charged: true, costPrice: true, timestamp: true },
    take: limit,
  });

  const plan = planCostBackfill(sales, historyBySku);

  if (dryRun) {
    return res.json({
      dryRun: true,
      applied: 0,
      salesExamined: sales.length,
      plan: { ...plan, changes: plan.changes.slice(0, 50), changeCount: plan.changes.length },
    });
  }

  // Chunked, outside one giant transaction: this can touch tens of thousands
  // of rows, and a single transaction that size risks a statement timeout that
  // would roll back the whole restatement. Each row is an independent, exact
  // write, so a partial run is safe — re-running finishes the job (already
  // correct rows fall out as `unchanged`).
  const CHUNK = 500;
  let applied = 0;
  for (let i = 0; i < plan.changes.length; i += CHUNK) {
    const slice = plan.changes.slice(i, i + CHUNK);
    await prisma.$transaction(
      slice.map((c) => prisma.sale.update({ where: { id: c.id }, data: { costPrice: c.to } })),
    );
    applied += slice.length;
  }

  res.json({
    dryRun: false,
    applied,
    salesExamined: sales.length,
    plan: { ...plan, changes: plan.changes.slice(0, 50), changeCount: plan.changes.length },
  });
}));

// ============ PRICE TRAIL ============

// Cost history for one SKU, newest first — "what have we paid for this, and
// when did it change?".
router.get('/price-history/:sku', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 24, 100);
  const history = await prisma.priceHistory.findMany({
    where: { sku: req.params.sku },
    include: { supplier: { select: { id: true, name: true } } },
    orderBy: { effectiveFrom: 'desc' },
    take: limit,
  });
  res.json(history);
}));

export default router;
