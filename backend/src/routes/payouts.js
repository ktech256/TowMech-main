import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { syncProviderWeeklyPayout, markPayoutAsPaid } from "../services/payout.service.js";
import WeeklyPayout from "../models/WeeklyPayout.js";
import { USER_ROLES } from "../models/User.js";
import { renderProviderStatementPdfBuffer } from "../utils/pdf/providerStatementPdf.js";

const router = express.Router();

/**
 * ✅ Resolve active workspace country (Tenant)
 */
const resolveCountryCode = (req) => {
  return (
    req.countryCode ||
    req.headers["x-country-code"] ||
    req.query?.country ||
    req.query?.countryCode ||
    req.body?.countryCode ||
    "ZA"
  )
    .toString()
    .trim()
    .toUpperCase();
};

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
 * ✅ Admin fetches all payouts (Scoped by Country)
 */
router.get("/admin", auth, authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, "canManageProviderPayouts"), async (req, res) => {
  try {
    const workspaceCountryCode = resolveCountryCode(req);
    const { status } = req.query;

    const filter = { countryCode: workspaceCountryCode };
    if (status) filter.status = status;

    const payouts = await WeeklyPayout.find(filter)
      .populate("provider", "name email phone")
      .populate({
        path: "jobs.job",
        select: "title status pickupAddressText createdAt customer",
        populate: { path: "customer", select: "name" }
      })
      .populate("auditTrail.performedBy", "name")
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

/**
 * ✅ GET Weekly Statement PDF
 */
router.get("/admin/:id/statement/pdf", auth, authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, "canViewProviderStatements"), async (req, res) => {
  try {
    const workspaceCountryCode = resolveCountryCode(req);
    const payout = await WeeklyPayout.findOne({ _id: req.params.id, countryCode: workspaceCountryCode }).populate("provider");
    if (!payout) return res.status(404).json({ message: "Payout not found in this workspace" });

    const pdfBuffer = await renderProviderStatementPdfBuffer(payout);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="statement-${payout._id}.pdf"`);
    return res.send(pdfBuffer);
  } catch (err) {
    return res.status(500).json({ message: "PDF generation failed", error: err.message });
  }
});

/**
 * ✅ GET Monthly Statement PDF for a provider
 * GET /api/payouts/admin/provider/:providerId/monthly-statement/pdf?month=2024-05
 */
router.get("/admin/provider/:providerId/monthly-statement/pdf", auth, authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, "canViewProviderStatements"), async (req, res) => {
  try {
    const workspaceCountryCode = resolveCountryCode(req);
    const { providerId } = req.params;
    const { month } = req.query; // YYYY-MM

    if (!month) return res.status(400).json({ message: "month query param (YYYY-MM) is required" });

    const provider = await User.findOne({ _id: providerId, countryCode: workspaceCountryCode });
    if (!provider) return res.status(404).json({ message: "Provider not found in this workspace" });

    // Aggregate all weekly payouts for this month
    const startOfMonth = new Date(`${month}-01T00:00:00.000Z`);
    const endOfMonth = new Date(startOfMonth);
    endOfMonth.setUTCMonth(endOfMonth.getUTCMonth() + 1);

    const payouts = await WeeklyPayout.find({
      provider: providerId,
      countryCode: workspaceCountryCode,
      weekStartDate: { $gte: startOfMonth, $lt: endOfMonth }
    });

    if (payouts.length === 0) return res.status(404).json({ message: "No payouts found for this month" });

    // For now, let's reuse the renderer by creating a mock "monthly" payout object
    // Or just concatenate them.
    // Professional approach: separate renderer.
    // Simplified for Phase 3: reuse renderer with aggregated data.

    const aggregatedPayout = {
        provider,
        weekStartDate: startOfMonth,
        weekEndDate: endOfMonth,
        currency: payouts[0].currency,
        status: payouts.every(p => p.status === "PAID") ? "PAID" : "MIXED",
        totalAmount: payouts.reduce((s, p) => s + p.totalAmount, 0),
        jobs: payouts.flatMap(p => p.jobs),
        isMonthly: true
    };

    const pdfBuffer = await renderProviderStatementPdfBuffer(aggregatedPayout);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="monthly-statement-${providerId}-${month}.pdf"`);
    return res.send(pdfBuffer);
  } catch (err) {
    return res.status(500).json({ message: "Monthly PDF generation failed", error: err.message });
  }
});

export default router;