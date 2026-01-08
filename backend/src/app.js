import express from 'express';
import cors from 'cors';

// ✅ Routes
import authRoutes from './routes/auth.js';
import jobRoutes from './routes/jobs.js';
import providerRoutes from './routes/providers.js';
import paymentRoutes from './routes/payments.js';
import notificationRoutes from './routes/notifications.js';

// ✅ NEW: Provider Documents Upload Routes
import providerDocumentsRoutes from "./routes/providerDocuments.js";

// ✅ NEW ✅ Config Routes
import configRoutes from './routes/config.js';

// ✅ Admin + Config Routes
import pricingConfigRoutes from './routes/adminPricing.js';
import adminProviderRoutes from './routes/adminProviders.js';
import adminStatisticsRoutes from './routes/adminStatistics.js';

// ✅ NEW ROUTES (SuperAdmin + Admin User Management)
import superAdminRoutes from './routes/superAdmin.js';
import adminUsersRoutes from './routes/adminUsers.js';

const app = express();

/**
 * ✅ Middleware
 */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * ✅ Health Check
 */
app.get('/health', (req, res) => {
  return res.status(200).json({ status: 'ok ✅' });
});

/**
 * ✅ PUBLIC ROUTES
 */
app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobRoutes);

// ✅ Public Providers Routes (existing)
app.use('/api/providers', providerRoutes);

// ✅ ✅ NEW: Provider Document Upload Endpoint
app.use("/api/providers", providerDocumentsRoutes);

app.use('/api/payments', paymentRoutes);
app.use('/api/notifications', notificationRoutes);

// ✅ ✅ ✅ CONFIG ROUTE (Vehicle Types + TowTruck Types + Pricing)
app.use('/api/config', configRoutes);

/**
 * ✅ Pricing Config Route (Your requirement ✅)
 * /api/pricing-config
 */
app.use('/api/pricing-config', pricingConfigRoutes);

/**
 * ✅ ADMIN ROUTES
 */
app.use('/api/admin/providers', adminProviderRoutes);
app.use('/api/admin/statistics', adminStatisticsRoutes);

// ✅ Admin User Management (Suspend/Ban/Unban/Unsuspend)
app.use('/api/admin', adminUsersRoutes);

/**
 * ✅ SUPER ADMIN ROUTES
 * ✅ MUST BE /api/superadmin ✅
 */
app.use('/api/superadmin', superAdminRoutes);

/**
 * ✅ 404 Handler (Routes not found)
 */
app.use((req, res) => {
  return res.status(404).json({
    message: 'Route not found ❌',
    method: req.method,
    path: req.originalUrl
  });
});

/**
 * ✅ Global Error Handler
 */
app.use((err, req, res, next) => {
  console.error('🔥 INTERNAL ERROR:', err);

  return res.status(err.statusCode || 500).json({
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

export default app;
