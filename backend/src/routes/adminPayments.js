import express from "express";
import Payment, { PAYMENT_STATUSES } from "../models/Payment.js";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

/**
 * ✅ Permission enforcement helper
 */
const requirePermission = (req, res, permissionKey) => {
  // ✅ SuperAdmin bypass
  if (req.user.role === USER_ROLES.SUPER_ADMIN) return true;

  // ✅ Admin must have required permission
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
 * ✅ Get ALL payments (Admin Dashboard)
 * GET /api/admin/payments
 */
router.get(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canViewPayments")) return;

      const payments = await Payment.find()
        .populate("customer", "name email role")
        .populate("job")
        .populate("manualMarkedBy", "name email role")
        .populate("refundedBy", "name email role")
        .sort({ createdAt: -1 });

      return res.status(200).json({
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
 * ✅ Get payment by ID
 * GET /api/admin/payments/:id
 */
router.get(
  "/:id",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canViewPayments")) return;

      const payment = await Payment.findById(req.params.id)
        .populate("customer", "name email role")
        .populate("job")
        .populate("manualMarkedBy", "name email role")
        .populate("refundedBy", "name email role");

      if (!payment)
        return res.status(404).json({ message: "Payment not found" });

      return res.status(200).json({ payment });
    } catch (err) {
      return res.status(500).json({
        message: "Could not fetch payment",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ Admin manually marks payment as REFUNDED (Audit)
 * PATCH /api/admin/payments/:id/refund
 *
 * Used when:
 * - Payment done but system failed to record correctly
 * - Manual reconciliation needed
 * - Admin refund required
 */
router.patch(
  "/:id/refund",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (blockRestrictedAdmins(req, res)) return;
      if (!requirePermission(req, res, "canManagePayments")) return;

      const payment = await Payment.findById(req.params.id);

      if (!payment)
        return res.status(404).json({ message: "Payment not found" });

      payment.status = PAYMENT_STATUSES.REFUNDED;
      payment.refundedAt = new Date();
      payment.refundReference = `MANUAL_REFUND-${Date.now()}`;

      // ✅ Audit tracking
      payment.refundedBy = req.user._id;

      await payment.save();

      const populatedPayment = await Payment.findById(payment._id)
        .populate("customer", "name email role")
        .populate("job")
        .populate("manualMarkedBy", "name email role")
        .populate("refundedBy", "name email role");

      return res.status(200).json({
        message: "Payment marked as refunded ✅",
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
