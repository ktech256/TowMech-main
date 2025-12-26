import express from 'express';
import auth from '../middleware/auth.js';
import authorizeRoles from '../middleware/role.js';
import { USER_ROLES } from '../models/User.js';
import PricingConfig from '../models/PricingConfig.js';

const router = express.Router();

/**
 * ✅ Get pricing config
 * GET /api/admin/pricing
 */
router.get('/pricing', auth, authorizeRoles(USER_ROLES.ADMIN), async (req, res) => {
  try {
    let config = await PricingConfig.findOne();
    if (!config) config = await PricingConfig.create({});

    return res.status(200).json({ pricing: config });
  } catch (err) {
    return res.status(500).json({ message: 'Could not fetch pricing config', error: err.message });
  }
});

/**
 * ✅ Update pricing config
 * PUT /api/admin/pricing
 */
router.put('/pricing', auth, authorizeRoles(USER_ROLES.ADMIN), async (req, res) => {
  try {
    let config = await PricingConfig.findOne();
    if (!config) config = await PricingConfig.create({});

    Object.assign(config, req.body);
    await config.save();

    return res.status(200).json({ message: 'Pricing config updated', pricing: config });
  } catch (err) {
    return res.status(500).json({ message: 'Could not update pricing config', error: err.message });
  }
});

export default router;
