// backend/src/routes/adminPaymentRouting.routes.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";
import CountryServiceConfig from "../models/CountryServiceConfig.js";
import { normalizeGatewayKeyToEnum } from "../services/payments/index.js";

const router = express.Router();

const normalizeKey = (v) => String(v || "").trim().toLowerCase();

function normalizeFlowType(v) {
  const t = String(v || "REDIRECT").trim().toUpperCase();
  return t === "SDK" ? "SDK" : "REDIRECT";
}

function normalizeObj(v) {
  return v && typeof v === "object" ? v : {};
}

function normalizePriority(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Convert legacy providers object -> providers[]
 * legacy shape:
 *   providers: { payfast: {enabled, flowType, config}, paystack: {...} }
 */
function legacyProvidersObjectToArray(providersObj = {}) {
  if (!providersObj || typeof providersObj !== "object") return [];

  return Object.entries(providersObj)
    .map(([key, val]) => ({
      gateway: normalizeGatewayKeyToEnum(key),
      flowType: normalizeFlowType(val?.flowType),
      enabled: !!val?.enabled,
      priority: normalizePriority(val?.priority),

      // Legacy only had "config"
      config: normalizeObj(val?.config),

      // Phase 2 fields (not present in legacy)
      sdkConfig: normalizeObj(val?.sdkConfig),
      redirectConfig: normalizeObj(val?.redirectConfig),
    }))
    .filter((p) => !!p.gateway);
}

/**
 * Convert providers[] -> legacy object (optional for older UIs)
 */
function providersArrayToLegacyObject(providersArr = []) {
  const out = {};
  (providersArr || []).forEach((p) => {
    const enumKey = String(p?.gateway || "").toUpperCase();
    if (!enumKey) return;

    out[enumKey.toLowerCase()] = {
      enabled: !!p.enabled,
      flowType: normalizeFlowType(p.flowType),
      priority: normalizePriority(p.priority),

      // keep legacy "config"
      config: normalizeObj(p.config),

      // extra Phase 2 keys (optional)
      sdkConfig: normalizeObj(p.sdkConfig),
      redirectConfig: normalizeObj(p.redirectConfig),
    };
  });
  return out;
}

/**
 * Normalize incoming providers into providers[]
 * Accepts:
 *  A) providers: [ ... ] (new)
 *  B) providers: { ... } (legacy object keyed)
 */
function normalizeIncomingProviders(providers) {
  if (!providers) return [];

  if (Array.isArray(providers)) {
    return providers
      .filter(Boolean)
      .map((p) => ({
        gateway: normalizeGatewayKeyToEnum(p.gateway),
        flowType: normalizeFlowType(p.flowType),
        enabled: !!p.enabled,
        priority: normalizePriority(p.priority),

        sdkConfig: normalizeObj(p.sdkConfig),
        redirectConfig: normalizeObj(p.redirectConfig),

        // back-compat
        config: normalizeObj(p.config),
      }))
      .filter((p) => !!p.gateway);
  }

  if (typeof providers === "object") {
    return legacyProvidersObjectToArray(providers);
  }

  return [];
}

/**
 * GET /api/admin/payment-routing/:countryCode
 * Always returns providers[] as primary.
 */
router.get(
  "/:countryCode",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const countryCode = String(req.params.countryCode || "ZA")
        .trim()
        .toUpperCase();

      let cfg = await CountryServiceConfig.findOne({ countryCode });

      if (!cfg) {
        cfg = await CountryServiceConfig.create({
          countryCode,
          services: {},
          payments: {
            defaultProvider: "paystack",
            providers: [
              { gateway: "PAYSTACK", flowType: "REDIRECT", enabled: true, priority: 100, sdkConfig: {}, redirectConfig: {}, config: {} },
              { gateway: "IKHOKHA", flowType: "REDIRECT", enabled: false, priority: 0, sdkConfig: {}, redirectConfig: {}, config: {} },
              { gateway: "PAYFAST", flowType: "REDIRECT", enabled: false, priority: 0, sdkConfig: {}, redirectConfig: {}, config: {} },
              { gateway: "FLUTTERWAVE", flowType: "REDIRECT", enabled: false, priority: 0, sdkConfig: {}, redirectConfig: {}, config: {} },
              { gateway: "MPESA", flowType: "SDK", enabled: false, priority: 0, sdkConfig: {}, redirectConfig: {}, config: {} },
              { gateway: "PEACH_PAYMENTS", flowType: "REDIRECT", enabled: false, priority: 0, sdkConfig: {}, redirectConfig: {}, config: {} },

              // Phase 2 SDK gateways (adapters coming later)
              { gateway: "STRIPE", flowType: "SDK", enabled: false, priority: 0, sdkConfig: {}, redirectConfig: {}, config: {} },
              { gateway: "PAYPAL", flowType: "SDK", enabled: false, priority: 0, sdkConfig: {}, redirectConfig: {}, config: {} },
              { gateway: "GOOGLE_PAY", flowType: "SDK", enabled: false, priority: 0, sdkConfig: {}, redirectConfig: {}, config: {} },
              { gateway: "APPLE_PAY", flowType: "SDK", enabled: false, priority: 0, sdkConfig: {}, redirectConfig: {}, config: {} },
              { gateway: "ADYEN", flowType: "SDK", enabled: false, priority: 0, sdkConfig: {}, redirectConfig: {}, config: {} },
            ],
          },
        });
      }

      const payments = cfg.payments || {};
      const providersArr = normalizeIncomingProviders(payments.providers);

      return res.status(200).json({
        config: {
          countryCode,
          defaultProvider: payments.defaultProvider || "paystack",
          providers: providersArr,
          providersLegacy: providersArrayToLegacyObject(providersArr),
          updatedAt: cfg.updatedAt,
          createdAt: cfg.createdAt,
        },
      });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to load payment routing",
        error: err.message,
      });
    }
  }
);

/**
 * PUT /api/admin/payment-routing
 * Accepts either:
 *  A) { countryCode, defaultProvider, providers: [ ... ] }   ✅ new
 *  B) { countryCode, defaultProvider, providers: { ... } }  ✅ legacy
 */
router.put(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { countryCode, defaultProvider, providers } = req.body || {};
      const cc = String(countryCode || "ZA").trim().toUpperCase();

      if (!providers) {
        return res.status(400).json({ message: "providers is required" });
      }

      const dpKey = normalizeKey(defaultProvider) || "paystack";
      const providersArr = normalizeIncomingProviders(providers);

      if (providersArr.length === 0) {
        return res.status(400).json({ message: "providers resolved to an empty list" });
      }

      // legacy enabled flags for compatibility
      const enabledMap = {};
      providersArr.forEach((p) => {
        enabledMap[String(p.gateway || "").toUpperCase()] = !!p.enabled;
      });

      const update = {
        "payments.defaultProvider": dpKey,
        "payments.providers": providersArr,

        // legacy booleans (best-effort)
        "payments.paystackEnabled": !!enabledMap.PAYSTACK,
        "payments.payfastEnabled": !!enabledMap.PAYFAST,
        "payments.stripeEnabled": !!enabledMap.STRIPE,
        "payments.ikhokhaEnabled": !!enabledMap.IKHOKHA,
        "payments.mpesaEnabled": !!enabledMap.MPESA,
        "payments.flutterwaveEnabled": !!enabledMap.FLUTTERWAVE,
      };

      const cfg = await CountryServiceConfig.findOneAndUpdate(
        { countryCode: cc },
        { $set: update },
        { new: true, upsert: true }
      );

      const payments = cfg.payments || {};
      const storedProvidersArr = normalizeIncomingProviders(payments.providers);

      return res.status(200).json({
        message: "Saved ✅",
        config: {
          countryCode: cc,
          defaultProvider: payments.defaultProvider || dpKey,
          providers: storedProvidersArr,
          providersLegacy: providersArrayToLegacyObject(storedProvidersArr),
          updatedAt: cfg.updatedAt,
          createdAt: cfg.createdAt,
        },
      });
    } catch (err) {
      return res.status(500).json({ message: "Save failed", error: err.message });
    }
  }
);

export default router;