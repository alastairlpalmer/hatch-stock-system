import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create warehouses
  const warehouse = await prisma.warehouse.create({
    data: {
      name: 'Main Warehouse',
      address: 'Unit 1, Business Park',
    },
  });
  console.log('✓ Created warehouse:', warehouse.name);

  // Create locations
  const locations = await Promise.all([
    prisma.location.create({
      data: {
        name: 'Office Building A - Lobby',
        type: 'vending',
      },
    }),
    prisma.location.create({
      data: {
        name: 'Train Station - Platform 1',
        type: 'vending',
      },
    }),
    prisma.location.create({
      data: {
        name: 'Gym Reception',
        type: 'retail',
      },
    }),
  ]);
  console.log('✓ Created', locations.length, 'locations');

  // Create suppliers
  const suppliers = await Promise.all([
    prisma.supplier.create({
      data: {
        name: 'Costco Wholesale',
        email: 'orders@costco.com',
        phone: '0800 123 4567',
      },
    }),
    prisma.supplier.create({
      data: {
        name: 'Booker Wholesale',
        email: 'trade@booker.co.uk',
        phone: '0800 987 6543',
      },
    }),
  ]);
  console.log('✓ Created', suppliers.length, 'suppliers');

  // Create products
  const products = await Promise.all([
    prisma.product.create({
      data: {
        sku: 'BB-SALTY-001',
        name: 'Barebells Salty Peanut',
        category: 'Snacks',
        unitCost: 1.50,
        salePrice: 2.50,
      },
    }),
    prisma.product.create({
      data: {
        sku: 'BB-CHOC-001',
        name: 'Barebells Chocolate',
        category: 'Snacks',
        unitCost: 1.50,
        salePrice: 2.50,
      },
    }),
    prisma.product.create({
      data: {
        sku: 'FRIVE-TIKKA-001',
        name: 'Frive Chicken Tikka Masala',
        category: 'Meals',
        unitCost: 2.80,
        salePrice: 4.50,
      },
    }),
    prisma.product.create({
      data: {
        sku: 'PRESS-OJ-001',
        name: 'Press Orange Juice',
        category: 'Drinks',
        unitCost: 1.20,
        salePrice: 2.00,
      },
    }),
    prisma.product.create({
      data: {
        sku: 'TONY-MILK-001',
        name: "Tony's Chocolonely Milk",
        category: 'Snacks',
        unitCost: 2.00,
        salePrice: 3.50,
      },
    }),
  ]);
  console.log('✓ Created', products.length, 'products');

  // Add warehouse stock
  for (const product of products) {
    await prisma.warehouseStock.create({
      data: {
        warehouseId: warehouse.id,
        sku: product.sku,
        quantity: Math.floor(Math.random() * 50) + 20,
      },
    });
  }
  console.log('✓ Added warehouse stock');

  // Assign products to locations and add stock
  for (const location of locations) {
    for (const product of products) {
      // Assign product
      await prisma.locationAssignment.create({
        data: {
          locationId: location.id,
          sku: product.sku,
        },
      });

      // Add stock
      await prisma.locationStock.create({
        data: {
          locationId: location.id,
          sku: product.sku,
          quantity: Math.floor(Math.random() * 10) + 2,
        },
      });

      // Add config
      await prisma.locationConfig.create({
        data: {
          locationId: location.id,
          sku: product.sku,
          minStock: 3,
          maxStock: 10,
        },
      });
    }
  }
  console.log('✓ Configured locations');

  // Create a restock route
  await prisma.restockRoute.create({
    data: {
      name: 'Morning Route',
      locationIds: locations.map(l => l.id),
    },
  });
  console.log('✓ Created restock route');

  console.log('\n✅ Database seeded successfully!');
  console.log('\nSummary:');
  console.log('  - 1 Warehouse');
  console.log('  - 3 Locations');
  console.log('  - 2 Suppliers');
  console.log('  - 5 Products');
  console.log('  - 1 Restock Route');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
