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

function normalizeDialCode(v) {
  let s = String(v || "").trim();
  if (!s) return "";
  if (!s.startsWith("+")) {
    // allow "256" -> "+256"
    if (/^\d+$/.test(s)) s = `+${s}`;
  }
  // keep only + and digits
  s = s.replace(/[^\d+]/g, "");
  return /^\+\d{1,4}$/.test(s) ? s : "";
}

/**
 * GET /api/admin/countries
 */
router.get(
  "/",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const countries = await Country.find({}).sort({ createdAt: -1 });

      // ✅ now includes dialCode
      return res.status(200).json({ countries });
    } catch (err) {
      return res
        .status(500)
        .json({ message: "Failed to load countries", error: err.message });
    }
  }
);

/**
 * POST /api/admin/countries
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
        dialCode, // ✅ NEW
        defaultLanguage = "en",
        supportedLanguages = ["en"],
        timezone = "Africa/Johannesburg",
        isActive = true,
      } = req.body || {};

      const iso2 = normalizeIso2(code);
      if (!iso2) return res.status(400).json({ message: "code (ISO2) is required" });
      if (!name) return res.status(400).json({ message: "name is required" });
      if (!currency) return res.status(400).json({ message: "currency is required" });

      const dial = normalizeDialCode(dialCode);
      if (!dial) {
        return res.status(400).json({
          message: "dialCode is required (e.g. +256, +27) ❌",
        });
      }

      const exists = await Country.findOne({ code: iso2 }).lean();
      if (exists) return res.status(409).json({ message: "Country already exists" });

      // ✅ unique dialCode (recommended)
      const dialExists = await Country.findOne({ dialCode: dial }).lean();
      if (dialExists) {
        return res.status(409).json({ message: "dialCode already exists" });
      }

      const country = await Country.create({
        code: iso2,
        dialCode: dial, // ✅ NEW
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
 */
router.patch(
  "/:id",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const country = await Country.findById(req.params.id);
      if (!country) return res.status(404).json({ message: "Country not found" });

      const {
        name,
        currency,
        dialCode, // ✅ NEW
        defaultLanguage,
        supportedLanguages,
        timezone,
        isActive,
      } = req.body || {};

      if (typeof name === "string" && name.trim()) country.name = name.trim();
      if (typeof currency === "string" && currency.trim())
        country.currency = currency.trim().toUpperCase();

      if (dialCode !== undefined) {
        const dial = normalizeDialCode(dialCode);
        if (!dial) {
          return res.status(400).json({ message: "Invalid dialCode ❌" });
        }

        // ✅ keep unique dialCode
        const dialExists = await Country.findOne({
          dialCode: dial,
          _id: { $ne: country._id },
        }).lean();

        if (dialExists) {
          return res.status(409).json({ message: "dialCode already exists" });
        }

        country.dialCode = dial;
      }

      if (typeof defaultLanguage === "string" && defaultLanguage.trim())
        country.defaultLanguage = defaultLanguage.trim().toLowerCase();

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