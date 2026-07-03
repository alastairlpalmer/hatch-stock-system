import express from 'express';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { guessFreshMeal } from '../services/meal-classifier.js';
import { ensureFreshMealPlaceholders } from '../utils/fresh-meal-placeholders.js';

const router = express.Router();

// Get all products
router.get('/', asyncHandler(async (req, res) => {
  const { search, category } = req.query;

  const where = {};
  
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
    ];
  }
  
  if (category) {
    where.category = category;
  }

  const products = await prisma.product.findMany({
    where,
    orderBy: { name: 'asc' },
  });

  res.json(products);
}));

// Lookup a product by barcode (with SKU fallback).
// Must be declared BEFORE `/:sku` so Express doesn't capture `/lookup` as an SKU.
router.get('/lookup', asyncHandler(async (req, res) => {
  const { barcode } = req.query;

  if (!barcode || typeof barcode !== 'string') {
    return res.status(400).json({ error: 'barcode query param required' });
  }

  // Primary: barcode match
  let product = await prisma.product.findUnique({
    where: { barcode },
    include: {
      warehouseStock: {
        include: { warehouse: { select: { id: true, name: true } } },
      },
      locationStock: {
        include: { location: { select: { id: true, name: true } } },
      },
    },
  });

  if (product) {
    return res.json({ product, matchedBy: 'barcode' });
  }

  // Fallback: SKU match (covers QR codes that encode SKUs and operators
  // pasting raw SKUs into the manual-entry input).
  product = await prisma.product.findUnique({
    where: { sku: barcode },
    include: {
      warehouseStock: {
        include: { warehouse: { select: { id: true, name: true } } },
      },
      locationStock: {
        include: { location: { select: { id: true, name: true } } },
      },
    },
  });

  if (product) {
    return res.json({ product, matchedBy: 'sku' });
  }

  return res.status(404).json({ error: 'No product matches this code' });
}));

// Check for SKU conflict.
// Must also be declared BEFORE `/:sku` for the same reason as `/lookup`.
router.get('/check-conflict', asyncHandler(async (req, res) => {
  const { sku, name } = req.query;

  if (!sku) {
    return res.status(400).json({ error: 'sku query param required' });
  }

  const existing = await prisma.product.findUnique({
    where: { sku },
    select: { sku: true, name: true },
  });

  if (!existing) {
    return res.json({ exists: false, conflict: false });
  }

  const conflict = existing.name.toLowerCase() !== name?.toLowerCase();

  res.json({
    exists: true,
    conflict,
    existingName: existing.name,
  });
}));

// List Frive fresh meals (for the Fresh Meals admin / review queue).
// ?unconfirmed=true returns only meals awaiting human confirmation.
// Must be declared BEFORE `/:sku` so Express doesn't capture `/fresh-meals` as an SKU.
router.get('/fresh-meals', asyncHandler(async (req, res) => {
  const where = { isFreshMeal: true };
  if (req.query.unconfirmed === 'true') where.mealTypeConfirmed = false;

  const products = await prisma.product.findMany({
    where,
    orderBy: { name: 'asc' },
    select: {
      sku: true,
      name: true,
      category: true,
      mealType: true,
      mealTypeConfirmed: true,
      preferredSupplierId: true,
    },
  });
  res.json(products);
}));

// Ensure one ordering placeholder product exists per fresh-meal type and
// return { [mealType]: sku }. Used when a buying list / direct PO carries
// meal-type group lines (the rotating Frive menu means flavour SKUs can't be
// named at order time). Must be declared BEFORE `/:sku`.
router.post('/fresh-meal-placeholders', asyncHandler(async (req, res) => {
  const mealTypes = Array.isArray(req.body?.mealTypes)
    ? req.body.mealTypes.filter((m) => typeof m === 'string' && m.trim())
    : [];
  if (mealTypes.length === 0) {
    return res.status(400).json({ error: 'mealTypes array required' });
  }
  const map = await ensureFreshMealPlaceholders(prisma, mealTypes);
  res.json(map);
}));

// Get single product
router.get('/:sku', asyncHandler(async (req, res) => {
  const product = await prisma.product.findUnique({
    where: { sku: req.params.sku },
    include: {
      warehouseStock: {
        include: { warehouse: { select: { id: true, name: true } } },
      },
      locationStock: {
        include: { location: { select: { id: true, name: true } } },
      },
    },
  });

  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  res.json(product);
}));

// Create product
router.post('/', asyncHandler(async (req, res) => {
  const { sku, name, description, category, unitCost, salePrice, unitsPerBox, barcode, preferredSupplierId, isFreshMeal, mealType, mealTypeConfirmed } = req.body;

  if (!sku || !name) {
    return res.status(400).json({ error: 'SKU and name are required' });
  }

  const product = await prisma.product.create({
    data: {
      sku,
      name,
      description: description || null,
      category: category || null,
      unitCost: unitCost ? parseFloat(unitCost) : null,
      salePrice: salePrice ? parseFloat(salePrice) : null,
      unitsPerBox: unitsPerBox ? parseInt(unitsPerBox) : 1,
      barcode: barcode || null,
      preferredSupplierId: preferredSupplierId || null,
      ...(isFreshMeal !== undefined && { isFreshMeal: !!isFreshMeal }),
      ...(mealType !== undefined && { mealType: mealType || null }),
      ...(mealTypeConfirmed !== undefined && { mealTypeConfirmed: !!mealTypeConfirmed }),
    },
  });

  res.status(201).json(product);
}));

// Update product
router.put('/:sku', asyncHandler(async (req, res) => {
  const { name, description, category, unitCost, salePrice, unitsPerBox, barcode, preferredSupplierId, isFreshMeal, mealType, mealTypeConfirmed } = req.body;

  const product = await prisma.product.update({
    where: { sku: req.params.sku },
    data: {
      ...(name && { name }),
      ...(description !== undefined && { description: description || null }),
      ...(category !== undefined && { category: category || null }),
      ...(unitCost !== undefined && { unitCost: unitCost ? parseFloat(unitCost) : null }),
      ...(salePrice !== undefined && { salePrice: salePrice ? parseFloat(salePrice) : null }),
      ...(unitsPerBox !== undefined && { unitsPerBox: unitsPerBox ? parseInt(unitsPerBox) : 1 }),
      ...(barcode !== undefined && { barcode: barcode || null }),
      ...(preferredSupplierId !== undefined && { preferredSupplierId: preferredSupplierId || null }),
      ...(isFreshMeal !== undefined && { isFreshMeal: !!isFreshMeal }),
      ...(mealType !== undefined && { mealType: mealType || null }),
      ...(mealTypeConfirmed !== undefined && { mealTypeConfirmed: !!mealTypeConfirmed }),
    },
  });

  res.json(product);
}));

// Confirm / override a product's fresh-meal classification. Used by the Fresh
// Meals review queue to accept an auto-guess or correct it.
router.put('/:sku/meal', asyncHandler(async (req, res) => {
  const { isFreshMeal, mealType, mealTypeConfirmed } = req.body;

  const product = await prisma.product.update({
    where: { sku: req.params.sku },
    data: {
      ...(isFreshMeal !== undefined && { isFreshMeal: !!isFreshMeal }),
      ...(mealType !== undefined && { mealType: mealType || null }),
      ...(mealTypeConfirmed !== undefined && { mealTypeConfirmed: !!mealTypeConfirmed }),
    },
  });

  res.json(product);
}));

// Delete product
router.delete('/:sku', asyncHandler(async (req, res) => {
  await prisma.product.delete({
    where: { sku: req.params.sku },
  });

  res.json({ success: true });
}));

// Bulk import products
router.post('/import', asyncHandler(async (req, res) => {
  const { products } = req.body;

  if (!Array.isArray(products)) {
    return res.status(400).json({ error: 'Products array required' });
  }

  const results = { created: 0, updated: 0, errors: [] };

  for (const product of products) {
    try {
      // Auto-classify on first sight if the caller didn't supply a classification
      // (e.g. screenshot import passes its own guess; CSV import does not). Always
      // unconfirmed so a human confirms it in the Fresh Meals review queue.
      const provided = product.isFreshMeal !== undefined || product.mealType !== undefined;
      const guess = provided ? null : guessFreshMeal(product.name);
      const mealFields = {
        isFreshMeal: provided ? !!product.isFreshMeal : guess.isFreshMeal,
        mealType: provided ? (product.mealType || null) : guess.mealType,
        mealTypeConfirmed: !!product.mealTypeConfirmed,
      };

      await prisma.product.upsert({
        where: { sku: product.sku },
        create: {
          sku: product.sku,
          name: product.name,
          description: product.description || null,
          category: product.category || null,
          unitCost: product.unitCost ? parseFloat(product.unitCost) : null,
          salePrice: product.salePrice ? parseFloat(product.salePrice) : null,
          unitsPerBox: product.unitsPerBox ? parseInt(product.unitsPerBox) : 1,
          barcode: product.barcode || null,
          preferredSupplierId: product.preferredSupplierId || null,
          ...mealFields,
        },
        // Don't re-classify existing products on update — a human-confirmed
        // classification must stay sticky. Only the catalog fields refresh.
        update: {
          name: product.name,
          description: product.description || null,
          category: product.category || null,
          unitCost: product.unitCost ? parseFloat(product.unitCost) : null,
          salePrice: product.salePrice ? parseFloat(product.salePrice) : null,
          unitsPerBox: product.unitsPerBox ? parseInt(product.unitsPerBox) : 1,
          barcode: product.barcode || null,
          preferredSupplierId: product.preferredSupplierId || null,
        },
      });
      results.created++;
    } catch (error) {
      results.errors.push({ sku: product.sku, error: error.message });
    }
  }

  res.json(results);
}));

export default router;
