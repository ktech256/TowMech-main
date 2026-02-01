// backend/src/routes/country.routes.js
import express from "express";
import auth from "../middleware/auth.js";
import User, { USER_ROLES } from "../models/User.js";
import Country from "../models/Country.js";

const router = express.Router();

/**
 * ✅ Helper: Only Admin/SuperAdmin
 */
async function requireAdmin(req, res, next) {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const user = await User.findById(userId).select("role");
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    if (![USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    req.adminUser = user;
    next();
  } catch (err) {
    return res.status(500).json({ message: "Auth error", error: err.message });
  }
}

/**
 * ✅ PUBLIC: GET /api/countries
 * Default behavior: returns ACTIVE countries only
 * Optional: ?includeInactive=true (admin only)
 */
router.get("/", async (req, res) => {
  try {
    const includeInactiveParam = String(req.query?.includeInactive || "false") === "true";

    // Public default: active only
    let filter = { isActive: true };

    // If includeInactive requested, require admin auth token (optional)
    // (If token missing/invalid, still return active only)
    if (includeInactiveParam) {
      try {
        // If client sends Authorization, auth middleware will normally be used.
        // Here we do a soft-check: if req.user exists, verify role.
        const userId = req.user?._id || req.user?.id;
        if (userId) {
          const user = await User.findById(userId).select("role");
          if (user && [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(user.role)) {
            filter = {}; // ✅ return all
          }
        }
      } catch {
        // ignore, fallback to active only
      }
    }

    const countries = await Country.find(filter).sort({ createdAt: -1 });

    return res.status(200).json({ countries });
  } catch (err) {
    return res.status(500).json({ message: "Failed to load countries", error: err.message });
  }
});

/**
 * ✅ ADMIN: GET /api/countries/admin/all
 * Returns ALL countries (active + inactive)
 */
router.get("/admin/all", auth, requireAdmin, async (req, res) => {
  try {
    const countries = await Country.find({}).sort({ createdAt: -1 });
    return res.status(200).json({ countries });
  } catch (err) {
    return res.status(500).json({ message: "Failed to load countries", error: err.message });
  }
});

/**
 * ✅ ADMIN: POST /api/countries
 * Create country (admin only)
 */
router.post("/", auth, requireAdmin, async (req, res) => {
  try {
    const {
      countryCode,
      name,
      currency,
      defaultLanguage = "en",
      supportedLanguages = ["en"],
      timezone = "Africa/Johannesburg",
      isActive = true,
    } = req.body || {};

    const code = String(countryCode || "").trim().toUpperCase();
    if (!code || code.length !== 2) {
      return res.status(400).json({ message: "countryCode (ISO2) is required" });
    }
    if (!name) return res.status(400).json({ message: "name is required" });
    if (!currency) return res.status(400).json({ message: "currency is required" });

    const exists = await Country.findOne({ countryCode: code }).lean();
    if (exists) return res.status(409).json({ message: "Country already exists" });

    const country = await Country.create({
      countryCode: code,
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
});

/**
 * ✅ ADMIN: PATCH /api/countries/:id
 * Toggle/Update country fields (admin only)
 * Used by dashboard "Active" toggle.
 */
router.patch("/:id", auth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const country = await Country.findById(id);
    if (!country) return res.status(404).json({ message: "Country not found" });

    const {
      name,
      currency,
      defaultLanguage,
      supportedLanguages,
      timezone,
      isActive,
    } = req.body || {};

    if (typeof name === "string" && name.trim()) country.name = name.trim();
    if (typeof currency === "string" && currency.trim()) country.currency = currency.trim().toUpperCase();
    if (typeof defaultLanguage === "string" && defaultLanguage.trim())
      country.defaultLanguage = defaultLanguage.trim().toLowerCase();

    if (Array.isArray(supportedLanguages)) {
      country.supportedLanguages = supportedLanguages.map((l) => String(l).trim().toLowerCase());
    }

    if (typeof timezone === "string" && timezone.trim()) country.timezone = timezone.trim();

    if (typeof isActive === "boolean") country.isActive = isActive;

    country.updatedBy = req.user?._id || null;

    await country.save();

    return res.status(200).json({ message: "Country updated ✅", country });
  } catch (err) {
    return res.status(500).json({ message: "Update failed", error: err.message });
  }
});

export default router;