import express from 'express';
import auth from '../middleware/auth.js';
import authorizeRoles from '../middleware/role.js';
import { USER_ROLES } from '../models/User.js';
import User from '../models/User.js';
import Job from '../models/Job.js';

const router = express.Router();

/**
 * ✅ Convert range query to milliseconds
 */
const rangeToMs = (range) => {
  const map = {
    '1m': 1 * 60 * 1000,
    '5m': 5 * 60 * 1000,
    '10m': 10 * 60 * 1000,
    '30m': 30 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '12h': 12 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    '1y': 365 * 24 * 60 * 60 * 1000
  };

  return map[range] || map['7d']; // default 7 days
};

/**
 * ✅ ADMIN Statistics
 * GET /api/admin/statistics?range=7d
 */
router.get(
  '/',
  auth,
  authorizeRoles(USER_ROLES.ADMIN),
  async (req, res) => {
    try {
      const range = req.query.range || '7d';
      const ms = rangeToMs(range);

      const startDate = new Date(Date.now() - ms);
      const endDate = new Date();

      /**
       * ✅ USERS STATS
       */
      const totalUsers = await User.countDocuments();
      const totalCustomers = await User.countDocuments({ role: USER_ROLES.CUSTOMER });

      const totalProviders = await User.countDocuments({
        role: { $in: [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK] }
      });

      const newUsers = await User.countDocuments({
        createdAt: { $gte: startDate, $lte: endDate }
      });

      const activeProviders = await User.countDocuments({
        role: { $in: [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK] },
        'providerProfile.lastSeenAt': { $gte: startDate }
      });

      /**
       * ✅ REVENUE STATS
       * Booking fee is revenue for TowMech
       */
      const jobsInPeriod = await Job.find({
        createdAt: { $gte: startDate, $lte: endDate },
        'pricing.bookingFeeStatus': 'PAID'
      });

      const towTruckRevenue = jobsInPeriod
        .filter((j) => j.roleNeeded === USER_ROLES.TOW_TRUCK)
        .reduce((sum, j) => sum + (j.pricing?.bookingFee || 0), 0);

      const mechanicRevenue = jobsInPeriod
        .filter((j) => j.roleNeeded === USER_ROLES.MECHANIC)
        .reduce((sum, j) => sum + (j.pricing?.bookingFee || 0), 0);

      const totalRevenue = towTruckRevenue + mechanicRevenue;

      /**
       * ✅ Jobs breakdown
       */
      const totalJobs = await Job.countDocuments({
        createdAt: { $gte: startDate, $lte: endDate }
      });

      const towJobs = await Job.countDocuments({
        createdAt: { $gte: startDate, $lte: endDate },
        roleNeeded: USER_ROLES.TOW_TRUCK
      });

      const mechJobs = await Job.countDocuments({
        createdAt: { $gte: startDate, $lte: endDate },
        roleNeeded: USER_ROLES.MECHANIC
      });

      return res.status(200).json({
        range,
        startDate,
        endDate,
        users: {
          totalUsers,
          totalCustomers,
          totalProviders,
          newUsers,
          activeProviders
        },
        revenue: {
          towTruckRevenue,
          mechanicRevenue,
          totalRevenue,
          currency: 'ZAR'
        },
        jobs: {
          totalJobs,
          towJobs,
          mechJobs
        }
      });
    } catch (err) {
      return res.status(500).json({
        message: 'Could not fetch statistics',
        error: err.message
      });
    }
  }
);

export default router;