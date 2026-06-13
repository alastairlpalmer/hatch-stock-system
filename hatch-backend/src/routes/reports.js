import express from 'express';
import { z } from 'zod';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { generateAndStoreReport, previousCalendarMonth, REPORT_LIST_SELECT } from '../services/client-report.js';

const router = express.Router();

// Client report generator. startDate/endDate default to the previous calendar
// month. locationName (string|array) or routeId scope the report; omit both for
// all locations. The report is strictly client-safe (no revenue/cost/margin/
// waste) — enforced by services/report-whitelist.js.
export const generateReportSchema = z.object({
  clientName: z.string().min(1, 'Client name is required'),
  siteName: z.string().min(1, 'Site name is required'),
  startDate: z.string().min(1).optional(),
  endDate: z.string().min(1).optional(),
  locationName: z.union([z.string(), z.array(z.string())]).optional(),
  routeId: z.string().min(1).optional(),
  generatedBy: z.string().optional(),
});

router.post('/client', asyncHandler(async (req, res) => {
  const input = generateReportSchema.parse(req.body);

  // Default to the previous calendar month (end-of-day inclusive).
  let { startDate, endDate } = input;
  if (!startDate || !endDate) {
    const { start, end } = previousCalendarMonth();
    const endOfDay = new Date(end);
    endOfDay.setHours(23, 59, 59, 999);
    startDate = start.toISOString();
    endDate = endOfDay.toISOString();
  }

  const report = await generateAndStoreReport({ ...input, startDate, endDate });
  res.status(201).json(report);
}));

// Filing system: list generated reports (metadata only — never the PDF bytes),
// newest first.
router.get('/client', asyncHandler(async (req, res) => {
  const reports = await prisma.clientReport.findMany({
    orderBy: { generatedAt: 'desc' },
    take: 200,
    select: REPORT_LIST_SELECT,
  });
  res.json(reports);
}));

// Download a stored report PDF.
router.get('/client/:id/download', asyncHandler(async (req, res) => {
  const report = await prisma.clientReport.findUnique({
    where: { id: req.params.id },
    select: { fileName: true, pdfData: true },
  });
  if (!report) return res.status(404).json({ error: 'Report not found' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${report.fileName}"`);
  res.send(Buffer.from(report.pdfData));
}));

export default router;
