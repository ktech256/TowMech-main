// backend/src/routes/adminPaymentRouting.routes.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";
import CountryServiceConfig from "../models/CountryServiceConfig.js";

const router = express.Router();

const normalize = (v) => String(v || "").trim().toLowerCase();

/**
 * Build a providers object even if older config exists
 */
function buildProvidersFromConfig(payments = {}) {
  const fromMixed = payments.providers && typeof payments.providers === "object" ? payments.providers : {};

  // ensure these exist for UI
  const providers = {
    paystack: { enabled: !!payments.paystackEnabled, ...(fromMixed.paystack || {}) },
    payfast: { enabled: !!payments.payfastEnabled, ...(fromMixed.payfast || {}) },
    stripe: { enabled: !!payments.stripeEnabled, ...(fromMixed.stripe || {}) },
    ikhokha: { enabled: !!payments.ikhokhaEnabled, ...(fromMixed.ikhokha || {}) },
    mpesa: { enabled: !!payments.mpesaEnabled, ...(fromMixed.mpesa || {}) },
    flutterwave: { enabled: !!payments.flutterwaveEnabled, ...(fromMixed.flutterwave || {}) },
  };

  // make sure enabled is boolean
  Object.keys(providers).forEach((k) => {
    providers[k].enabled = !!providers[k].enabled;
  });

  return providers;
}

/**
 * GET /api/admin/payment-routing/:countryCode
 */
router.get(
  "/:countryCode",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const countryCode = String(req.params.countryCode || "ZA").trim().toUpperCase();

      let cfg = await CountryServiceConfig.findOne({ countryCode });
      if (!cfg) {
        cfg = await CountryServiceConfig.create({ countryCode, services: {}, payments: {} });
      }

      const payments = cfg.payments || {};
      const providers = buildProvidersFromConfig(payments);

      return res.status(200).json({
        config: {
          countryCode,
          defaultProvider: payments.defaultProvider || "paystack",
          providers,
        },
      });
    } catch (err) {
      return res.status(500).json({ message: "Failed to load payment routing", error: err.message });
    }
  }
);

/**
 * PUT /api/admin/payment-routing
 * body: { countryCode, defaultProvider, providers }
 */
router.put(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { countryCode, defaultProvider, providers } = req.body || {};
      const cc = String(countryCode || "ZA").trim().toUpperCase();

      if (!providers || typeof providers !== "object") {
        return res.status(400).json({ message: "providers object is required" });
      }

      const dp = normalize(defaultProvider) || "paystack";

      // update legacy enabled flags for paymentRouter compatibility
      const nextPayments = {
        defaultProvider: dp,
        providers,

        paystackEnabled: !!providers?.paystack?.enabled,
        payfastEnabled: !!providers?.payfast?.enabled,
        stripeEnabled: !!providers?.stripe?.enabled,
        ikhokhaEnabled: !!providers?.ikhokha?.enabled,
        mpesaEnabled: !!providers?.mpesa?.enabled,
        flutterwaveEnabled: !!providers?.flutterwave?.enabled,
      };

      const cfg = await CountryServiceConfig.findOneAndUpdate(
        { countryCode: cc },
        { $set: { "payments.defaultProvider": nextPayments.defaultProvider,
                  "payments.providers": nextPayments.providers,
                  "payments.paystackEnabled": nextPayments.paystackEnabled,
                  "payments.payfastEnabled": nextPayments.payfastEnabled,
                  "payments.stripeEnabled": nextPayments.stripeEnabled,
                  "payments.ikhokhaEnabled": nextPayments.ikhokhaEnabled,
                  "payments.mpesaEnabled": nextPayments.mpesaEnabled,
                  "payments.flutterwaveEnabled": nextPayments.flutterwaveEnabled
        } },
        { new: true, upsert: true }
      );

      const payments = cfg.payments || {};
      return res.status(200).json({
        message: "Saved ✅",
        config: {
          countryCode: cc,
          defaultProvider: payments.defaultProvider || dp,
          providers: buildProvidersFromConfig(payments),
        },
      });
    } catch (err) {
      return res.status(500).json({ message: "Save failed", error: err.message });
    }
  }
);

export default router;