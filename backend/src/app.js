import notificationRoutes from './routes/notifications.js';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import jobRoutes from './routes/jobs.js';
import providerRoutes from './routes/providers.js';
import adminPricingRoutes from './routes/adminPricing.js';
import paymentRoutes from './routes/payments.js';
import adminProviderRoutes from './routes/adminProviders.js';

const app = express();

app.use(cors());
app.use(express.json());

// ✅ Health Check
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

// ✅ Routes
app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/providers', providerRoutes);
app.use('/api/admin', adminPricingRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminProviderRoutes);
app.use('/api/notifications', notificationRoutes);

// ✅ Error Handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
  next();
});

export default app;
