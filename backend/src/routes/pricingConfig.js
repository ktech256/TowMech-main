import express from 'express';
import PricingConfig from '../models/PricingConfig.js';
import Job from '../models/Job.js';
import Payment, { PAYMENT_STATUSES } from '../models/Payment.js';
import User, { USER_ROLES } from '../models/User.js';
import auth from '../middleware/auth.js';
import authorizeRoles from '../middleware/role.js';

const router = express.Router();

/**
 * ✅ GET pricing config (Admin only)
 * GET /api/pricing-config
 */
router.get('/', auth, authorizeRoles(USER_ROLES.ADMIN), async (req, res) => {
  try {
    let config = await PricingConfig.findOne();
    if (!config) config = await PricingConfig.create({});
    return res.status(200).json({ config });
  } catch (err) {
    return res.status(500).json({ message: 'Could not fetch pricing config', error: err.message });
  }
});

/**
 * ✅ UPDATE pricing config (Admin only)
 * PATCH /api/pricing-config
 */
router.patch('/', auth, authorizeRoles(USER_ROLES.ADMIN), async (req, res) => {
  try {
    let config = await PricingConfig.findOne();
    if (!config) config = await PricingConfig.create({});

    // ✅ Only update fields provided (safe patch)
    Object.keys(req.body).forEach((key) => {
      config[key] = req.body[key];
    });

    await config.save();

    return res.status(200).json({
      message: 'Pricing config updated ✅',
      config
    });
  } catch (err) {
    return res.status(500).json({ message: 'Could not update pricing config', error: err.message });
  }
});

/**
 * ✅ ADMIN STATS (Dashboard Analytics)
 * GET /api/pricing-config/stats?from=ISO&to=ISO
 *
 * ✅ Supports period range:
 * - Minimum: 1 minute
 * - Maximum: 1 year
 */
router.get('/stats', auth, authorizeRoles(USER_ROLES.ADMIN), async (req, res) => {
  try {
    const { from, to } = req.query;

    // ✅ Default range = last 24 hours
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const start = from ? new Date(from) : defaultFrom;
    const end = to ? new Date(to) : now;

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ message: 'Invalid date format for from/to' });
    }

    if (start >= end) {
      return res.status(400).json({ message: '"from" must be before "to"' });
    }

    // ✅ Range validation (max 1 year)
    const maxRangeMs = 365 * 24 * 60 * 60 * 1000;
    if (end - start > maxRangeMs) {
      return res.status(400).json({
        message: 'Max range allowed is 1 year. Please reduce your from/to range.'
      });
    }

    /**
     * ✅ REVENUE (Booking Fees Only)
     * We only count PAYMENTS that are PAID.
     */
    const payments = await Payment.find({
      status: PAYMENT_STATUSES.PAID,
      createdAt: { $gte: start, $lte: end }
    }).populate('job');

    let towRevenue = 0;
    let mechRevenue = 0;

    payments.forEach((p) => {
      if (!p.job) return;

      if (p.job.roleNeeded === USER_ROLES.TOW_TRUCK) towRevenue += p.amount;
      if (p.job.roleNeeded === USER_ROLES.MECHANIC) mechRevenue += p.amount;
    });

    const totalRevenue = towRevenue + mechRevenue;

    /**
     * ✅ JOB COUNT STATS
     */
    const towJobsCount = await Job.countDocuments({
      roleNeeded: USER_ROLES.TOW_TRUCK,
      createdAt: { $gte: start, $lte: end }
    });

    const mechJobsCount = await Job.countDocuments({
      roleNeeded: USER_ROLES.MECHANIC,
      createdAt: { $gte: start, $lte: end }
    });

    const totalJobsCount = towJobsCount + mechJobsCount;

    /**
     * ✅ USER COUNTS
     */
    const totalCustomers = await User.countDocuments({ role: USER_ROLES.CUSTOMER });
    const totalProviders = await User.countDocuments({
      role: { $in: [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK] }
    });

    const newUsers = await User.countDocuments({
      createdAt: { $gte: start, $lte: end }
    });

    /**
     * ✅ ACTIVE PROVIDERS
     * Definition = providerProfile.lastSeenAt within the period
     */
    const activeProviders = await User.countDocuments({
      role: { $in: [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK] },
      'providerProfile.lastSeenAt': { $gte: start, $lte: end }
    });

    /**
     * ✅ PROVIDERS ONLINE NOW
     */
    const onlineProviders = await User.countDocuments({
      role: { $in: [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK] },
      'providerProfile.isOnline': true
    });

    return res.status(200).json({
      period: {
        from: start,
        to: end
      },

      revenue: {
        totalRevenue,
        towRevenue,
        mechRevenue
      },

      jobs: {
        totalJobsCount,
        towJobsCount,
        mechJobsCount
      },

      users: {
        totalCustomers,
        totalProviders,
        newUsers,
        activeProviders,
        onlineProviders
      }
    });
  } catch (err) {
    console.error('❌ STATS ERROR:', err);
    return res.status(500).json({ message: 'Could not generate stats', error: err.message });
  }
});

export default router;