import PDFDocument from 'pdfkit';
import prisma from '../utils/db.js';
import { getDashboard, getDailyTransactions } from './analytics.js';
import { resolveLocationScope } from './location-resolver.js';
import { toClientSafe, assertClientSafe } from './report-whitelist.js';

// Hatch brand palette (from tailwind.config.js).
const BRAND = { green: '#166C53', dark: '#004638', cream: '#F6F0DC', ink: '#1f2937', muted: '#6b7280', line: '#e5e7eb' };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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

function drawTrendChart(doc, daily, x, y, w, h) {
  const max = Math.max(1, ...daily.map((d) => d.transactions));
  // axes
  doc.save().lineWidth(0.5).strokeColor(BRAND.line);
  doc.moveTo(x, y + h).lineTo(x + w, y + h).stroke(); // x-axis
  doc.restore();

  if (daily.length === 0) {
    doc.fillColor(BRAND.muted).fontSize(9).text('No transactions in this period.', x, y + h / 2);
    return;
  }

  const barGap = 2;
  const barW = Math.max(1, (w - barGap * (daily.length - 1)) / daily.length);
  daily.forEach((d, i) => {
    const bh = (d.transactions / max) * h;
    const bx = x + i * (barW + barGap);
    doc.save().fillColor(BRAND.green).rect(bx, y + h - bh, barW, bh).fill().restore();
  });

  // y max label + first/last date labels
  doc.fillColor(BRAND.muted).fontSize(7);
  doc.text(String(max), x - 18, y - 2, { width: 16, align: 'right' });
  doc.text(daily[0].date.slice(5), x, y + h + 3, { width: 40, align: 'left' });
  doc.text(daily[daily.length - 1].date.slice(5), x + w - 40, y + h + 3, { width: 40, align: 'right' });
}

function sectionTitle(doc, text) {
  doc.moveDown(0.8);
  doc.fillColor(BRAND.dark).fontSize(12).font('Helvetica-Bold').text(text);
  doc.moveDown(0.3);
  doc.font('Helvetica');
}

/**
 * Render the client-safe DTO to a PDF Buffer (2–3 pages). assertClientSafe runs
 * again here as a last gate before anything is drawn.
 */
export function renderReportPdf(dto) {
  return new Promise((resolve, reject) => {
    try {
      assertClientSafe(dto); // last gate before anything is drawn
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageW = doc.page.width - 100; // content width within margins
      const left = 50;

      // ---- Cover band ----
      doc.save().rect(0, 0, doc.page.width, 150).fill(BRAND.dark).restore();
      doc.fillColor(BRAND.cream).fontSize(26).font('Helvetica-Bold').text('Hatch', left, 45);
      doc.fillColor(BRAND.cream).fontSize(11).font('Helvetica').text('Vending performance report', left, 80);
      doc.fillColor('#9fb8af').fontSize(10).text(dto.meta.periodLabel, left, 100);

      doc.moveDown(6);
      doc.fillColor(BRAND.ink).fontSize(20).font('Helvetica-Bold').text(dto.meta.siteName, left, 175);
      doc.fillColor(BRAND.muted).fontSize(11).font('Helvetica').text(`Prepared for ${dto.meta.clientName}`);
      if (dto.meta.scopeLabel) doc.fillColor(BRAND.muted).fontSize(9).text(dto.meta.scopeLabel);

      // ---- Headline usage stats ----
      sectionTitle(doc, 'Usage at a glance');
      const stats = [
        ['Transactions', dto.usage.transactions.toLocaleString('en-GB')],
        ['Items dispensed', dto.usage.units.toLocaleString('en-GB')],
        ['Active days', String(dto.usage.activeDays)],
        ['Busiest day', dto.usage.busiestDay || '—'],
        ['Busiest time', dto.usage.busiestHour != null ? `${String(dto.usage.busiestHour).padStart(2, '0')}:00` : '—'],
      ];
      const colW = pageW / stats.length;
      let yStat = doc.y;
      stats.forEach((s, i) => {
        const cx = left + i * colW;
        doc.fillColor(BRAND.green).fontSize(16).font('Helvetica-Bold').text(s[1], cx, yStat, { width: colW - 6 });
        doc.fillColor(BRAND.muted).fontSize(8).font('Helvetica').text(s[0], cx, yStat + 22, { width: colW - 6 });
      });
      doc.y = yStat + 44;

      // ---- Transaction trend ----
      sectionTitle(doc, 'Daily transaction volume');
      drawTrendChart(doc, dto.dailyTransactions, left + 20, doc.y, pageW - 20, 120);
      doc.y += 140;

      // ---- Top products ----
      sectionTitle(doc, 'Most popular products');
      const maxUnits = Math.max(1, ...dto.topProducts.map((p) => p.units));
      dto.topProducts.forEach((p) => {
        const rowY = doc.y;
        doc.fillColor(BRAND.ink).fontSize(10).text(p.name, left, rowY, { width: 220 });
        const barX = left + 230;
        const barMaxW = pageW - 230 - 60;
        doc.save().fillColor('#d7e3de').rect(barX, rowY + 2, barMaxW, 8).fill().restore();
        doc.save().fillColor(BRAND.green).rect(barX, rowY + 2, (p.units / maxUnits) * barMaxW, 8).fill().restore();
        doc.fillColor(BRAND.muted).fontSize(9).text(`${p.units.toLocaleString('en-GB')} units`, left + pageW - 55, rowY, { width: 55, align: 'right' });
        doc.y = rowY + 16;
      });

      // ---- Category mix ----
      sectionTitle(doc, 'Category mix (share of items)');
      dto.categoryMix.forEach((c) => {
        const rowY = doc.y;
        doc.fillColor(BRAND.ink).fontSize(10).text(c.category, left, rowY, { width: 160 });
        const barX = left + 170;
        const barMaxW = pageW - 170 - 70;
        doc.save().fillColor('#d7e3de').rect(barX, rowY + 2, barMaxW, 8).fill().restore();
        doc.save().fillColor(BRAND.green).rect(barX, rowY + 2, (c.share / 100) * barMaxW, 8).fill().restore();
        doc.fillColor(BRAND.muted).fontSize(9).text(`${c.units.toLocaleString('en-GB')} · ${c.share}%`, left + pageW - 65, rowY, { width: 65, align: 'right' });
        doc.y = rowY + 16;
      });

      // ---- Summary ----
      sectionTitle(doc, 'Summary');
      doc.fillColor(BRAND.ink).fontSize(10).font('Helvetica').text(dto.summary, { width: pageW, align: 'left', lineGap: 2 });

      // ---- Footer ----
      doc.fillColor(BRAND.muted).fontSize(8).text(
        `Generated by Hatch · ${dto.meta.periodLabel} · figures reflect dispensed items and transaction counts only.`,
        left, doc.page.height - 60, { width: pageW, align: 'center' },
      );

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

  const safeSite = (input.siteName || 'site').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  const fileName = `hatch-report-${safeSite}-${dto.meta.periodLabel.replace(/\s+/g, '-')}-v${version}.pdf`;

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
