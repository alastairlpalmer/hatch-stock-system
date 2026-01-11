// API Services - Export all services from a single entry point
export { default as api } from './api';
export { productsService } from './products.service';
export { inventoryService } from './inventory.service';
export { ordersService } from './orders.service';
export { locationsService } from './locations.service';
export { salesService } from './sales.service';
export { 
  warehousesService, 
  suppliersService, 
  routesService 
} from './entities.service';

// Re-export for convenience
export * from './products.service';
export * from './inventory.service';
export * from './orders.service';
export * from './locations.service';
export * from './sales.service';
export * from './entities.service';
