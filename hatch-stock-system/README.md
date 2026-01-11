# Hatch Stock Management System

A comprehensive inventory management system for tracking stock across warehouses, vending locations, and sales channels.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- npm or yarn
- (Optional) Backend server for data persistence

### Installation

```bash
# Clone or extract the project
cd hatch-stock-system

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Start development server
npm run dev
```

The app will be available at `http://localhost:3000`

---

## 📁 Project Structure

```
hatch-stock-system/
├── public/                  # Static assets
├── src/
│   ├── components/
│   │   ├── layout/         # Sidebar, Header
│   │   ├── pages/          # Page components (Dashboard, Orders, etc.)
│   │   └── ui/             # Reusable UI components
│   ├── context/
│   │   └── StockContext.jsx  # Global state management
│   ├── hooks/              # Custom React hooks
│   ├── services/           # API service layer
│   │   ├── api.js          # Axios instance & config
│   │   ├── products.service.js
│   │   ├── inventory.service.js
│   │   ├── orders.service.js
│   │   └── ...
│   ├── utils/
│   │   └── helpers.js      # Utility functions
│   ├── styles/
│   │   └── index.css       # Tailwind & global styles
│   ├── App.jsx             # Main app component
│   ├── main.jsx            # Entry point
│   └── FULL_APP.jsx        # Complete single-file version (reference)
├── .env.example            # Environment template
├── package.json
├── vite.config.js
├── tailwind.config.js
└── README.md
```

---

## 🔧 Configuration

### Environment Variables

Create a `.env` file in the root directory:

```env
# API Configuration
VITE_API_URL=http://localhost:8000/api

# Feature Flags
VITE_ENABLE_SALES_IMPORT=true
VITE_ENABLE_AI_INVOICE=true
VITE_ENABLE_AI_SCREENSHOT=true

# Debug
VITE_DEBUG_MODE=true
```

---

## 🔌 Backend Integration

The frontend is designed to work with or without a backend. When no backend is available, it falls back to localStorage.

### API Endpoints Required

Your backend should implement these REST endpoints:

#### Products
```
GET    /api/products              # List all products
GET    /api/products/:sku         # Get product by SKU
POST   /api/products              # Create product
PUT    /api/products/:sku         # Update product
DELETE /api/products/:sku         # Delete product
POST   /api/products/import       # Bulk import from CSV
```

#### Inventory
```
GET    /api/inventory/warehouse                    # Get all warehouse stock
GET    /api/inventory/warehouse/:id                # Get warehouse stock
POST   /api/inventory/warehouse/update             # Update stock level
POST   /api/inventory/warehouse/bulk               # Bulk update from CSV

GET    /api/inventory/locations/:id                # Get location stock
POST   /api/inventory/locations/:id/update         # Update location stock
GET    /api/inventory/locations/:id/config         # Get thresholds
PUT    /api/inventory/locations/:id/config/:sku    # Update thresholds

GET    /api/inventory/batches                      # Get all batches
POST   /api/inventory/batches                      # Create batch
PUT    /api/inventory/batches/:id                  # Update batch
GET    /api/inventory/batches/expiring             # Get expiry alerts
```

#### Orders
```
GET    /api/orders                    # List orders
GET    /api/orders/:id                # Get order
POST   /api/orders                    # Create order
PUT    /api/orders/:id                # Update order
DELETE /api/orders/:id                # Delete/cancel order
POST   /api/orders/:id/receive        # Receive order
GET    /api/orders/suggestions        # Generate order suggestions
GET    /api/orders/:id/pdf            # Generate PDF
POST   /api/orders/analyze-invoice    # AI invoice analysis
```

#### Entities
```
GET/POST/PUT/DELETE  /api/warehouses
GET/POST/PUT/DELETE  /api/locations
GET/POST/PUT/DELETE  /api/suppliers
GET/POST/PUT/DELETE  /api/routes
```

#### Sales
```
GET    /api/sales                 # Get sales data
POST   /api/sales/import          # Import from CSV
GET    /api/sales/analytics       # Get analytics
GET    /api/sales/daily           # Daily breakdown
GET    /api/sales/by-product      # By product
```

### Example Backend Implementation (Node.js/Express)

```javascript
// server.js
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Products routes
app.get('/api/products', async (req, res) => {
  const products = await db.products.findAll();
  res.json(products);
});

app.post('/api/products', async (req, res) => {
  const product = await db.products.create(req.body);
  res.json(product);
});

// ... implement other routes

app.listen(8000, () => {
  console.log('Backend running on port 8000');
});
```

### Database Schema Suggestion

```sql
-- Products
CREATE TABLE products (
  sku VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50),
  unit_cost DECIMAL(10,2),
  sale_price DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Warehouses
CREATE TABLE warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Warehouse Stock
CREATE TABLE warehouse_stock (
  warehouse_id UUID REFERENCES warehouses(id),
  sku VARCHAR(50) REFERENCES products(sku),
  quantity INTEGER DEFAULT 0,
  PRIMARY KEY (warehouse_id, sku)
);

-- Locations
CREATE TABLE locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50), -- 'vending', 'retail', 'storage'
  created_at TIMESTAMP DEFAULT NOW()
);

-- Location Stock
CREATE TABLE location_stock (
  location_id UUID REFERENCES locations(id),
  sku VARCHAR(50) REFERENCES products(sku),
  quantity INTEGER DEFAULT 0,
  min_stock INTEGER,
  max_stock INTEGER,
  PRIMARY KEY (location_id, sku)
);

-- Stock Batches (for expiry tracking)
CREATE TABLE stock_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID REFERENCES warehouses(id),
  sku VARCHAR(50) REFERENCES products(sku),
  quantity INTEGER NOT NULL,
  remaining_qty INTEGER NOT NULL,
  expiry_date DATE,
  has_damage BOOLEAN DEFAULT FALSE,
  damage_notes TEXT,
  received_at TIMESTAMP DEFAULT NOW()
);

-- Orders
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES suppliers(id),
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'received'
  delivery_method VARCHAR(50),
  notes TEXT,
  total_amount DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT NOW(),
  received_at TIMESTAMP
);

-- Order Items
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id),
  sku VARCHAR(50) REFERENCES products(sku),
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(10,2)
);

-- Sales Transactions
CREATE TABLE sales (
  id VARCHAR(50) PRIMARY KEY, -- Transaction ID from source
  sku VARCHAR(50) REFERENCES products(sku),
  quantity INTEGER DEFAULT 1,
  charged DECIMAL(10,2),
  cost_price DECIMAL(10,2),
  timestamp TIMESTAMP,
  location_id UUID REFERENCES locations(id),
  payment_method VARCHAR(50)
);
```

---

## 🎨 Extracting Components

The `src/FULL_APP.jsx` file contains the complete working application in a single file. To modularize:

1. **Find the component** in FULL_APP.jsx (search for `function ComponentName`)
2. **Copy the function** to the appropriate file in `src/components/pages/`
3. **Extract shared logic** to hooks or utils
4. **Update imports** as needed

### Example: Extracting Dashboard

```jsx
// src/components/pages/Dashboard.jsx
import React from 'react';
import { StatCard } from '../ui';
import { useStock } from '../../context/StockContext';
import { getExpiryStatus } from '../../utils/helpers';

export default function Dashboard() {
  const { data } = useStock();
  
  // ... copy Dashboard logic from FULL_APP.jsx
}
```

---

## 🚢 Deployment

### Build for Production

```bash
npm run build
```

This creates a `dist/` folder with optimized static files.

### Deploy Options

**Vercel/Netlify (Static)**
```bash
# Push to GitHub, connect repo to Vercel/Netlify
# Set environment variables in dashboard
```

**Docker**
```dockerfile
FROM node:18-alpine as build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

**With Backend (Docker Compose)**
```yaml
version: '3.8'
services:
  frontend:
    build: ./frontend
    ports:
      - "3000:80"
    depends_on:
      - backend
      
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://...
    depends_on:
      - db
      
  db:
    image: postgres:15
    environment:
      - POSTGRES_DB=hatch_stock
      - POSTGRES_USER=hatch
      - POSTGRES_PASSWORD=secure_password
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

---

## 🔐 Authentication (Optional)

To add authentication:

1. **Update api.js** to include auth token
2. **Add login page** component
3. **Wrap app** with auth provider
4. **Protect routes** with auth check

```jsx
// src/context/AuthContext.jsx
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  
  const login = async (email, password) => {
    const response = await api.post('/auth/login', { email, password });
    localStorage.setItem('auth_token', response.data.token);
    setUser(response.data.user);
  };
  
  // ...
}
```

---

## 📱 PWA Support (Optional)

To make it installable on mobile:

1. Add `manifest.json` to `public/`
2. Add service worker registration
3. Configure caching strategy

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

---

## 📄 License

MIT License - feel free to use for commercial projects.

---

## 🆘 Support

For issues or questions:
- Check the System Guide in Admin → 📖 System Guide
- Review API service files for endpoint documentation
- Check browser console for errors
