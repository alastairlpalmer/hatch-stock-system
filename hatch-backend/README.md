# Hatch Stock Management - Backend API

Express.js + Prisma backend connected to your Supabase database.

## 🚀 Quick Start (Your Setup)

Your database is already configured! Just follow these steps:

### Step 1: Install Dependencies

```bash
cd hatch-backend
npm install
```

### Step 2: Generate Prisma Client

```bash
npm run db:generate
```

### Step 3: Create Database Tables

```bash
npm run db:push
```

You should see output like:
```
🚀 Your database is now in sync with your Prisma schema.
```

### Step 4: (Optional) Add Sample Data

```bash
npm run db:seed
```

### Step 5: Start the Server

```bash
npm run dev
```

You should see:
```
╔═══════════════════════════════════════════════════════════╗
║   🚀 Hatch Stock Management API                          ║
║   Server running on: http://localhost:8000               ║
╚═══════════════════════════════════════════════════════════╝
```

### Step 6: Test It Works

Open a new terminal and run:
```bash
curl http://localhost:8000/health
```

Should return: `{"status":"ok","timestamp":"..."}`

---

## 🔗 Your Database Details

- **Project**: Stock_tracker
- **Project ID**: tujgcuzqazxixaxrdpws
- **Host**: db.tujgcuzqazxixaxrdpws.supabase.co
- **Database**: postgres

The connection is pre-configured in `.env`

---

## 📋 Common Commands

```bash
# Start development server (with hot reload)
npm run dev

# Start production server
npm start

# View database in browser (Prisma Studio)
npm run db:studio

# Reset database (⚠️ deletes all data)
npx prisma db push --force-reset

# Re-seed with sample data
npm run db:seed
```

---

## 🔍 Verify Database Connection

You can check your tables in Supabase:
1. Go to https://supabase.com/dashboard/project/tujgcuzqazxixaxrdpws
2. Click "Table Editor" in the left sidebar
3. You should see tables like: products, warehouses, locations, etc.

---

## 📁 Project Structure

```
hatch-backend/
├── prisma/
│   └── schema.prisma      # Database schema
├── src/
│   ├── routes/            # API route handlers
│   │   ├── auth.js
│   │   ├── products.js
│   │   ├── warehouses.js
│   │   ├── locations.js
│   │   ├── inventory.js
│   │   ├── orders.js
│   │   ├── suppliers.js
│   │   ├── routes.js
│   │   └── sales.js
│   ├── middleware/
│   │   ├── auth.js        # JWT authentication
│   │   └── errorHandler.js
│   ├── utils/
│   │   └── db.js          # Prisma client
│   └── index.js           # Express app
├── .env.example
├── package.json
└── README.md
```

---

## 🔌 API Endpoints

### Products
```
GET    /api/products              # List all products
GET    /api/products/:sku         # Get product by SKU
POST   /api/products              # Create product
PUT    /api/products/:sku         # Update product
DELETE /api/products/:sku         # Delete product
POST   /api/products/import       # Bulk import
GET    /api/products/check-conflict # Check SKU conflict
```

### Warehouses
```
GET    /api/warehouses            # List warehouses
GET    /api/warehouses/:id        # Get warehouse
GET    /api/warehouses/:id/with-stock # Get with stock levels
POST   /api/warehouses            # Create warehouse
PUT    /api/warehouses/:id        # Update warehouse
DELETE /api/warehouses/:id        # Delete warehouse
```

### Locations
```
GET    /api/locations             # List locations
GET    /api/locations/:id         # Get location
GET    /api/locations/:id/with-stock # Get with stock & config
POST   /api/locations             # Create location
PUT    /api/locations/:id         # Update location
PUT    /api/locations/:id/assigned-items # Update assigned products
DELETE /api/locations/:id         # Delete location
```

### Inventory
```
GET    /api/inventory/warehouse   # Get warehouse stock
POST   /api/inventory/warehouse/update # Update warehouse stock
POST   /api/inventory/warehouse/bulk   # Bulk update

GET    /api/inventory/locations/:id        # Get location stock
POST   /api/inventory/locations/:id/update # Update location stock
POST   /api/inventory/locations/:id/set    # Set all location stock
GET    /api/inventory/locations/:id/config # Get thresholds
PUT    /api/inventory/locations/:id/config/:sku # Update thresholds

GET    /api/inventory/batches           # Get batches
GET    /api/inventory/batches/expiring  # Get expiry alerts
POST   /api/inventory/batches           # Create batch
PUT    /api/inventory/batches/:id       # Update batch

POST   /api/inventory/removals          # Record stock removal
GET    /api/inventory/removals          # Get removal history

POST   /api/inventory/stock-checks      # Submit stock check
GET    /api/inventory/locations/:id/stock-check-history

POST   /api/inventory/restocks          # Record restock
GET    /api/inventory/locations/:id/restock-history
```

### Orders
```
GET    /api/orders                # List orders
GET    /api/orders/:id            # Get order
POST   /api/orders                # Create order
PUT    /api/orders/:id            # Update order
DELETE /api/orders/:id            # Delete order
POST   /api/orders/:id/receive    # Receive order
GET    /api/orders/suggestions    # Get reorder suggestions
```

### Suppliers
```
GET    /api/suppliers             # List suppliers
GET    /api/suppliers/:id         # Get supplier
POST   /api/suppliers             # Create supplier
PUT    /api/suppliers/:id         # Update supplier
DELETE /api/suppliers/:id         # Delete supplier
GET    /api/suppliers/:id/orders  # Get supplier's orders
```

### Restock Routes
```
GET    /api/routes                # List routes
GET    /api/routes/:id            # Get route with locations
POST   /api/routes                # Create route
PUT    /api/routes/:id            # Update route
DELETE /api/routes/:id            # Delete route
```

### Sales
```
GET    /api/sales                 # Get sales data
POST   /api/sales/import          # Import from CSV
GET    /api/sales/analytics       # Get summary analytics
GET    /api/sales/daily           # Daily breakdown
GET    /api/sales/by-product      # By product
GET    /api/sales/by-category     # By category
GET    /api/sales/imports         # Import history
```

### Auth (Optional)
```
POST   /api/auth/register         # Register user
POST   /api/auth/login            # Login
GET    /api/auth/me               # Get current user
```

---

## 🔧 Database Management

```bash
# View database in browser
npm run db:studio

# Reset database (⚠️ deletes all data)
npx prisma db push --force-reset

# Create migration
npm run db:migrate

# Seed database with sample data
npm run db:seed
```

---

## 🚢 Deployment

### Railway (Easiest)

1. Push code to GitHub
2. Go to [railway.app](https://railway.app)
3. New Project → Deploy from GitHub repo
4. Add PostgreSQL database
5. Railway auto-detects and deploys

### Render

1. Push to GitHub
2. Go to [render.com](https://render.com)
3. New Web Service → Connect repo
4. Add PostgreSQL database
5. Set environment variables

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npx prisma generate
EXPOSE 8000
CMD ["node", "src/index.js"]
```

```bash
docker build -t hatch-backend .
docker run -p 8000:8000 --env-file .env hatch-backend
```

---

## 🔐 Authentication

Authentication is **disabled by default** for easy development.

To enable:

1. Set `AUTH_ENABLED=true` in `.env`
2. Set a secure `JWT_SECRET`
3. Register a user via `POST /api/auth/register`
4. Login to get token via `POST /api/auth/login`
5. Include token in requests: `Authorization: Bearer <token>`

---

## 🔗 Connect Frontend

Update the frontend `.env`:

```bash
VITE_API_URL=http://localhost:8000/api
```

For production:
```bash
VITE_API_URL=https://your-backend.railway.app/api
```

---

## 🧪 Testing

```bash
# Health check
curl http://localhost:8000/health

# Create warehouse
curl -X POST http://localhost:8000/api/warehouses \
  -H "Content-Type: application/json" \
  -d '{"name": "Main Warehouse"}'

# Create product
curl -X POST http://localhost:8000/api/products \
  -H "Content-Type: application/json" \
  -d '{"sku": "TEST-001", "name": "Test Product", "category": "Snacks"}'
```

---

## 📝 Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `PORT` | No | 8000 | Server port |
| `NODE_ENV` | No | development | Environment |
| `FRONTEND_URL` | No | http://localhost:3000 | CORS origin |
| `AUTH_ENABLED` | No | false | Enable JWT auth |
| `JWT_SECRET` | If auth | - | JWT signing secret |

---

## 🆘 Troubleshooting

**"Can't reach database server"**
- Check DATABASE_URL is correct
- Check database is running
- For Supabase: ensure password is correct

**"Prisma Client not generated"**
```bash
npm run db:generate
```

**"Table doesn't exist"**
```bash
npm run db:push
```

**CORS errors**
- Check FRONTEND_URL in .env matches your frontend

---

## 📄 License

MIT
