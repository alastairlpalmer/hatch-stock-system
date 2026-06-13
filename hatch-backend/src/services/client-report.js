import { readFileSync } from 'fs';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import prisma from '../utils/db.js';
import { getDashboard, getDailyTransactions } from './analytics.js';
import { resolveLocationScope } from './location-resolver.js';
import { toClientSafe, assertClientSafe } from './report-whitelist.js';

// Hatch brand palette (from tailwind.config.js) plus a few report-only tints.
const BRAND = {
  green: '#166C53',
  dark: '#004638',
  cream: '#F6F0DC',
  ink: '#1F2937',
  sub: '#6B7280',
  faint: '#9CA3AF',
  line: '#E5E7EB',
  soft: '#EAF1EE', // light green wash for the summary box
  barBg: '#E3ECE8', // unfilled bar track
  coverRule: '#3A5D52',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Brand SVGs are vendored into the backend so the renderer is self-contained on
// Railway (no dependency on the frontend's file layout). Loaded once.
const LOGO_RATIO = 136.55 / 325.07; // height / width of the horizontal wordmark
const ICON_RATIO = 180.78 / 118.74; // height / width of the icon
const LOGO_SVG = readFileSync(new URL('../assets/brand/hatch-horizontal.svg', import.meta.url), 'utf8');
const ICON_SVG = readFileSync(new URL('../assets/brand/hatch-icon.svg', import.meta.url), 'utf8');

// Recolour an SVG (the source art is cream) by inlining a fill on every path.
function recolour(svg, colour) {
  return svg
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/class="cls-1"/g, `fill="${colour}"`)
    .replace(/#f6f0dc/gi, colour);
}

/** Default period: the previous calendar month, [start, endExclusiveDay]. */
export function previousCalendarMonth(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0); // last day of previous month
  return { start, end };
}

function periodLabel(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) {
    return `${MONTHS[s.getMonth()]} ${s.getFullYear()}`;
  }
  return `${MONTHS[s.getMonth()]} ${s.getFullYear()} – ${MONTHS[e.getMonth()]} ${e.getFullYear()}`;
}

/**
 * Build the client-safe report DTO for a request. Reuses the same analytics
 * aggregation as the dashboard (one source of truth) and runs it through the
 * whitelist so no money/margin/waste can reach the PDF.
 */
export async function buildReportData({ startDate, endDate, locationName, routeId, clientName, siteName }) {
  const query = { startDate, endDate, locationName, routeId };
  const [dashboard, daily, scope] = await Promise.all([
    getDashboard(query),
    getDailyTransactions(query),
    resolveLocationScope({ locationNames: locationName, routeId }),
  ]);

  const scopeLabel = scope.isAll
    ? 'All locations'
    : scope.routeName
    ? `Route: ${scope.routeName}`
    : scope.names.join(', ');

  return toClientSafe(dashboard, daily, {
    clientName,
    siteName,
    periodLabel: periodLabel(startDate, endDate),
    periodStart: startDate,
    periodEnd: endDate,
    scopeLabel,
  });
}

// --- PDF rendering -------------------------------------------------------------
//
// A4, three pages: a branded cover, a usage + trend page, and a products +
// category + summary page. Layout is explicit (no auto-flow) so spacing stays
// controlled. Everything drawn comes from the client-safe DTO.

const MARGIN = 50;

const fmtNum = (n) => Number(n || 0).toLocaleString('en-GB');
const fmtHour = (h) => (h == null ? '—' : `${String(h).padStart(2, '0')}:00`);
function fmtDay(iso) {
  const [, m, d] = String(iso).split('-');
  return `${parseInt(d, 10)} ${MONTH_ABBR[parseInt(m, 10) - 1]}`;
}

function coverPage(doc, dto) {
  const W = doc.page.width;
  const H = doc.page.height;
  doc.save().rect(0, 0, W, H).fill(BRAND.dark).restore();
  doc.save().rect(0, 0, W, 6).fill(BRAND.green).restore();

  const logoW = 210;
  const logoH = logoW * LOGO_RATIO;
  SVGtoPDF(doc, recolour(LOGO_SVG, BRAND.cream), (W - logoW) / 2, 150, { width: logoW, height: logoH });

  doc.save().moveTo(W / 2 - 36, 300).lineTo(W / 2 + 36, 300).lineWidth(1).strokeColor(BRAND.coverRule).stroke().restore();

  doc.fillColor(BRAND.cream).font('Helvetica').fontSize(12)
    .text('VENDING PERFORMANCE REPORT', 0, 326, { align: 'center', characterSpacing: 3 });

  doc.fillColor(BRAND.cream).font('Helvetica-Bold').fontSize(26)
    .text(dto.meta.siteName, 70, 362, { align: 'center', width: W - 140 });

  doc.fillColor('#C9D6CF').font('Helvetica').fontSize(13)
    .text(`Prepared for ${dto.meta.clientName}`, 70, doc.y + 10, { align: 'center', width: W - 140 });

  doc.fillColor('#A9BDB4').font('Helvetica').fontSize(13)
    .text(dto.meta.periodLabel, 0, doc.y + 16, { align: 'center' });

  if (dto.meta.scopeLabel) {
    doc.fillColor('#7F988D').fontSize(9).text(dto.meta.scopeLabel, 70, H - 96, { align: 'center', width: W - 140 });
  }
  doc.fillColor('#6F877C').fontSize(8)
    .text('Confidential — prepared for the named client only.', 0, H - 70, { align: 'center' });
}

function pageHeader(doc) {
  const iconH = 20;
  const iconW = iconH / ICON_RATIO;
  SVGtoPDF(doc, recolour(ICON_SVG, BRAND.green), MARGIN, 40, { width: iconW, height: iconH });
  doc.fillColor(BRAND.sub).font('Helvetica').fontSize(8)
    .text('Hatch · Vending Performance Report', MARGIN + iconW + 8, 47);
  doc.save().moveTo(MARGIN, 70).lineTo(doc.page.width - MARGIN, 70).lineWidth(0.5).strokeColor(BRAND.line).stroke().restore();
}

function pageFooter(doc, dto, pageNum, pageCount) {
  const y = doc.page.height - 48;
  doc.save().moveTo(MARGIN, y).lineTo(doc.page.width - MARGIN, y).lineWidth(0.5).strokeColor(BRAND.line).stroke().restore();
  doc.fillColor(BRAND.faint).font('Helvetica').fontSize(8);
  doc.text(dto.meta.periodLabel, MARGIN, y + 7, { width: 260, align: 'left', lineBreak: false });
  doc.text(`Page ${pageNum} of ${pageCount}`, doc.page.width - MARGIN - 120, y + 7, { width: 120, align: 'right' });
}

// Section heading with a short green underline. Returns the y below it.
function heading(doc, text, y) {
  doc.fillColor(BRAND.dark).font('Helvetica-Bold').fontSize(14).text(text, MARGIN, y);
  const by = doc.y + 4;
  doc.save().moveTo(MARGIN, by).lineTo(MARGIN + 34, by).lineWidth(2).strokeColor(BRAND.green).stroke().restore();
  return by + 12;
}

function statCards(doc, cards, y) {
  const W = doc.page.width - MARGIN * 2;
  const gap = 10;
  const cardW = (W - gap * (cards.length - 1)) / cards.length;
  const cardH = 66;
  cards.forEach((c, i) => {
    const x = MARGIN + i * (cardW + gap);
    doc.save().roundedRect(x, y, cardW, cardH, 6).fill('#F7FAF9').restore();
    doc.save().roundedRect(x, y, cardW, cardH, 6).lineWidth(0.5).strokeColor(BRAND.line).stroke().restore();
    doc.fillColor(BRAND.green).font('Helvetica-Bold').fontSize(16).text(c.value, x + 10, y + 13, { width: cardW - 20, lineBreak: false });
    doc.fillColor(BRAND.sub).font('Helvetica').fontSize(7.5).text(c.label.toUpperCase(), x + 10, y + 40, { width: cardW - 18, characterSpacing: 0.4 });
  });
  return y + cardH;
}

function trendChart(doc, daily, x, y, w, h) {
  const data = daily || [];
  const max = Math.max(1, ...data.map((d) => d.transactions));

  // gridlines + y-axis labels at 0 / 50% / 100%
  doc.save().lineWidth(0.5).strokeColor(BRAND.line);
  [0, 0.5, 1].forEach((t) => {
    const gy = y + h - t * h;
    doc.moveTo(x, gy).lineTo(x + w, gy).stroke();
  });
  doc.restore();
  doc.font('Helvetica').fontSize(7).fillColor(BRAND.faint);
  [0, 0.5, 1].forEach((t) => {
    const gy = y + h - t * h;
    doc.text(String(Math.round(max * t)), x - 30, gy - 3.5, { width: 25, align: 'right' });
  });

  if (data.length === 0) {
    doc.fillColor(BRAND.sub).fontSize(9).text('Insufficient data — no transactions in this period.', x, y + h / 2 - 4);
    return y + h;
  }

  const stepX = data.length > 1 ? w / (data.length - 1) : 0;
  const pts = data.map((d, i) => ({ px: x + i * stepX, py: y + h - (d.transactions / max) * h }));

  // area fill under the line
  doc.save();
  doc.moveTo(pts[0].px, y + h);
  pts.forEach((p) => doc.lineTo(p.px, p.py));
  doc.lineTo(pts[pts.length - 1].px, y + h).closePath().fillOpacity(0.1).fill(BRAND.green);
  doc.restore();

  // line
  doc.save().lineWidth(1.5).strokeColor(BRAND.green);
  pts.forEach((p, i) => (i === 0 ? doc.moveTo(p.px, p.py) : doc.lineTo(p.px, p.py)));
  doc.stroke().restore();

  // x-axis date labels (up to 6, evenly spaced)
  const ticks = Math.min(6, data.length);
  doc.font('Helvetica').fontSize(7).fillColor(BRAND.faint);
  for (let k = 0; k < ticks; k++) {
    const idx = ticks === 1 ? 0 : Math.round((k * (data.length - 1)) / (ticks - 1));
    doc.text(fmtDay(data[idx].date), pts[idx].px - 20, y + h + 5, { width: 40, align: 'center' });
  }
  return y + h;
}

function rankedBars(doc, rows, y, { labelW, valueOf, valueLabel, empty }) {
  if (!rows || rows.length === 0) {
    doc.fillColor(BRAND.sub).font('Helvetica').fontSize(9).text(empty, MARGIN, y);
    return y + 16;
  }
  const W = doc.page.width - MARGIN * 2;
  const max = Math.max(1, ...rows.map(valueOf));
  const barX = MARGIN + labelW + 14;
  const valueW = 70;
  const barMax = W - labelW - 14 - valueW - 8;
  let cy = y;
  rows.forEach((r, i) => {
    if (r.rank) {
      doc.fillColor(BRAND.faint).font('Helvetica-Bold').fontSize(9).text(String(i + 1).padStart(2, '0'), MARGIN, cy + 1, { width: 16 });
    }
    doc.fillColor(BRAND.ink).font('Helvetica').fontSize(10)
      .text(r.label, MARGIN + (r.rank ? 22 : 0), cy, { width: labelW - (r.rank ? 22 : 0), lineBreak: false, ellipsis: true });
    doc.save().roundedRect(barX, cy + 2, barMax, 7, 3).fill(BRAND.barBg).restore();
    doc.save().roundedRect(barX, cy + 2, Math.max(2, (valueOf(r) / max) * barMax), 7, 3).fill(BRAND.green).restore();
    doc.fillColor(BRAND.sub).font('Helvetica').fontSize(9)
      .text(valueLabel(r), MARGIN + W - valueW, cy, { width: valueW, align: 'right' });
    cy += 21;
  });
  return cy;
}

function summaryBox(doc, text, y) {
  const W = doc.page.width - MARGIN * 2;
  const innerW = W - 32;
  const boxH = doc.font('Helvetica').fontSize(10).heightOfString(text, { width: innerW, lineGap: 3 }) + 26;
  doc.save().roundedRect(MARGIN, y, W, boxH, 8).fill(BRAND.soft).restore();
  doc.save().roundedRect(MARGIN, y, 4, boxH, 2).fill(BRAND.green).restore();
  doc.fillColor(BRAND.ink).font('Helvetica').fontSize(10).text(text, MARGIN + 18, y + 13, { width: innerW, lineGap: 3 });
  return y + boxH;
}

/**
 * Render the client-safe DTO to a 3-page PDF Buffer. assertClientSafe runs again
 * here as a last gate before anything is drawn.
 */
export function renderReportPdf(dto) {
  return new Promise((resolve, reject) => {
    try {
      assertClientSafe(dto); // last gate before anything is drawn
      const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = doc.page.width - MARGIN * 2;

      // ---------- Page 1: cover ----------
      coverPage(doc, dto);

      // ---------- Page 2: usage + trend ----------
      doc.addPage();
      pageHeader(doc);
      let y = heading(doc, 'Usage overview', 96);
      const u = dto.usage;
      y = statCards(doc, [
        { label: 'Transactions', value: fmtNum(u.transactions) },
        { label: 'Items dispensed', value: fmtNum(u.units) },
        { label: 'Active days', value: String(u.activeDays) },
        { label: 'Busiest day', value: u.busiestDay || '—' },
        { label: 'Busiest time', value: fmtHour(u.busiestHour) },
      ], y + 6);

      y = heading(doc, 'Daily transaction volume', y + 30);
      trendChart(doc, dto.dailyTransactions, MARGIN + 36, y + 10, W - 40, 170);

      // ---------- Page 3: products + categories + summary ----------
      doc.addPage();
      pageHeader(doc);
      let y3 = heading(doc, 'Most popular products', 96);
      y3 = rankedBars(doc, dto.topProducts.map((p) => ({ ...p, rank: true, label: p.name })), y3 + 8, {
        labelW: 250,
        valueOf: (r) => r.units,
        valueLabel: (r) => `${fmtNum(r.units)} units`,
        empty: 'Insufficient data — no sales in this period.',
      });

      y3 = heading(doc, 'Category mix (share of items)', y3 + 20);
      y3 = rankedBars(doc, dto.categoryMix.slice(0, 6).map((c) => ({ label: c.category, units: c.units, share: c.share })), y3 + 8, {
        labelW: 160,
        valueOf: (r) => r.units,
        valueLabel: (r) => `${fmtNum(r.units)} · ${r.share}%`,
        empty: 'Insufficient data — no sales in this period.',
      });

      y3 = heading(doc, 'Summary', y3 + 22);
      summaryBox(doc, dto.summary, y3 + 8);

      // ---------- Footers (skip the cover) ----------
      const range = doc.bufferedPageRange();
      const contentPages = range.count - 1;
      for (let i = 1; i < range.count; i++) {
        doc.switchToPage(i);
        pageFooter(doc, dto, i, contentPages);
      }

      doc.flushPages();
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Generate a report and persist it. Versioning: a regeneration for the same
 * site + period + scope creates a new row with version = previous max + 1, never
 * overwriting. Returns the stored row metadata (without the PDF bytes).
 */
export async function generateAndStoreReport(input) {
  const dto = await buildReportData(input);
  const pdf = await renderReportPdf(dto);

  const scope = await resolveLocationScope({ locationNames: input.locationName, routeId: input.routeId });
  const periodStart = new Date(input.startDate);
  const periodEnd = new Date(input.endDate);

  const prior = await prisma.clientReport.findFirst({
    where: { siteName: input.siteName, periodStart, periodEnd, routeId: input.routeId || null },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (prior?.version || 0) + 1;

  // Slug both parts to ASCII alphanumerics so the filename is always header-safe
  // (the period label can contain an en-dash for multi-month ranges).
  const slug = (s) => String(s || '').normalize('NFKD').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  const fileName = `hatch-report-${slug(input.siteName) || 'site'}-${slug(dto.meta.periodLabel)}-v${version}.pdf`;

  const row = await prisma.clientReport.create({
    data: {
      clientName: input.clientName,
      siteName: input.siteName,
      locationNames: scope.names,
      routeId: input.routeId || null,
      periodStart,
      periodEnd,
      version,
      fileName,
      pdfData: pdf,
      pdfSize: pdf.length,
      generatedBy: input.generatedBy || null,
    },
    select: REPORT_LIST_SELECT,
  });
  return row;
}

// Metadata columns only — never select pdfData in list responses.
export const REPORT_LIST_SELECT = {
  id: true,
  clientName: true,
  siteName: true,
  locationNames: true,
  routeId: true,
  periodStart: true,
  periodEnd: true,
  version: true,
  fileName: true,
  pdfSize: true,
  generatedBy: true,
  generatedAt: true,
};
