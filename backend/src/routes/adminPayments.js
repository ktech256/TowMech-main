// backend/src/routes/adminPayments.js
import express from "express";
import Payment, { PAYMENT_STATUSES } from "../models/Payment.js";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";

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
    "ZA"
  )
    .toString()
    .trim()
    .toUpperCase();
};

/**
 * ✅ Enforce workspace lock:
 * - SuperAdmin can use requested workspace
 * - Admin without canSwitchCountryWorkspace => forced to user.countryCode
 */
const enforceWorkspaceAccess = (req, res, workspaceCountryCode) => {
  const role = req.user?.role;
  const userCountry = String(req.user?.countryCode || "ZA").toUpperCase();
  const canSwitch = !!req.user?.permissions?.canSwitchCountryWorkspace;

  if (role === USER_ROLES.SUPER_ADMIN) {
    req.countryCode = workspaceCountryCode;
    return true;
  }

  if (role === USER_ROLES.ADMIN && !canSwitch) {
    req.countryCode = userCountry;
    return true;
  }

  req.countryCode = workspaceCountryCode;
  return true;
};

/**
 * ✅ Permission enforcement helper
 *
 * NOTE:
 * Your User model has:
 * - canApprovePayments
 * - canRefundPayments
 *
 * So we map:
 * - View/list payments => canApprovePayments (or SuperAdmin)
 * - Refund payment => canRefundPayments (or SuperAdmin)
 */
const requirePermission = (req, res, permissionKey) => {
  if (req.user.role === USER_ROLES.SUPER_ADMIN) return true;

  if (req.user.role === USER_ROLES.ADMIN) {
    if (!req.user.permissions || req.user.permissions[permissionKey] !== true) {
      res.status(403).json({
        message: `Permission denied ❌ Missing ${permissionKey}`,
      });
      return false;
    }
    return true;
  }

  res.status(403).json({ message: "Permission denied ❌" });
  return false;
};

/**
 * ✅ Block Suspended / Banned admins
 */
const blockRestrictedAdmins = (req, res) => {
  if (req.user.accountStatus?.isSuspended) {
    res.status(403).json({ message: "Your admin account is suspended ❌" });
    return true;
  }
  if (req.user.accountStatus?.isBanned) {
    res.status(403).json({ message: "Your admin account is banned ❌" });
    return true;
  }
  return false;
};

/**
 * ✅ Get ALL payments (PER COUNTRY)
 * GET /api/admin/payments
 */
router.get(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canApprovePayments")) return;

      const requestedCountryCode = resolveCountryCode(req);
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;

      const workspaceCountryCode = req.countryCode;

      const payments = await Payment.find({ countryCode: workspaceCountryCode })
        .populate("customer", "name email role countryCode")
        .populate("job")
        .populate("manualMarkedBy", "name email role")
        .populate("refundedBy", "name email role")
        .sort({ createdAt: -1 });

      return res.status(200).json({
        countryCode: workspaceCountryCode,
        payments,
        count: payments.length,
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not fetch payments",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ Get payment by ID (PER COUNTRY)
 * GET /api/admin/payments/:id
 */
router.get(
  "/:id",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canApprovePayments")) return;

      const requestedCountryCode = resolveCountryCode(req);
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;

      const workspaceCountryCode = req.countryCode;

      const payment = await Payment.findOne({
        _id: req.params.id,
        countryCode: workspaceCountryCode,
      })
        .populate("customer", "name email role countryCode")
        .populate("job")
        .populate("manualMarkedBy", "name email role")
        .populate("refundedBy", "name email role");

      if (!payment) return res.status(404).json({ message: "Payment not found" });

      return res.status(200).json({ countryCode: workspaceCountryCode, payment });
    } catch (err) {
      return res.status(500).json({
        message: "Could not fetch payment",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ Admin manually marks payment as REFUNDED (PER COUNTRY)
 * PATCH /api/admin/payments/:id/refund
 */
router.patch(
  "/:id/refund",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canRefundPayments")) return;

      const requestedCountryCode = resolveCountryCode(req);
      if (!enforceWorkspaceAccess(req, res, requestedCountryCode)) return;

      const workspaceCountryCode = req.countryCode;

      const payment = await Payment.findOne({
        _id: req.params.id,
        countryCode: workspaceCountryCode,
      });

      if (!payment) return res.status(404).json({ message: "Payment not found" });

      payment.status = PAYMENT_STATUSES.REFUNDED;
      payment.refundedAt = new Date();
      payment.refundReference = `MANUAL_REFUND-${Date.now()}`;
      payment.refundedBy = req.user._id;

      await payment.save();

      const populatedPayment = await Payment.findById(payment._id)
        .populate("customer", "name email role countryCode")
        .populate("job")
        .populate("manualMarkedBy", "name email role")
        .populate("refundedBy", "name email role");

      return res.status(200).json({
        message: "Payment marked as refunded ✅",
        countryCode: workspaceCountryCode,
        payment: populatedPayment,
      });
    } catch (err) {
      return res.status(500).json({
        message: "Could not refund payment",
        error: err.message,
      });
    }
  }
);

export default router;