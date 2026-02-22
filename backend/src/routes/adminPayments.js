// backend/src/routes/adminPayments.js
import express from "express";
import Payment, { PAYMENT_STATUSES } from "../models/Payment.js";
import Job from "../models/Job.js";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";

// ✅ Paystack refund helper (real refund)
import { paystackRefundPayment } from "../services/payments/providers/paystack.js";

const router = express.Router();

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

const isInsuranceJob = (jobDoc) => {
  try {
    return !!(jobDoc && jobDoc.insurance && jobDoc.insurance.enabled);
  } catch (e) {
    return false;
  }
};

function normalizeProviderKey(v) {
  return String(v || "").trim().toUpperCase();
}

function resolveRefundRequestedStatus() {
  const v = PAYMENT_STATUSES?.REFUND_REQUESTED;
  if (v) return v;
  return PAYMENT_STATUSES?.PAID || "PAID";
}

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
      }).populate("job");

      if (!payment) return res.status(404).json({ message: "Payment not found" });

      if (payment.status !== PAYMENT_STATUSES.PAID) {
        return res.status(400).json({
          message: "Only PAID payments can be refunded ❌",
        });
      }

      if (isInsuranceJob(payment.job)) {
        return res.status(400).json({
          message: "Insurance payments cannot be refunded ❌",
        });
      }

      const reason = req.body?.reason ? String(req.body.reason).trim() : null;

      // ✅ REAL gateway refund attempt (Paystack supported)
      const provider = normalizeProviderKey(payment.provider);
      let gatewayRefund = null;

      if (provider === "PAYSTACK") {
        const reference = String(payment.providerReference || "").trim();
        if (!reference) {
          return res.status(400).json({ message: "Missing providerReference for PAYSTACK refund" });
        }

        gatewayRefund = await paystackRefundPayment({
          reference,
          amount: payment.amount, // MAJOR units -> converted in helper
          currency: payment.currency,
          reason: reason || "admin_refund",
        });

        payment.status = resolveRefundRequestedStatus();
        payment.refundReference =
          gatewayRefund?.refundReference ||
          gatewayRefund?.raw?.data?.reference ||
          `PAYSTACK_REFUND-${Date.now()}`;
      } else {
        payment.status = resolveRefundRequestedStatus();
        payment.refundReference = `MANUAL_REFUND_REQ-${Date.now()}`;
      }

      payment.refundedAt = new Date(); // used as "requested at"
      payment.refundedBy = req.user._id;
      payment.refundReason = reason;

      const existingPayload =
        payment.providerPayload && typeof payment.providerPayload === "object"
          ? payment.providerPayload
          : {};
      payment.providerPayload = {
        ...existingPayload,
        refund: gatewayRefund || { ok: true, mode: "DB_ONLY", provider },
      };

      await payment.save();

      // ✅ Update job pricing status too (if job exists)
      const jobId = payment.job?._id || payment.job;
      if (jobId) {
        const job = await Job.findById(jobId);
        if (job) {
          if (!job.pricing) job.pricing = {};
          job.pricing.bookingFeeStatus = "REFUND_REQUESTED";
          job.pricing.bookingFeeRefundedAt = new Date();
          await job.save();
        }
      }

      const populatedPayment = await Payment.findById(payment._id)
        .populate("customer", "name email role countryCode")
        .populate("job")
        .populate("manualMarkedBy", "name email role")
        .populate("refundedBy", "name email role");

      return res.status(200).json({
        message:
          provider === "PAYSTACK"
            ? "Refund requested on Paystack ✅ (may take time to complete)"
            : "Refund marked as requested ✅ (gateway not integrated)",
        countryCode: workspaceCountryCode,
        payment: populatedPayment,
        gatewayRefund,
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