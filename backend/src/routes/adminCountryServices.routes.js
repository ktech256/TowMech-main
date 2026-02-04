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
 * Accept dashboard keys in ANY of these forms:
 * - towingEnabled / mechanicEnabled / chatEnabled / ratingsEnabled / insuranceEnabled / emergencySupportEnabled
 * - towing / mechanic / chat / ratings / insurance / emergencySupport
 * Then we persist as *Enabled (canonical), while keeping supportEnabled in sync.
 */
function normalizeServicesPatch(input) {
  const src = input && typeof input === "object" ? input : {};
  const out = {};

  const pickBool = (k) => (typeof src[k] === "boolean" ? src[k] : undefined);

  // canonical keys
  const towingEnabled = pickBool("towingEnabled") ?? pickBool("towing");
  const mechanicEnabled = pickBool("mechanicEnabled") ?? pickBool("mechanic");
  const chatEnabled = pickBool("chatEnabled") ?? pickBool("chat");
  const ratingsEnabled = pickBool("ratingsEnabled") ?? pickBool("ratings");
  const insuranceEnabled = pickBool("insuranceEnabled") ?? pickBool("insurance");
  const emergencySupportEnabled = pickBool("emergencySupportEnabled") ?? pickBool("emergencySupport");

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

  // extended keys (pass-through if boolean)
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
  if (typeof out.supportEnabled === "boolean" && typeof out.emergencySupportEnabled !== "boolean") {
    out.emergencySupportEnabled = out.supportEnabled;
  }

  return out;
}

function withDefaults(services = {}) {
  const s = services || {};
  const emergency = typeof s.emergencySupportEnabled === "boolean"
    ? s.emergencySupportEnabled
    : (typeof s.supportEnabled === "boolean" ? s.supportEnabled : true);

  return {
    towingEnabled: typeof s.towingEnabled === "boolean" ? s.towingEnabled : true,
    mechanicEnabled: typeof s.mechanicEnabled === "boolean" ? s.mechanicEnabled : true,
    emergencySupportEnabled: emergency,
    supportEnabled: emergency,

    insuranceEnabled: typeof s.insuranceEnabled === "boolean" ? s.insuranceEnabled : false,
    chatEnabled: typeof s.chatEnabled === "boolean" ? s.chatEnabled : true,
    ratingsEnabled: typeof s.ratingsEnabled === "boolean" ? s.ratingsEnabled : true,

    winchRecoveryEnabled: typeof s.winchRecoveryEnabled === "boolean" ? s.winchRecoveryEnabled : false,
    roadsideAssistanceEnabled:
      typeof s.roadsideAssistanceEnabled === "boolean" ? s.roadsideAssistanceEnabled : false,
    jumpStartEnabled: typeof s.jumpStartEnabled === "boolean" ? s.jumpStartEnabled : false,
    tyreChangeEnabled: typeof s.tyreChangeEnabled === "boolean" ? s.tyreChangeEnabled : false,
    fuelDeliveryEnabled: typeof s.fuelDeliveryEnabled === "boolean" ? s.fuelDeliveryEnabled : false,
    lockoutEnabled: typeof s.lockoutEnabled === "boolean" ? s.lockoutEnabled : false,
  };
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
 * body: { countryCode, services }
 */
router.put(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { countryCode, services } = req.body || {};
      const cc = normalizeCountryCode(countryCode);

      if (!services || typeof services !== "object") {
        return res.status(400).json({ message: "services object is required" });
      }

      // ✅ merge patch into existing to avoid wiping unknown flags
      const existing = await CountryServiceConfig.findOne({ countryCode: cc }).lean();
      const prevServices = existing?.services || {};

      const patch = normalizeServicesPatch(services);
      const merged = withDefaults({ ...prevServices, ...patch });

      const config = await CountryServiceConfig.findOneAndUpdate(
        { countryCode: cc },
        { $set: { services: merged } },
        { new: true, upsert: true }
      ).lean();

      return res.status(200).json({ message: "Saved ✅", config: { ...config, services: merged } });
    } catch (err) {
      return res.status(500).json({ message: "Save failed", error: err.message });
    }
  }
);

export default router;