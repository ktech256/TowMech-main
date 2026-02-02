// backend/src/routes/country.routes.js
import express from "express";
import auth from "../middleware/auth.js";
import User, { USER_ROLES } from "../models/User.js";
import Country from "../models/Country.js";

const router = express.Router();

/**
 * ✅ Resolve active workspace country (Tenant)
 * Used only to return the selected workspaceCountryCode (NOT for filtering countries list).
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
 * Default: ACTIVE only
 * Optional: ?includeInactive=true (admin only)
 *
 * ✅ Workspace note:
 * Countries are GLOBAL. We return workspaceCountryCode so dashboard can show selection.
 */
router.get("/", async (req, res) => {
  try {
    const workspaceCountryCode = resolveCountryCode(req);
    const includeInactiveParam = String(req.query?.includeInactive || "false") === "true";

    let filter = { isActive: true };

    if (includeInactiveParam) {
      // Soft-check if req.user exists (if upstream auth middleware was used)
      try {
        const userId = req.user?._id || req.user?.id;
        if (userId) {
          const user = await User.findById(userId).select("role");
          if (user && [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(user.role)) {
            filter = {}; // ✅ return all
          }
        }
      } catch {
        // ignore
      }
    }

    const countries = await Country.find(filter).sort({ createdAt: -1 });

    return res.status(200).json({ workspaceCountryCode, countries });
  } catch (err) {
    return res.status(500).json({ message: "Failed to load countries", error: err.message });
  }
});

/**
 * ✅ ADMIN: GET /api/countries/admin/all
 * Returns ALL countries (active + inactive) - GLOBAL
 */
router.get("/admin/all", auth, requireAdmin, async (req, res) => {
  try {
    const workspaceCountryCode = resolveCountryCode(req);

    const countries = await Country.find({}).sort({ createdAt: -1 });
    return res.status(200).json({ workspaceCountryCode, countries });
  } catch (err) {
    return res.status(500).json({ message: "Failed to load countries", error: err.message });
  }
});

/**
 * ✅ ADMIN: POST /api/countries
 * Create country (GLOBAL)
 * Supports BOTH { countryCode } and { code } without breaking older clients.
 */
router.post("/", auth, requireAdmin, async (req, res) => {
  try {
    const {
      countryCode,
      code, // ✅ backward compatible
      name,
      currency,
      defaultLanguage = "en",
      supportedLanguages = ["en"],
      timezone = "Africa/Johannesburg",
      isActive = true,
    } = req.body || {};

    const iso2 = String(countryCode || code || "").trim().toUpperCase();
    if (!iso2 || iso2.length !== 2) {
      return res.status(400).json({ message: "countryCode (ISO2) is required" });
    }
    if (!name) return res.status(400).json({ message: "name is required" });
    if (!currency) return res.status(400).json({ message: "currency is required" });

    // ✅ support both schemas (code vs countryCode) safely
    const exists =
      (await Country.findOne({ code: iso2 }).lean()) ||
      (await Country.findOne({ countryCode: iso2 }).lean());

    if (exists) return res.status(409).json({ message: "Country already exists" });

    // ✅ create using your current adminCountries schema fields (code)
    const country = await Country.create({
      code: iso2,
      countryCode: iso2, // ✅ also set if model supports it (harmless if ignored)
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
 * Update country fields (GLOBAL)
 */
router.patch("/:id", auth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const country = await Country.findById(id);
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
});

export default router;