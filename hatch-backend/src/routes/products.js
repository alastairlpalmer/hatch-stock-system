import express from 'express';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';

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
  const { sku, name, description, category, unitCost, salePrice, unitsPerBox, barcode, preferredSupplierId } = req.body;

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
    },
  });

  res.status(201).json(product);
}));

// Update product
router.put('/:sku', asyncHandler(async (req, res) => {
  const { name, description, category, unitCost, salePrice, unitsPerBox, barcode, preferredSupplierId } = req.body;

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
        },
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

// Check for SKU conflict
router.get('/check-conflict', asyncHandler(async (req, res) => {
  const { sku, name } = req.query;

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

export default router;
