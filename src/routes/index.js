import express from 'express';

import jobsRouter from './jobs.js';
import usersRouter from './users.js';
import systemRouter from './system.js';

const router = express.Router();

router.use('/health', systemRouter);
router.use('/users', usersRouter);
router.use('/jobs', jobsRouter);

export default router;
