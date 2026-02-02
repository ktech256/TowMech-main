// backend/src/routes/adminCountries.routes.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";
import Country from "../models/Country.js";

const router = express.Router();

/**
 * ✅ Resolve active workspace country (Tenant)
 * NOTE: Countries list itself is GLOBAL (not filtered),
 * but we echo back selected workspaceCountryCode for dashboard state.
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
 * GET /api/admin/countries
 * ✅ GLOBAL LIST (do NOT filter by workspace), but return workspaceCountryCode for UI.
 */
router.get(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const workspaceCountryCode = resolveCountryCode(req);

      const countries = await Country.find({}).sort({ createdAt: -1 });

      return res.status(200).json({
        workspaceCountryCode,
        countries,
      });
    } catch (err) {
      return res.status(500).json({
        message: "Failed to load countries",
        error: err.message,
      });
    }
  }
);

/**
 * POST /api/admin/countries
 * ✅ Create is GLOBAL (not per workspace)
 */
router.post(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const {
        code,
        name,
        currency,
        defaultLanguage = "en",
        supportedLanguages = ["en"],
        timezone = "Africa/Johannesburg",
        isActive = true,
      } = req.body || {};

      const iso2 = String(code || "").trim().toUpperCase();
      if (!iso2 || iso2.length !== 2) {
        return res.status(400).json({ message: "code (ISO2) is required" });
      }
      if (!name) return res.status(400).json({ message: "name is required" });
      if (!currency) return res.status(400).json({ message: "currency is required" });

      const exists = await Country.findOne({ code: iso2 }).lean();
      if (exists) return res.status(409).json({ message: "Country already exists" });

      const country = await Country.create({
        code: iso2,
        name: String(name).trim(),
        currency: String(currency).trim().toUpperCase(),
        defaultLanguage: String(defaultLanguage).trim().toLowerCase(),
        supportedLanguages: Array.isArray(supportedLanguages)
          ? supportedLanguages.map((l) => String(l).trim().toLowerCase())
          : [String(defaultLanguage).trim().toLowerCase()],
        timezone: String(timezone).trim(),
        isActive: Boolean(isActive),
        createdBy: req.user?._id || null,
        updatedBy: req.user?._id || null,
      });

      return res.status(201).json({ message: "Country created ✅", country });
    } catch (err) {
      return res.status(500).json({ message: "Create failed", error: err.message });
    }
  }
);

/**
 * PATCH /api/admin/countries/:id
 * ✅ Update is GLOBAL (not per workspace)
 */
router.patch(
  "/:id",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const country = await Country.findById(req.params.id);
      if (!country) return res.status(404).json({ message: "Country not found" });

      const { name, currency, defaultLanguage, supportedLanguages, timezone, isActive } =
        req.body || {};

      if (typeof name === "string" && name.trim()) country.name = name.trim();
      if (typeof currency === "string" && currency.trim())
        country.currency = currency.trim().toUpperCase();

      if (typeof defaultLanguage === "string" && defaultLanguage.trim()) {
        country.defaultLanguage = defaultLanguage.trim().toLowerCase();
      }

      if (Array.isArray(supportedLanguages)) {
        country.supportedLanguages = supportedLanguages.map((l) =>
          String(l).trim().toLowerCase()
        );
      }

      if (typeof timezone === "string" && timezone.trim()) country.timezone = timezone.trim();
      if (typeof isActive === "boolean") country.isActive = isActive;

      country.updatedBy = req.user?._id || null;
      await country.save();

      return res.status(200).json({ message: "Country updated ✅", country });
    } catch (err) {
      return res.status(500).json({ message: "Update failed", error: err.message });
    }
  }
);

export default router;