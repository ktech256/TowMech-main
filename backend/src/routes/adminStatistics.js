import express from 'express';
import auth from '../middleware/auth.js';
import authorizeRoles from '../middleware/role.js';
import User, { USER_ROLES } from '../models/User.js';
import Job, { JOB_STATUSES } from '../models/Job.js';

const router = express.Router();

/**
 * ✅ Helper: Convert period string → milliseconds
 * Supports:
 * 1m, 5m, 15m, 30m
 * 1h, 6h, 12h
 * 1d, 7d, 30d
 * 1y
 */
const periodToMs = (period) => {
  const map = {
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '30m': 30 * 60 * 1000,

    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '12h': 12 * 60 * 60 * 1000,

    '1d': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,

    '1y': 365 * 24 * 60 * 60 * 1000
  };

  return map[period] || map['1d']; // default: 1 day
};

/**
 * ✅ ADMIN STATISTICS
 * GET /api/admin/statistics?period=1m|5m|1h|1d|7d|30d|1y
 */
router.get(
  '/',
  auth,
  authorizeRoles(USER_ROLES.ADMIN),
  async (req, res) => {
    try {
      const period = req.query.period || '1d';
      const rangeMs = periodToMs(period);

      const now = new Date();
      const startDate = new Date(now.getTime() - rangeMs);

      /**
       * ✅ USERS STATISTICS
       */
      const totalCustomers = await User.countDocuments({ role: USER_ROLES.CUSTOMER });
      const totalProviders = await User.countDocuments({
        role: { $in: [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK] }
      });

      const newUsers = await User.countDocuments({
        createdAt: { $gte: startDate }
      });

      /**
       * ✅ ACTIVE PROVIDERS
       * Definition: providers online + lastSeenAt within period
       */
      const activeProviders = await User.countDocuments({
        role: { $in: [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK] },
        'providerProfile.isOnline': true,
        'providerProfile.lastSeenAt': { $gte: startDate }
      });

      /**
       * ✅ JOB + REVENUE STATISTICS
       * Only COMPLETED jobs count as revenue
       */
      const completedJobs = await Job.find({
        status: JOB_STATUSES.COMPLETED,
        updatedAt: { $gte: startDate }
      });

      let towRevenue = 0;
      let mechanicRevenue = 0;
      let towJobsCount = 0;
      let mechanicJobsCount = 0;

      completedJobs.forEach((job) => {
        if (job.roleNeeded === USER_ROLES.TOW_TRUCK) {
          towRevenue += job.pricing?.bookingFee || 0;
          towJobsCount++;
        }

        if (job.roleNeeded === USER_ROLES.MECHANIC) {
          mechanicRevenue += job.pricing?.bookingFee || 0;
          mechanicJobsCount++;
        }
      });

      const totalRevenue = towRevenue + mechanicRevenue;

      return res.status(200).json({
        message: `✅ Admin stats for period: ${period}`,
        period,
        startDate,
        endDate: now,

        users: {
          totalCustomers,
          totalProviders,
          newUsers,
          activeProviders
        },

        jobs: {
          completedJobs: completedJobs.length,
          towJobsCount,
          mechanicJobsCount
        },

        revenue: {
          towRevenue,
          mechanicRevenue,
          totalRevenue
        }
      });
    } catch (err) {
      console.error('🔥 ADMIN STATS ERROR:', err);
      return res.status(500).json({
        message: 'Could not fetch admin statistics',
        error: err.message
      });
    }
  }
);

export default router;