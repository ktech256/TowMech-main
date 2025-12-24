import express from 'express';
import { body, validationResult } from 'express-validator';

import { createUser, listUsers } from '../services/user-service.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const users = await listUsers();
    res.json({ success: true, data: users });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/',
  [
    body('fullName').isString().trim().notEmpty(),
    body('email').isEmail().normalizeEmail(),
    body('phone').isString().trim().notEmpty(),
    body('role').isIn(['customer', 'mechanic', 'tow_truck', 'admin', 'support', 'super_admin'])
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', details: errors.array() });
    }

    try {
      const user = await createUser(req.body);
      res.status(201).json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
