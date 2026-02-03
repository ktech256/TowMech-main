// backend/src/routes/adminCountries.routes.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";
import Country from "../models/Country.js";

const router = express.Router();

function normalizeIso2(v) {
  const code = String(v || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}

function normalizeDialingCode(v) {
  let s = String(v || "").trim();
  if (!s) return "";
  if (!s.startsWith("+")) {
    if (/^\d+$/.test(s)) s = `+${s}`;
  }
  s = s.replace(/[^\d+]/g, "");
  return /^\+\d{1,4}$/.test(s) ? s : "";
}

/**
 * ✅ Permission enforcement helper (keeps existing authorizeRoles middleware intact)
 * - SuperAdmin always allowed
 * - Admin must have permissions[permissionKey] === true
 */
const requirePermission = (req, res, permissionKey) => {
  if (req.user?.role === USER_ROLES.SUPER_ADMIN) return true;

  if (req.user?.role === USER_ROLES.ADMIN) {
    if (!req.user.permissions || req.user.permissions[permissionKey] !== true) {
      res.status(403).json({ message: `Permission denied ❌ Missing ${permissionKey}` });
      return false;
    }
    return true;
  }

  res.status(403).json({ message: "Permission denied ❌" });
  return false;
};

/**
 * GET /api/admin/countries
 * ✅ Requires canManageCountries for Admin
 */
router.get(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (!requirePermission(req, res, "canManageCountries")) return;

      const countries = await Country.find({}).sort({ createdAt: -1 });

      return res.status(200).json({ countries });
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
 * ✅ Requires canManageCountries for Admin
 */
router.post(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (!requirePermission(req, res, "canManageCountries")) return;

      const {
        code,
        name,
        currency,
        dialCode, // ✅ support legacy field name from frontend
        dialingCode, // ✅ support correct field name too
        defaultLanguage = "en",
        supportedLanguages = ["en"],
        timezone = "Africa/Johannesburg",
        isActive = true,
      } = req.body || {};

      const iso2 = normalizeIso2(code);
      if (!iso2) return res.status(400).json({ message: "code (ISO2) is required" });
      if (!name) return res.status(400).json({ message: "name is required" });
      if (!currency) return res.status(400).json({ message: "currency is required" });

      const dial = normalizeDialingCode(dialingCode ?? dialCode);
      if (!dial) {
        return res.status(400).json({
          message: "dialingCode is required (e.g. +256, +27) ❌",
        });
      }

      const exists = await Country.findOne({ code: iso2 }).lean();
      if (exists) return res.status(409).json({ message: "Country already exists" });

      // ✅ unique dialingCode (recommended)
      const dialExists = await Country.findOne({ dialingCode: dial }).lean();
      if (dialExists) {
        return res.status(409).json({ message: "dialingCode already exists" });
      }

      const country = await Country.create({
        code: iso2,
        dialingCode: dial,
        name: String(name).trim(),
        currency: String(currency).trim().toUpperCase(),
        defaultLanguage: String(defaultLanguage).trim().toLowerCase(),
        supportedLanguages: Array.isArray(supportedLanguages)
          ? supportedLanguages.map((l) => String(l).trim().toLowerCase()).filter(Boolean)
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
 * ✅ Requires canManageCountries for Admin
 */
router.patch(
  "/:id",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      if (!requirePermission(req, res, "canManageCountries")) return;

      const country = await Country.findById(req.params.id);
      if (!country) return res.status(404).json({ message: "Country not found" });

      const {
        name,
        currency,
        dialCode, // ✅ accept legacy
        dialingCode, // ✅ accept correct
        defaultLanguage,
        supportedLanguages,
        timezone,
        isActive,
      } = req.body || {};

      if (typeof name === "string" && name.trim()) country.name = name.trim();
      if (typeof currency === "string" && currency.trim())
        country.currency = currency.trim().toUpperCase();

      // ✅ dialing code update (stored as dialingCode)
      if (dialingCode !== undefined || dialCode !== undefined) {
        const dial = normalizeDialingCode(dialingCode ?? dialCode);
        if (!dial) return res.status(400).json({ message: "Invalid dialingCode ❌" });

        const dialExists = await Country.findOne({
          dialingCode: dial,
          _id: { $ne: country._id },
        }).lean();

        if (dialExists) return res.status(409).json({ message: "dialingCode already exists" });

        country.dialingCode = dial;
      }

      if (typeof defaultLanguage === "string" && defaultLanguage.trim())
        country.defaultLanguage = defaultLanguage.trim().toLowerCase();

      if (Array.isArray(supportedLanguages)) {
        country.supportedLanguages = supportedLanguages
          .map((l) => String(l).trim().toLowerCase())
          .filter(Boolean);
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