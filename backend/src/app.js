import express from 'express';
import cors from 'cors';

import authRoutes from './routes/auth.js';
import jobRoutes from './routes/jobs.js';
import providerRoutes from './routes/providers.js';

const app = express();

app.use(cors());
app.use(express.json());

// ✅ Health check
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

// ✅ Routes
app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/providers', providerRoutes);

// ✅ Error handler
app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
  next();
});

export default app;