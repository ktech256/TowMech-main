import express from 'express';
import { body, validationResult } from 'express-validator';

import { createJob, listJobs } from '../services/job-service.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const jobs = await listJobs();
    res.json({ success: true, data: jobs });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/',
  [
    body('customer').isString().notEmpty(),
    body('type').isIn(['mechanic', 'tow']),
    body('price').optional().isNumeric(),
    body('location').optional().isString()
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', details: errors.array() });
    }

    try {
      const job = await createJob(req.body);
      res.status(201).json({ success: true, data: job });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
