import express from 'express';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { contentDispositionAttachment } from '../utils/http.js';
import { ensureFreshMealPlaceholders } from '../utils/fresh-meal-placeholders.js';

const router = express.Router();

const MS_PER_DAY = 86_400_000;

// Buying-list items are either plain SKU lines or fresh-meal GROUP lines
// ({ isFreshMeal: true, mealType, no sku }). Groups stay at meal-type level
// because the Frive menu rotates weekly — the flavour SKUs that will arrive
// aren't known at ordering time. Everything beyond the identity fields
// (name, supplier, costs, netting figures…) is passed through as display
// metadata.
const itemSchema = z.object({
  sku: z.string().min(1).nullish(),
  isFreshMeal: z.coerce.boolean().optional(),
  mealType: z.string().min(1).nullish(),
  quantity: z.coerce.number().int().min(0),
}).passthrough().refine(
  (i) => (i.sku && i.sku.length > 0) || (i.isFreshMeal === true && i.mealType),
  { message: 'Each item needs a sku, or isFreshMeal:true with a mealType' },
);

const isGroupLine = (i) => !i.sku && i.isFreshMeal === true && !!i.mealType;

const dateString = z.string().refine(
  (v) => !isNaN(Date.parse(v)),
  { message: 'must be a valid date' },
);

// items may be empty: a hand-built list starts blank and gains lines in the
// detail view (create-orders separately rejects lists with no qty>0 lines).
const createSchema = z.object({
  name: z.string().min(1),
  targetDate: dateString.nullish(), // the restock Monday this buy covers
  items: z.array(itemSchema).default([]),
  notes: z.string().nullish(),
  createdBy: z.string().nullish(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  targetDate: dateString.nullable().optional(),
  items: z.array(itemSchema).optional(),
  notes: z.string().nullable().optional(),
  status: z.enum(['draft', 'ordered', 'archived']).optional(),
});

// Group a list's items by supplier for the PDF / share views and PO creation.
// null supplierId forms its own "No supplier" group.
function groupBySupplier(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.supplierId ?? null;
    if (!groups.has(key)) {
      groups.set(key, {
        supplierId: key,
        supplierName: item.supplierName || (key ? 'Unknown supplier' : 'No supplier'),
        items: [],
      });
    }
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
}

const lineTotal = (item) => (item.quantity || 0) * (item.unitCost || 0);
const boxesOf = (item) => {
  if (item.boxes != null) return item.boxes;
  const box = item.unitsPerBox > 0 ? item.unitsPerBox : 1;
  return Math.ceil((item.quantity || 0) / box);
};

// Ordering config for the suppliers referenced by a list's items, keyed by
// supplier id — lets the UI render order-day chips and minimum-order warnings
// without extra round-trips.
async function supplierMetaFor(items) {
  const ids = [...new Set(
    (Array.isArray(items) ? items : []).map((i) => i.supplierId).filter(Boolean)
  )];
  if (ids.length === 0) return {};
  const suppliers = await prisma.supplier.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, orderDays: true, leadTimeDays: true, minOrderValue: true },
  });
  return Object.fromEntries(suppliers.map((s) => [s.id, s]));
}

const WEEKDAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const orderDaysLabel = (orderDays) =>
  Array.isArray(orderDays) && orderDays.length
    ? orderDays.map((d) => WEEKDAY_LABELS[d] || d).join(', ')
    : null;

// List buying lists, newest first
router.get('/', asyncHandler(async (req, res) => {
  const { status } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  const lists = await prisma.buyingList.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  res.json(lists);
}));

// Get single buying list (+ ordering config for its suppliers)
router.get('/:id', asyncHandler(async (req, res) => {
  const list = await prisma.buyingList.findUnique({ where: { id: req.params.id } });
  if (!list) return res.status(404).json({ error: 'Buying list not found' });
  const supplierMeta = await supplierMetaFor(list.items);
  res.json({ ...list, supplierMeta });
}));

// Create buying list (share token comes from the schema's uuid default)
router.post('/', asyncHandler(async (req, res) => {
  const { name, targetDate, items, notes, createdBy } = createSchema.parse(req.body);

  const list = await prisma.buyingList.create({
    data: {
      name,
      targetDate: targetDate ? new Date(targetDate) : null,
      items,
      notes: notes ?? null,
      createdBy: createdBy ?? null,
    },
  });

  res.status(201).json(list);
}));

// Update buying list. Edits stay open while the list is draft or ordered (a
// late tweak after POs went out is the operator's call); archived lists are
// read-only apart from being un-archived via status.
router.put('/:id', asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);

  const existing = await prisma.buyingList.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Buying list not found' });

  const editingContent = data.name !== undefined || data.targetDate !== undefined
    || data.items !== undefined || data.notes !== undefined;
  if (existing.status === 'archived' && editingContent) {
    return res.status(409).json({ error: 'Cannot edit an archived buying list' });
  }

  const list = await prisma.buyingList.update({
    where: { id: existing.id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.targetDate !== undefined && {
        targetDate: data.targetDate ? new Date(data.targetDate) : null,
      }),
      ...(data.items !== undefined && { items: data.items }),
      ...(data.notes !== undefined && { notes: data.notes }),
      ...(data.status !== undefined && { status: data.status }),
    },
  });

  res.json(list);
}));

// Delete buying list
router.delete('/:id', asyncHandler(async (req, res) => {
  await prisma.buyingList.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));

// Turn a draft buying list into purchase orders — ONE pending PO per supplier
// (items with no supplier form their own PO). expectedDate: when the supplier
// has a configured lead time, order date + lead time; otherwise two days
// before the target restock Monday (the Saturday of the weekend delivery).
router.post('/:id/create-orders', asyncHandler(async (req, res) => {
  const list = await prisma.buyingList.findUnique({ where: { id: req.params.id } });
  if (!list) return res.status(404).json({ error: 'Buying list not found' });
  if (list.status !== 'draft') {
    return res.status(409).json({ error: `Buying list is already ${list.status}` });
  }

  const items = (Array.isArray(list.items) ? list.items : [])
    .filter((i) => (i.sku || isGroupLine(i)) && (i.quantity || 0) > 0);
  if (items.length === 0) {
    return res.status(400).json({ error: 'Buying list has no items with quantity > 0' });
  }

  // Fresh-meal group lines order against one placeholder product per meal
  // type (the rotating menu means real flavour SKUs are unknown until the box
  // arrives — receiving allocates them to actual SKUs).
  const groupMealTypes = [...new Set(items.filter(isGroupLine).map((i) => i.mealType))];
  const placeholderSkus = groupMealTypes.length
    ? await ensureFreshMealPlaceholders(prisma, groupMealTypes)
    : {};
  const orderSkuFor = (item) => (isGroupLine(item) ? placeholderSkus[item.mealType] : item.sku);

  const supplierMeta = await supplierMetaFor(items);
  const defaultExpected = list.targetDate
    ? new Date(new Date(list.targetDate).getTime() - 2 * MS_PER_DAY)
    : null;
  const expectedFor = (supplierId) => {
    const lead = supplierId ? supplierMeta[supplierId]?.leadTimeDays : null;
    return lead != null
      ? new Date(Date.now() + lead * MS_PER_DAY)
      : defaultExpected;
  };

  const result = await prisma.$transaction(async (tx) => {
    const orders = [];
    for (const group of groupBySupplier(items)) {
      const totalAmount = group.items.reduce((sum, i) => sum + lineTotal(i), 0);
      const order = await tx.order.create({
        data: {
          supplierId: group.supplierId,
          status: 'pending',
          buyingListId: list.id,
          expectedDate: expectedFor(group.supplierId),
          notes: `From buying list "${list.name}"`,
          totalAmount,
          items: {
            create: group.items.map((i) => ({
              sku: orderSkuFor(i),
              quantity: i.quantity,
              unitPrice: i.unitCost ?? null,
            })),
          },
        },
        include: {
          supplier: { select: { id: true, name: true } },
          items: { include: { product: { select: { name: true } } } },
        },
      });
      orders.push(order);
    }

    const buyingList = await tx.buyingList.update({
      where: { id: list.id },
      data: { status: 'ordered', orderIds: orders.map((o) => o.id) },
    });

    return { orders, buyingList };
  });

  res.status(201).json(result);
}));

// ============ PDF ============

// Brand palette — mirrors services/client-report.js.
const BRAND = {
  green: '#166C53',
  dark: '#004638',
  ink: '#1F2937',
  sub: '#6B7280',
  faint: '#9CA3AF',
  line: '#E5E7EB',
  soft: '#EAF1EE',
};
const MARGIN = 50;

const money = (n) => `£${Number(n || 0).toFixed(2)}`;
const fmtDate = (d) =>
  new Date(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

// Table columns: Product, SKU, Boxes, Units, Unit £, Line £ (widths sum to the
// printable width of an A4 page with 50pt margins).
const COLS = [
  { key: 'name', label: 'Product', w: 195, align: 'left' },
  { key: 'sku', label: 'SKU', w: 90, align: 'left' },
  { key: 'boxes', label: 'Boxes', w: 45, align: 'right' },
  { key: 'units', label: 'Units', w: 45, align: 'right' },
  { key: 'unitCost', label: 'Unit £', w: 55, align: 'right' },
  { key: 'lineTotal', label: 'Line £', w: 65, align: 'right' },
];

function ellipsize(doc, text, maxWidth, font = 'Helvetica', size = 9) {
  doc.font(font).fontSize(size);
  let t = String(text ?? '');
  if (doc.widthOfString(t) <= maxWidth) return t;
  while (t.length > 1 && doc.widthOfString(`${t}…`) > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Render a buying list to a one-or-more-page A4 PDF Buffer. */
export function renderBuyingListPdf(list, supplierMeta = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = doc.page.width - MARGIN * 2;
      const bottom = () => doc.page.height - MARGIN - 20;
      let y = MARGIN;

      const ensureRoom = (needed) => {
        if (y + needed > bottom()) {
          doc.addPage();
          y = MARGIN;
        }
      };

      // ---- Title block ----
      doc.save().rect(0, 0, doc.page.width, 6).fill(BRAND.green).restore();
      doc.fillColor(BRAND.dark).font('Helvetica-Bold').fontSize(20).text(list.name, MARGIN, y + 14, { width: W });
      y = doc.y + 4;
      doc.fillColor(BRAND.sub).font('Helvetica').fontSize(10).text(
        list.targetDate
          ? `Target restock date: ${fmtDate(list.targetDate)}`
          : 'No target restock date set',
        MARGIN, y, { width: W },
      );
      y = doc.y + 2;
      doc.fillColor(BRAND.faint).fontSize(8)
        .text(`Status: ${list.status} · Generated ${fmtDate(new Date())}`, MARGIN, y, { width: W });
      y = doc.y + 6;
      if (list.notes) {
        doc.fillColor(BRAND.ink).font('Helvetica-Oblique').fontSize(9).text(list.notes, MARGIN, y, { width: W });
        y = doc.y + 6;
      }
      doc.save().moveTo(MARGIN, y).lineTo(MARGIN + W, y).lineWidth(0.5).strokeColor(BRAND.line).stroke().restore();
      y += 14;

      const items = (Array.isArray(list.items) ? list.items : []).filter((i) => (i.quantity || 0) > 0);
      const groups = groupBySupplier(items);
      let grandTotal = 0;
      let grandUnits = 0;

      const drawHeaderRow = () => {
        let x = MARGIN;
        doc.font('Helvetica-Bold').fontSize(8).fillColor(BRAND.sub);
        for (const col of COLS) {
          doc.text(col.label.toUpperCase(), x, y, { width: col.w - 6, align: col.align, lineBreak: false });
          x += col.w;
        }
        y += 13;
        doc.save().moveTo(MARGIN, y - 3).lineTo(MARGIN + W, y - 3).lineWidth(0.5).strokeColor(BRAND.line).stroke().restore();
      };

      for (const group of groups) {
        ensureRoom(60);

        // Supplier section heading with a short green underline
        doc.fillColor(BRAND.dark).font('Helvetica-Bold').fontSize(13).text(group.supplierName, MARGIN, y);
        y = doc.y + 3;
        doc.save().moveTo(MARGIN, y).lineTo(MARGIN + 34, y).lineWidth(2).strokeColor(BRAND.green).stroke().restore();
        y += 10;

        // Ordering config line: order days + lead time (when configured).
        const meta = group.supplierId ? supplierMeta[group.supplierId] : null;
        const metaParts = [];
        const days = meta && orderDaysLabel(meta.orderDays);
        if (days) metaParts.push(`Orders: ${days}`);
        if (meta?.leadTimeDays != null) metaParts.push(`Lead time: ${meta.leadTimeDays} day${meta.leadTimeDays === 1 ? '' : 's'}`);
        if (metaParts.length) {
          doc.fillColor(BRAND.sub).font('Helvetica').fontSize(8).text(metaParts.join('   ·   '), MARGIN, y);
          y = doc.y + 6;
        }

        drawHeaderRow();

        let subtotal = 0;
        for (const item of group.items) {
          ensureRoom(16);
          const total = lineTotal(item);
          subtotal += total;
          grandUnits += item.quantity || 0;
          const cells = {
            name: ellipsize(doc, item.name || item.sku || `${item.mealType} — fresh meals`, COLS[0].w - 10),
            sku: ellipsize(doc, item.sku || 'rotating menu', COLS[1].w - 10),
            boxes: String(boxesOf(item)),
            units: String(item.quantity || 0),
            unitCost: item.unitCost != null ? money(item.unitCost) : '—',
            lineTotal: money(total),
          };
          let x = MARGIN;
          doc.font('Helvetica').fontSize(9).fillColor(BRAND.ink);
          for (const col of COLS) {
            doc.text(cells[col.key], x, y, { width: col.w - 6, align: col.align, lineBreak: false });
            x += col.w;
          }
          y += 15;
        }
        grandTotal += subtotal;

        ensureRoom(20);
        doc.save().moveTo(MARGIN, y).lineTo(MARGIN + W, y).lineWidth(0.5).strokeColor(BRAND.line).stroke().restore();
        doc.font('Helvetica-Bold').fontSize(9).fillColor(BRAND.dark)
          .text(`${group.supplierName} total: ${money(subtotal)}`, MARGIN, y + 5, { width: W, align: 'right' });
        y += 20;

        // Minimum-order shortfall warning ("!" — the Helvetica core font has
        // no ⚠ glyph).
        if (meta?.minOrderValue != null && subtotal < meta.minOrderValue) {
          ensureRoom(14);
          doc.font('Helvetica-Bold').fontSize(8).fillColor('#B45309').text(
            `! ${money(meta.minOrderValue - subtotal)} below the ${money(meta.minOrderValue)} minimum order`,
            MARGIN, y, { width: W, align: 'right' },
          );
          y = doc.y + 8;
        } else {
          y += 6;
        }
      }

      // ---- Grand total ----
      ensureRoom(40);
      const boxH = 30;
      doc.save().roundedRect(MARGIN, y, W, boxH, 6).fill(BRAND.soft).restore();
      doc.save().roundedRect(MARGIN, y, 4, boxH, 2).fill(BRAND.green).restore();
      doc.fillColor(BRAND.dark).font('Helvetica-Bold').fontSize(11)
        .text(`Grand total: ${money(grandTotal)}`, MARGIN + 16, y + 9, { width: W - 32, lineBreak: false });
      doc.fillColor(BRAND.sub).font('Helvetica').fontSize(9)
        .text(`${grandUnits.toLocaleString('en-GB')} units across ${groups.length} supplier${groups.length === 1 ? '' : 's'}`,
          MARGIN + 16, y + 10, { width: W - 32, align: 'right', lineBreak: false });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// Server-rendered PDF of the buying list, grouped by supplier.
router.get('/:id/pdf', asyncHandler(async (req, res) => {
  const list = await prisma.buyingList.findUnique({ where: { id: req.params.id } });
  if (!list) return res.status(404).json({ error: 'Buying list not found' });

  const supplierMeta = await supplierMetaFor(list.items);
  const pdf = await renderBuyingListPdf(list, supplierMeta);
  const slug = (s) => String(s || '').normalize('NFKD').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  const fileName = `buying-list-${slug(list.name) || list.id}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', contentDispositionAttachment(fileName));
  res.send(pdf);
}));

// ============ PUBLIC SHARE VIEW ============

// Read-only supplier-grouped view of a buying list by its share token. Mounted
// at /api/public/buying-lists — BEFORE the auth gate (see index.js), mirroring
// the VendLive webhook exemption: the unguessable uuid token IS the credential.
// Deliberately excludes internal fields (ids, netting workings, per-location
// breakdowns).
export const publicBuyingListsRouter = express.Router();

publicBuyingListsRouter.get('/:token', asyncHandler(async (req, res) => {
  const list = await prisma.buyingList.findUnique({
    where: { shareToken: req.params.token },
  });
  if (!list) return res.status(404).json({ error: 'Not found' });

  const items = (Array.isArray(list.items) ? list.items : []).filter((i) => (i.quantity || 0) > 0);
  let total = 0;
  const suppliers = groupBySupplier(items).map((group) => {
    const subtotal = group.items.reduce((sum, i) => sum + lineTotal(i), 0);
    total += subtotal;
    return {
      supplierName: group.supplierName,
      items: group.items.map((i) => ({
        name: i.name || i.sku || `${i.mealType} — fresh meals`,
        sku: i.sku || null,
        mealType: i.mealType ?? null,
        isFreshMeal: i.isFreshMeal === true,
        quantity: i.quantity,
        boxes: boxesOf(i),
        unitsPerBox: i.unitsPerBox ?? 1,
        unitCost: i.unitCost ?? null,
      })),
      subtotal: Math.round(subtotal * 100) / 100,
    };
  });

  res.json({
    name: list.name,
    status: list.status,
    targetDate: list.targetDate,
    notes: list.notes,
    createdAt: list.createdAt,
    suppliers,
    total: Math.round(total * 100) / 100,
  });
}));

export default router;
