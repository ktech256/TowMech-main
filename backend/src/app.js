import express from 'express';
import cors from 'cors';

// ✅ Routes
import authRoutes from './routes/auth.js';
import jobRoutes from './routes/jobs.js';
import providerRoutes from './routes/providers.js';
import paymentRoutes from './routes/payments.js';
import notificationRoutes from './routes/notifications.js';

// ✅ Admin Routes
import pricingConfigRoutes from './routes/adminPricing.js';
import adminProviderRoutes from './routes/adminProviders.js';
import adminStatisticsRoutes from './routes/adminStatistics.js'; // ✅ NEW

const app = express();

// ✅ Middleware
app.use(cors());
app.use(express.json());

// ✅ Health Check
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

/**
 * ✅ PUBLIC / GENERAL ROUTES
 */
app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/providers', providerRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/notifications', notificationRoutes);

/**
 * ✅ PRICING CONFIG ROUTE (Admin controlled)
 * ✅ Requirement: must be /api/pricing-config ✅
 */
app.use('/api/pricing-config', pricingConfigRoutes);

/**
 * ✅ ADMIN ROUTES
 */
app.use('/api/admin/providers', adminProviderRoutes);
app.use('/api/admin/statistics', adminStatisticsRoutes); // ✅ NEW REGISTERED ROUTE

/**
 * ✅ 404 Handler (helps debugging)
 */
app.use((req, res) => {
  return res.status(404).json({ message: 'Route not found ❌' });
});

/**
 * ✅ Error Handler
 */
app.use((err, req, res, next) => {
  console.error('🔥 ERROR:', err);

  return res.status(err.statusCode || 500).json({
    message: err.message || 'Internal Server Error'
  });
});

export default app;