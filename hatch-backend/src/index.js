import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Import database utilities
import { testConnection } from './utils/db.js';

// Import routes
import productsRouter from './routes/products.js';
import warehousesRouter from './routes/warehouses.js';
import locationsRouter from './routes/locations.js';
import inventoryRouter from './routes/inventory.js';
import ordersRouter from './routes/orders.js';
import buyingListsRouter, { publicBuyingListsRouter } from './routes/buying-lists.js';
import pickListsRouter from './routes/pick-lists.js';
import attentionRouter from './routes/attention.js';
import suppliersRouter from './routes/suppliers.js';
import routesRouter from './routes/routes.js';
import salesRouter from './routes/sales.js';
import mealTypesRouter from './routes/meal-types.js';
import analyticsRouter from './routes/analytics.js';
import reportsRouter from './routes/reports.js';
import vendliveRouter from './routes/vendlive.js';
import vendliveStockRouter from './routes/vendlive-stock.js';
import planogramRouter, { publicRestockSheetRouter } from './routes/planogram.js';
import authRouter from './routes/auth.js';

// Import middleware
import { errorHandler } from './middleware/errorHandler.js';
import { authMiddleware, rolePolicy } from './middleware/auth.js';

// Import scheduler
import { startScheduler } from './scheduler.js';

const app = express();
const PORT = process.env.PORT || 8000;

// ============ MIDDLEWARE ============

// Security headers
app.use(helmet());

// CORS - allow frontend (supports multiple origins for production)
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

// Anchored patterns — substring checks like origin.includes('localhost') would
// also match attacker domains such as http://localhost.evil.com
const LOCALHOST_ORIGIN = /^https?:\/\/localhost(:\d+)?$/;
const VERCEL_PREVIEW_ORIGIN = /^https:\/\/hatch-stock-system[a-z0-9-]*\.vercel\.app$/;

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    if (
      LOCALHOST_ORIGIN.test(origin) ||
      VERCEL_PREVIEW_ORIGIN.test(origin) ||
      allowedOrigins.includes(origin) ||
      allowedOrigins.includes('*')
    ) {
      return callback(null, true);
    }

    console.log('CORS blocked origin:', origin);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// Rate limiting. The VendLive webhook is exempt — it authenticates via HMAC
// signature and a burst of vend events must never be dropped with a 429.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => req.path.startsWith('/api/vendlive/webhook/'),
});
app.use(limiter);

// Body parsing — capture raw body for webhook signature verification
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    // Only retain the raw body for webhook endpoints that need HMAC verification
    if (req.originalUrl?.startsWith('/api/vendlive/webhook/')) {
      req.rawBody = buf;
    }
  },
}));
app.use(express.urlencoded({ extended: true }));

// Request logging (development)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
  });
}

// Authentication — applied to all /api routes. authMiddleware is a no-op
// unless AUTH_ENABLED=true, so this is safe to deploy ahead of enabling auth.
// Exempt paths: login/register (register self-gates: bootstrap first user,
// admin-only afterwards), the webhook, which authenticates via HMAC, and the
// public buying-list share view, where the unguessable share token IS the
// credential.
const PUBLIC_API_PATHS = ['/api/auth/login', '/api/auth/register', '/api/auth/setup-status'];
app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) return next();
  if (PUBLIC_API_PATHS.includes(req.path)) return next();
  if (req.path.startsWith('/api/vendlive/webhook/')) return next();
  if (req.path.startsWith('/api/public/buying-lists/')) return next();
  if (req.path.startsWith('/api/public/restock-sheet/')) return next();
  return authMiddleware(req, res, next);
});

// Role enforcement — reads for everyone, writes admin-only except the
// operational allowlist (stock checks, restocks, removals, pick lists,
// receiving, location stock sync). No-op while AUTH_ENABLED is off; see
// middleware/auth.js for the policy table.
app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) return next();
  if (PUBLIC_API_PATHS.includes(req.path)) return next();
  if (req.path.startsWith('/api/vendlive/webhook/')) return next();
  if (req.path.startsWith('/api/public/buying-lists/')) return next();
  if (req.path.startsWith('/api/public/restock-sheet/')) return next();
  return rolePolicy(req, res, next);
});

// ============ ROUTES ============

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Database health check
app.get('/health/db', async (req, res) => {
  const isConnected = await testConnection();
  if (isConnected) {
    res.json({ status: 'ok', database: 'connected' });
  } else {
    res.status(503).json({ status: 'error', database: 'disconnected' });
  }
});

// API routes
app.use('/api/auth', authRouter);
app.use('/api/products', productsRouter);
app.use('/api/warehouses', warehousesRouter);
app.use('/api/locations', locationsRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/buying-lists', buyingListsRouter);
// Read-only share view — exempted from auth above; the token is the credential.
app.use('/api/public/buying-lists', publicBuyingListsRouter);
app.use('/api/pick-lists', pickListsRouter);
// Writes here are admin-only via rolePolicy (not on the ops allowlist).
app.use('/api/attention-dismissals', attentionRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/routes', routesRouter);
app.use('/api/sales', salesRouter);
app.use('/api/meal-types', mealTypesRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/vendlive', vendliveRouter);
app.use('/api/vendlive/stock', vendliveStockRouter);
app.use('/api/planogram', planogramRouter);
// Read-only 3PL restock sheet — exempted from auth above; the token is the credential.
app.use('/api/public/restock-sheet', publicRestockSheetRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use(errorHandler);

// ============ START SERVER ============

const startServer = async () => {
  // Fail fast on insecure auth configuration: with auth enabled, tokens must
  // never be signed with a fallback secret.
  if (process.env.AUTH_ENABLED === 'true' && !process.env.JWT_SECRET) {
    console.error('FATAL: AUTH_ENABLED=true requires JWT_SECRET to be set.');
    process.exit(1);
  }

  // Test database connection on startup
  console.log('Testing database connection...');
  const dbConnected = await testConnection();

  if (!dbConnected) {
    console.error('⚠️  Warning: Database connection failed. API will start but database operations will fail.');
  }

  app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 Hatch Stock Management API                          ║
║                                                           ║
║   Server running on: http://localhost:${PORT}              ║
║   Environment: ${process.env.NODE_ENV || 'development'}                           ║
║   Database: ${dbConnected ? 'Connected' : 'NOT CONNECTED'}                           ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);

    // Start VendLive poll scheduler
    if (dbConnected) {
      startScheduler();
    }
  });
};

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;
