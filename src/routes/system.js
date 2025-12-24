import express from 'express';

import { config } from '../config/index.js';

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    environment: config.environment,
    timestamp: new Date().toISOString()
  });
});

export default router;
