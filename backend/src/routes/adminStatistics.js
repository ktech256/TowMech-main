import express from 'express';
import auth from '../middleware/auth.js';
import authorizeRoles from '../middleware/role.js';

import Payment, { PAYMENT_STATUSES } from '../models/Payment.js';
import Job from '../models/Job.js';
import User, { USER_ROLES } from '../models/User.js';

const router = express.Router();

/**
 * ✅ Utility: Convert "period" string into date range
 */
const getDateRangeFromPeriod = (period) => {
  const now = new Date();
  let from = null;

  switch (period) {
    case '1m':
      from = new Date(now.getTime() - 1 * 60 * 1000);
      break;
    case '5m':
      from = new Date(now.getTime() - 5 * 60 * 1000);
      break;
    case '15m':
      from = new Date(now.getTime() - 15 * 60 * 1000);
      break;
    case '1h':
      from = new Date(now.getTime() - 60 * 60 * 1000);
      break;
    case '1d':
      from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case '7d':
      from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case '1y':
      from = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      break;
    default:
      from = null;
  }

  return { from, to: now };
};

/**
 * ✅ ADMIN STATISTICS
 * GET /api/admin/statistics?period=1h
 * OR  /api/admin/statistics?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
router.get(
  '/',
  auth,
  authorizeRoles(USER_ROLES.ADMIN),
  async (req, res) => {
    try {
      const { period, from, to } = req.query;

      let dateFrom = null;
      let dateTo = null;

      // ✅ Custom date range
      if (from && to) {
        dateFrom = new Date(from);
        dateTo = new Date(to);
      }
      // ✅ Period-based range
      else if (period) {
        const range = getDateRangeFromPeriod(period);
        dateFrom = range.from;
        dateTo = range.to;
      }

      // ✅ Build filter (if period/range provided)
      const dateFilter =
        dateFrom && dateTo
          ? { createdAt: { $gte: dateFrom, $lte: dateTo } }
          : {};

      /**
       * ✅ REVENUE CALCULATION (Booking fees only)
       * Revenue comes from PAID payments.
       */
      const paidPayments = await Payment.find({
        status: PAYMENT_STATUSES.PAID,
        ...dateFilter
      }).populate('job');

      let totalRevenue = 0;
      let towTruckRevenue = 0;
      let mechanicRevenue = 0;

      paidPayments.forEach((p) => {
        const amount = p.amount || 0;
        totalRevenue += amount;

        const roleNeeded = p.job?.roleNeeded;

        if (roleNeeded === USER_ROLES.TOW_TRUCK) towTruckRevenue += amount;
        if (roleNeeded === USER_ROLES.MECHANIC) mechanicRevenue += amount;
      });

      /**
       * ✅ USER COUNTS
       */
      const totalUsers = await User.countDocuments({});
      const totalCustomers = await User.countDocuments({ role: USER_ROLES.CUSTOMER });
      const totalProviders = await User.countDocuments({
        role: { $in: [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK] }
      });

      const newUsers = await User.countDocuments({
        ...dateFilter
      });

      /**
       * ✅ ACTIVE PROVIDERS
       * - online providers
       * - active within last X minutes
       */
      const onlineProviders = await User.countDocuments({
        role: { $in: [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK] },
        'providerProfile.isOnline': true
      });

      // ✅ Active providers = lastSeenAt within 15 minutes (default)
      const activeWindowMinutes = Number(req.query.activeWindowMinutes || 15);
      const activeSince = new Date(Date.now() - activeWindowMinutes * 60 * 1000);

      const activeProviders = await User.countDocuments({
        role: { $in: [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK] },
        'providerProfile.lastSeenAt': { $gte: activeSince }
      });

      // ✅ Providers with tokens
      const providersWithTokens = await User.countDocuments({
        role: { $in: [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK] },
        'providerProfile.fcmToken': { $ne: null }
      });

      return res.status(200).json({
        range: {
          from: dateFrom,
          to: dateTo
        },
        revenue: {
          totalRevenue,
          towTruckRevenue,
          mechanicRevenue,
          currency: 'ZAR'
        },
        users: {
          totalUsers,
          totalCustomers,
          totalProviders,
          newUsers
        },
        providers: {
          onlineProviders,
          activeProviders,
          providersWithTokens,
          activeWindowMinutes
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