// backend/src/routes/adminCountryServices.routes.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";
import CountryServiceConfig from "../models/CountryServiceConfig.js";

const router = express.Router();

function normalizeCountryCode(v) {
  return String(v || "ZA").trim().toUpperCase();
}

/**
 * ✅ Robust boolean parsing:
 * - supports true/false
 * - supports "true"/"false"
 * - supports 1/0 and "1"/"0"
 * - returns undefined if not a recognizable boolean
 */
function parseBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (v === 1) return true;
    if (v === 0) return false;
    return undefined;
  }
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
    if (s === "1") return true;
    if (s === "0") return false;
  }
  return undefined;
}

/**
 * Accept dashboard keys in ANY of these forms:
 * - towingEnabled / mechanicEnabled / chatEnabled / ratingsEnabled / insuranceEnabled / emergencySupportEnabled
 * - towing / mechanic / chat / ratings / insurance / emergencySupport
 * Then we persist as *Enabled (canonical), while keeping supportEnabled in sync.
 */
function normalizeServicesPatch(input) {
  const src = input && typeof input === "object" ? input : {};
  const out = {};

  const pickBool = (k) => parseBool(src[k]);

  // canonical keys
  const towingEnabled = pickBool("towingEnabled") ?? pickBool("towing");
  const mechanicEnabled = pickBool("mechanicEnabled") ?? pickBool("mechanic");
  const chatEnabled = pickBool("chatEnabled") ?? pickBool("chat");
  const ratingsEnabled = pickBool("ratingsEnabled") ?? pickBool("ratings");
  const insuranceEnabled = pickBool("insuranceEnabled") ?? pickBool("insurance");
  const emergencySupportEnabled =
    pickBool("emergencySupportEnabled") ?? pickBool("emergencySupport");

  if (typeof towingEnabled === "boolean") out.towingEnabled = towingEnabled;
  if (typeof mechanicEnabled === "boolean") out.mechanicEnabled = mechanicEnabled;
  if (typeof chatEnabled === "boolean") out.chatEnabled = chatEnabled;
  if (typeof ratingsEnabled === "boolean") out.ratingsEnabled = ratingsEnabled;
  if (typeof insuranceEnabled === "boolean") out.insuranceEnabled = insuranceEnabled;

  if (typeof emergencySupportEnabled === "boolean") {
    out.emergencySupportEnabled = emergencySupportEnabled;
    // legacy alias
    out.supportEnabled = emergencySupportEnabled;
  }

  // extended keys (pass-through if boolean-like)
  const passthroughKeys = [
    "winchRecoveryEnabled",
    "roadsideAssistanceEnabled",
    "jumpStartEnabled",
    "tyreChangeEnabled",
    "fuelDeliveryEnabled",
    "lockoutEnabled",
    "supportEnabled",
  ];

  for (const k of passthroughKeys) {
    const v = pickBool(k);
    if (typeof v === "boolean") out[k] = v;
  }

  // keep alias sync if supportEnabled explicitly passed
  if (
    typeof out.supportEnabled === "boolean" &&
    typeof out.emergencySupportEnabled !== "boolean"
  ) {
    out.emergencySupportEnabled = out.supportEnabled;
  }

  return out;
}

function withDefaults(services = {}) {
  const s = services || {};
  const emergency =
    typeof s.emergencySupportEnabled === "boolean"
      ? s.emergencySupportEnabled
      : typeof s.supportEnabled === "boolean"
        ? s.supportEnabled
        : true;

  return {
    towingEnabled: typeof s.towingEnabled === "boolean" ? s.towingEnabled : true,
    mechanicEnabled: typeof s.mechanicEnabled === "boolean" ? s.mechanicEnabled : true,
    emergencySupportEnabled: emergency,
    supportEnabled: emergency,

    insuranceEnabled: typeof s.insuranceEnabled === "boolean" ? s.insuranceEnabled : false,
    chatEnabled: typeof s.chatEnabled === "boolean" ? s.chatEnabled : true,
    ratingsEnabled: typeof s.ratingsEnabled === "boolean" ? s.ratingsEnabled : true,

    winchRecoveryEnabled:
      typeof s.winchRecoveryEnabled === "boolean" ? s.winchRecoveryEnabled : false,
    roadsideAssistanceEnabled:
      typeof s.roadsideAssistanceEnabled === "boolean" ? s.roadsideAssistanceEnabled : false,
    jumpStartEnabled: typeof s.jumpStartEnabled === "boolean" ? s.jumpStartEnabled : false,
    tyreChangeEnabled: typeof s.tyreChangeEnabled === "boolean" ? s.tyreChangeEnabled : false,
    fuelDeliveryEnabled: typeof s.fuelDeliveryEnabled === "boolean" ? s.fuelDeliveryEnabled : false,
    lockoutEnabled: typeof s.lockoutEnabled === "boolean" ? s.lockoutEnabled : false,
  };
}

/**
 * ✅ Helper: dashboard might send:
 * - services: { towingEnabled: false }
 * OR
 * - services: { services: { towingEnabled: false }, payments: {...} }
 *
 * This returns the actual FLAGS OBJECT.
 */
function unwrapServicesFlags(services) {
  if (!services || typeof services !== "object") return null;

  // If nested (services.services), use that inner object as the flags.
  if (services.services && typeof services.services === "object") {
    return services.services;
  }

  // Otherwise assume services is already the flags object.
  return services;
}

/**
 * ✅ Helper: payments may be sent as:
 * - body.payments
 * - body.config.payments
 * - body.services.payments   (when services is a wrapper object)
 */
function unwrapPayments(body, servicesWrapper) {
  const fromRoot = body?.payments;
  const fromConfig = body?.config?.payments;
  const fromWrapper = servicesWrapper?.payments;

  const candidate = fromRoot ?? fromConfig ?? fromWrapper ?? null;
  return candidate && typeof candidate === "object" ? candidate : null;
}

/**
 * GET /api/admin/country-services/:countryCode
 */
router.get(
  "/:countryCode",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const countryCode = normalizeCountryCode(req.params.countryCode);

      let config = await CountryServiceConfig.findOne({ countryCode });
      if (!config) {
        config = await CountryServiceConfig.create({ countryCode, services: {}, payments: {} });
      }

      // ✅ respond with normalized services (so dashboard always sees all keys)
      const safe = config.toObject();
      safe.services = withDefaults(safe.services);

      return res.status(200).json({ config: safe });
    } catch (err) {
      return res.status(500).json({ message: "Failed to load config", error: err.message });
    }
  }
);

/**
 * PUT /api/admin/country-services
 *
 * ✅ Accepts payload in multiple safe shapes:
 * - { countryCode, services }                              // services = flags
 * - { countryCode, services: { services: flags, payments } } // services = wrapper
 * - { countryCode, config: { services } }
 * - { config: { countryCode, services } }
 */
router.put(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const body = req.body || {};

      const cc = normalizeCountryCode(
        body.countryCode ?? body?.config?.countryCode ?? body?.services?.countryCode
      );

      // raw "services" value (might be flags OR wrapper)
      const rawServices =
        body.services ??
        body?.config?.services ??
        body?.config?.data?.services ??
        null;

      if (!rawServices || typeof rawServices !== "object") {
        return res.status(400).json({
          message:
            "services object is required (expected { countryCode, services } or { countryCode, services: { services: {..flags} } })",
        });
      }

      // ✅ unwrap actual flags object no matter which shape the dashboard sent
      const flagsObj = unwrapServicesFlags(rawServices);

      if (!flagsObj || typeof flagsObj !== "object") {
        return res.status(400).json({
          message:
            "services flags object is missing (expected services as flags OR services.services as flags)",
        });
      }

      // ✅ also accept payments updates if dashboard sends them (safe, optional)
      const paymentsObj = unwrapPayments(body, rawServices);

      // ✅ merge patch into existing to avoid wiping unknown flags
      const existing = await CountryServiceConfig.findOne({ countryCode: cc }).lean();
      const prevServices = existing?.services || {};
      const prevPayments = existing?.payments || {};

      // ✅ IMPORTANT: parseBool ensures false values are kept
      const patch = normalizeServicesPatch(flagsObj);
      const mergedServices = withDefaults({ ...prevServices, ...patch });

      // ✅ payments: merge shallowly (won't delete unknown keys)
      const mergedPayments =
        paymentsObj ? { ...prevPayments, ...paymentsObj } : prevPayments;

      const update = {
        services: mergedServices,
      };

      // only set payments if dashboard actually sent payments
      if (paymentsObj) update.payments = mergedPayments;

      const config = await CountryServiceConfig.findOneAndUpdate(
        { countryCode: cc },
        { $set: update },
        { new: true, upsert: true }
      ).lean();

      return res.status(200).json({
        message: "Saved ✅",
        config: {
          ...config,
          services: mergedServices,
          ...(paymentsObj ? { payments: mergedPayments } : {}),
        },
      });
    } catch (err) {
      return res.status(500).json({ message: "Save failed", error: err.message });
    }
  }
);

export default router;