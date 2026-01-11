import express from 'express';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

// Get all restock routes
router.get('/', asyncHandler(async (req, res) => {
  const routes = await prisma.restockRoute.findMany({
    orderBy: { name: 'asc' },
  });
  res.json(routes);
}));

// Get single route
router.get('/:id', asyncHandler(async (req, res) => {
  const route = await prisma.restockRoute.findUnique({
    where: { id: req.params.id },
  });

  if (!route) {
    return res.status(404).json({ error: 'Route not found' });
  }

  // Get location details
  const locationIds = route.locationIds || [];
  const locations = await prisma.location.findMany({
    where: { id: { in: locationIds } },
    select: { id: true, name: true, type: true },
  });

  // Sort by route order
  const orderedLocations = locationIds.map(id => 
    locations.find(l => l.id === id)
  ).filter(Boolean);

  res.json({ ...route, locations: orderedLocations });
}));

// Create route
router.post('/', asyncHandler(async (req, res) => {
  const { name, locationIds } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const route = await prisma.restockRoute.create({
    data: {
      name,
      locationIds: locationIds || [],
    },
  });

  res.status(201).json(route);
}));

// Update route
router.put('/:id', asyncHandler(async (req, res) => {
  const { name, locationIds } = req.body;

  const route = await prisma.restockRoute.update({
    where: { id: req.params.id },
    data: {
      ...(name && { name }),
      ...(locationIds !== undefined && { locationIds }),
    },
  });

  res.json(route);
}));

// Delete route
router.delete('/:id', asyncHandler(async (req, res) => {
  await prisma.restockRoute.delete({
    where: { id: req.params.id },
  });

  res.json({ success: true });
}));

export default router;
