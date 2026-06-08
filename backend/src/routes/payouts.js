import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { syncProviderWeeklyPayout, markPayoutAsPaid } from "../services/payout.service.js";
import WeeklyPayout from "../models/WeeklyPayout.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

/**
 * ✅ Provider fetches their own payouts
 */
router.get("/me", auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Only providers can view payouts" });
    }

    // Optional: Sync current week before returning
    await syncProviderWeeklyPayout(req.user._id, new Date());

    const payouts = await WeeklyPayout.find({ provider: req.user._id })
      .sort({ weekStartDate: -1 })
      .limit(12);

    return res.status(200).json({ payouts });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch payouts", error: err.message });
  }
});

/**
 * ✅ Admin fetches all payouts
 */
router.get("/admin", auth, authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), async (req, res) => {
  try {
    const { status, countryCode } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (countryCode) filter.countryCode = countryCode;

    const payouts = await WeeklyPayout.find(filter)
      .populate("provider", "name email phone")
      .populate({
        path: "jobs.job",
        select: "title status pickupAddressText createdAt customer",
        populate: { path: "customer", select: "name" }
      })
      .sort({ weekStartDate: -1 });

    return res.status(200).json({ payouts });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch admin payouts", error: err.message });
  }
});

/**
 * ✅ Admin marks payout as PAID
 */
router.patch("/admin/:id/pay", auth, authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN), async (req, res) => {
  try {
    const payout = await markPayoutAsPaid(req.params.id, req.user._id);
    return res.status(200).json({ message: "Payout marked as PAID ✅", payout });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to mark as paid" });
  }
});

export default router;