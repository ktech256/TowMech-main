// backend/src/routes/countries.js
import express from "express";
import auth from "../middleware/auth.js";
import User, { USER_ROLES } from "../models/User.js";
import Country from "../models/Country.js";

const router = express.Router();

/**
 * ✅ i18n safe helper
 */
function t(req, key, vars = {}) {
  if (typeof req.t === "function") return req.t(key, vars);
  return vars.fallback || key;
}

function normalizeIso2(v) {
  const code = String(v || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}

function normalizeDialCode(v) {
  let s = String(v || "").trim();
  if (!s) return "";
  if (!s.startsWith("+")) {
    if (/^\d+$/.test(s)) s = `+${s}`;
  }
  s = s.replace(/[^\d+]/g, "");
  return /^\+\d{1,4}$/.test(s) ? s : "";
}

function normalizeCurrencyDisplay(v) {
  const x = String(v ?? "").trim();
  return x ? x : null;
}

/**
 * ✅ Helper: Only Admin/SuperAdmin
 */
async function requireAdmin(req, res, next) {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) return res.status(401).json({ message: t(req, "errors.unauthorized", { fallback: "Unauthorized" }) });

    const user = await User.findById(userId).select("role");
    if (!user) return res.status(401).json({ message: t(req, "errors.unauthorized", { fallback: "Unauthorized" }) });

    if (![USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(user.role)) {
      return res.status(403).json({ message: t(req, "errors.forbidden", { fallback: "Forbidden" }) });
    }

    req.adminUser = user;
    next();
  } catch (err) {
    return res.status(500).json({ message: t(req, "errors.auth_error", { fallback: "Auth error" }), error: err.message });
  }
}

/**
 * ✅ PUBLIC: GET /api/countries
 */
router.get("/", async (req, res) => {
  try {
    const includeInactiveParam = String(req.query?.includeInactive || "false") === "true";

    let filter = { isActive: true };

    if (includeInactiveParam) {
      try {
        const userId = req.user?._id || req.user?.id;
        if (userId) {
          const user = await User.findById(userId).select("role");
          if (user && [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(user.role)) {
            filter = {};
          }
        }
      } catch {
        // ignore
      }
    }

    const countries = await Country.find(filter).sort({ createdAt: -1 }).lean();

    const mapped = countries.map((c) => ({
      ...c,
      dialCode: c.dialingCode || null,
      currencyDisplay: c.currencyDisplay || c.currency || null,
    }));

    return res.status(200).json({ countries: mapped });
  } catch (err) {
    return res.status(500).json({
      message: t(req, "errors.load_countries_failed", { fallback: "Failed to load countries" }),
      error: err.message,
    });
  }
});

/**
 * ✅ ADMIN: GET /api/countries/admin/all
 */
router.get("/admin/all", auth, requireAdmin, async (req, res) => {
  try {
    const countries = await Country.find({}).sort({ createdAt: -1 }).lean();

    const mapped = countries.map((c) => ({
      ...c,
      dialCode: c.dialingCode || null,
      currencyDisplay: c.currencyDisplay || c.currency || null,
    }));

    return res.status(200).json({ countries: mapped });
  } catch (err) {
    return res.status(500).json({
      message: t(req, "errors.load_countries_failed", { fallback: "Failed to load countries" }),
      error: err.message,
    });
  }
});

/**
 * ✅ ADMIN: POST /api/countries
 */
router.post("/", auth, requireAdmin, async (req, res) => {
  try {
    const {
      code,
      countryCode,
      name,
      currency,
      currencyDisplay,
      dialCode,
      dialingCode,
      defaultLanguage = "en",
      supportedLanguages = ["en"],
      timezone = "Africa/Johannesburg",
      isActive = true,
    } = req.body || {};

    const iso2 = normalizeIso2(code || countryCode);
    if (!iso2)
      return res.status(400).json({
        message: t(req, "errors.country_code_required", { fallback: "code/countryCode (ISO2) is required" }),
      });
    if (!name)
      return res.status(400).json({
        message: t(req, "errors.name_required", { fallback: "name is required" }),
      });
    if (!currency)
      return res.status(400).json({
        message: t(req, "errors.currency_required", { fallback: "currency is required" }),
      });

    const dial = normalizeDialCode(dialCode || dialingCode);
    if (!dial)
      return res.status(400).json({
        message: t(req, "errors.dialcode_required", { fallback: "dialCode is required (e.g. +256)" }),
      });

    const exists = await Country.findOne({ code: iso2 }).lean();
    if (exists) return res.status(409).json({ message: t(req, "errors.country_exists", { fallback: "Country already exists" }) });

    const dialExists = await Country.findOne({ dialingCode: dial }).lean();
    if (dialExists) return res.status(409).json({ message: t(req, "errors.dialcode_exists", { fallback: "dialCode already exists" }) });

    const country = await Country.create({
      code: iso2,
      dialingCode: dial,
      name: String(name).trim(),
      currency: String(currency).trim().toUpperCase(),
      currencyDisplay: normalizeCurrencyDisplay(currencyDisplay),
      defaultLanguage: String(defaultLanguage).trim().toLowerCase(),
      supportedLanguages: Array.isArray(supportedLanguages)
        ? supportedLanguages.map((l) => String(l).trim().toLowerCase())
        : [String(defaultLanguage).trim().toLowerCase()],
      timezone: String(timezone).trim(),
      isActive: Boolean(isActive),
      createdBy: req.user?._id || null,
      updatedBy: req.user?._id || null,
    });

    const out = country.toObject();
    out.dialCode = out.dialingCode || null;
    out.currencyDisplay = out.currencyDisplay || out.currency || null;

    return res.status(201).json({
      message: t(req, "countries.created", { fallback: "Country created ✅" }),
      country: out,
    });
  } catch (err) {
    return res.status(500).json({
      message: t(req, "errors.create_failed", { fallback: "Create failed" }),
      error: err.message,
    });
  }
});

/**
 * ✅ ADMIN: PATCH /api/countries/:id
 */
router.patch("/:id", auth, requireAdmin, async (req, res) => {
  try {
    const country = await Country.findById(req.params.id);
    if (!country) return res.status(404).json({ message: t(req, "errors.country_not_found", { fallback: "Country not found" }) });

    const {
      name,
      currency,
      currencyDisplay,
      dialCode,
      dialingCode,
      defaultLanguage,
      supportedLanguages,
      timezone,
      isActive,
    } = req.body || {};

    if (typeof name === "string" && name.trim()) country.name = name.trim();
    if (typeof currency === "string" && currency.trim()) country.currency = currency.trim().toUpperCase();

    if (currencyDisplay !== undefined) {
      country.currencyDisplay = normalizeCurrencyDisplay(currencyDisplay);
    }

    if (dialCode !== undefined || dialingCode !== undefined) {
      const dial = normalizeDialCode(dialCode || dialingCode);
      if (!dial) return res.status(400).json({ message: t(req, "errors.invalid_dialcode", { fallback: "Invalid dialCode ❌" }) });

      const dialExists = await Country.findOne({
        dialingCode: dial,
        _id: { $ne: country._id },
      }).lean();

      if (dialExists) return res.status(409).json({ message: t(req, "errors.dialcode_exists", { fallback: "dialCode already exists" }) });

      country.dialingCode = dial;
    }

    if (typeof defaultLanguage === "string" && defaultLanguage.trim())
      country.defaultLanguage = defaultLanguage.trim().toLowerCase();

    if (Array.isArray(supportedLanguages)) {
      country.supportedLanguages = supportedLanguages.map((l) => String(l).trim().toLowerCase());
    }

    if (typeof timezone === "string" && timezone.trim()) country.timezone = timezone.trim();
    if (typeof isActive === "boolean") country.isActive = isActive;

    country.updatedBy = req.user?._id || null;
    await country.save();

    const out = country.toObject();
    out.dialCode = out.dialingCode || null;
    out.currencyDisplay = out.currencyDisplay || out.currency || null;

    return res.status(200).json({
      message: t(req, "countries.updated", { fallback: "Country updated ✅" }),
      country: out,
    });
  } catch (err) {
    return res.status(500).json({
      message: t(req, "errors.update_failed", { fallback: "Update failed" }),
      error: err.message,
    });
  }
});

export default router;