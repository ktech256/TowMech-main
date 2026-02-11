// src/controllers/countryController.js
import Country from "../models/Country.js";
import CountryServiceConfig from "../models/CountryServiceConfig.js";
import CountryUiConfig from "../models/CountryUiConfig.js";
import { ALL_COUNTRIES } from "../constants/countries.js";

/**
 * Helpers
 */
function normCode(code) {
  return String(code || "").trim().toUpperCase();
}

function pickString(v, fallback = null) {
  if (typeof v !== "string") return fallback;
  const s = v.trim();
  return s ? s : fallback;
}

// ✅ Language normalization (controller safety net)
const LANGUAGE_NAME_TO_TAG = {
  english: "en",
  afrikaans: "af",
  swahili: "sw",
  kiswahili: "sw",
  isizulu: "zu",
  isixhosa: "xh",
  sesotho: "st",
  "sesotho sa leboa": "nso",
  setswana: "tn",
  xitsonga: "ts",
  siswati: "ss",
  swati: "ss",
  venda: "ve",
  tshivenda: "ve",
};

function looksLikeLangTag(v) {
  return /^[A-Za-z]{2,3}([_-][A-Za-z]{4})?([_-][A-Za-z]{2}|\d{3})?([_-][A-Za-z0-9]{5,8})*$/.test(
    String(v || "").trim()
  );
}

function normLangTag(v) {
  const raw = String(v || "").trim();
  if (!raw) return "en";

  const byName = LANGUAGE_NAME_TO_TAG[raw.toLowerCase()];
  if (byName) return byName;

  if (looksLikeLangTag(raw)) {
    const cleaned = raw.replace(/_/g, "-").replace(/\s+/g, "");
    const parts = cleaned.split("-").filter(Boolean);
    if (parts.length) {
      parts[0] = parts[0].toLowerCase();
      for (let i = 1; i < parts.length; i++) {
        if (parts[i].length === 2) parts[i] = parts[i].toUpperCase();
        else if (parts[i].length === 4)
          parts[i] = parts[i].charAt(0).toUpperCase() + parts[i].slice(1).toLowerCase();
      }
    }
    return parts.join("-");
  }

  const simplified = raw
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return LANGUAGE_NAME_TO_TAG[simplified] || "en";
}

function normLangList(list) {
  if (!Array.isArray(list)) return undefined;
  const out = [];
  const seen = new Set();
  for (const x of list) {
    const t = normLangTag(x);
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.length ? out : ["en"];
}

// ✅ Ensure the app always receives BOTH supportedLanguages + languages in a consistent way
function normalizeCountryForApp(doc) {
  if (!doc) return doc;
  const obj = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };

  // Prefer supportedLanguages as canonical
  const sl =
    Array.isArray(obj.supportedLanguages) && obj.supportedLanguages.length
      ? obj.supportedLanguages
      : Array.isArray(obj.languages) && obj.languages.length
        ? obj.languages
        : ["en"];

  const normalizedSupported = normLangList(sl) || ["en"];

  obj.supportedLanguages = normalizedSupported;
  obj.languages = normalizedSupported;

  obj.defaultLanguage = normLangTag(obj.defaultLanguage || "en");

  return obj;
}

/**
 * ✅ Public: list active public countries (for app Country picker)
 * GET /api/config/countries
 *
 * LANGUAGE FIX:
 * - Some DBs previously used `languages`; new model uses `supportedLanguages`.
 * - We always return both fields to the app (and normalized tags).
 * - We DO NOT hard-require `isPublic:true` because older schemas/records may not have it.
 */
export async function listPublicCountries(req, res) {
  try {
    // ✅ Keep public filtering flexible to avoid breaking old records:
    // - Must be active
    // - If isPublic exists, allow true; if missing, still allow (legacy docs)
    const countries = await Country.find({
      isActive: true,
      $or: [{ isPublic: true }, { isPublic: { $exists: false } }],
    })
      .sort({ name: 1 })
      .select(
        // ✅ include both supportedLanguages + languages, and defaultLanguage
        "code name flagEmoji currencyCode currencySymbol timezone supportedLanguages languages defaultLanguage phoneRules dialingCode isActive isPublic region"
      );

    const normalized = (countries || []).map(normalizeCountryForApp);

    return res.status(200).json({ countries: normalized });
  } catch (err) {
    return res.status(500).json({
      message: "Failed to fetch countries",
      error: err.message,
    });
  }
}

/**
 * ✅ Admin: list all countries (including inactive/private)
 * GET /api/admin/countries
 *
 * LANGUAGE FIX:
 * - Always return normalized supportedLanguages + languages + defaultLanguage.
 */
export async function listAllCountries(req, res) {
  try {
    const countries = await Country.find({})
      .sort({ name: 1 })
      .select(
        "code name flagEmoji currencyCode currencySymbol timezone supportedLanguages languages defaultLanguage phoneRules dialingCode isActive isPublic region tax createdAt updatedAt"
      );

    const normalized = (countries || []).map(normalizeCountryForApp);

    return res.status(200).json({ countries: normalized });
  } catch (err) {
    return res.status(500).json({
      message: "Failed to fetch countries",
      error: err.message,
    });
  }
}

/**
 * ✅ Admin: seed countries from constants (safe upsert)
 * POST /api/admin/countries/seed
 * - Will create missing countries
 * - Will NOT overwrite existing records unless fields are missing
 *
 * LANGUAGE FIX:
 * - Writes supportedLanguages (and also writes languages for backward compatibility responses)
 * - Normalizes to tags
 */
export async function seedCountries(req, res) {
  try {
    const entries = Array.isArray(ALL_COUNTRIES) ? ALL_COUNTRIES : [];
    if (entries.length === 0) {
      return res.status(400).json({ message: "No seed countries found" });
    }

    let created = 0;
    let updated = 0;

    for (const c of entries) {
      const code = normCode(c.code);
      if (!code) continue;

      const existing = await Country.findOne({ code });

      // ✅ detect dialing code from constants (supports multiple shapes)
      const seedDialingCode =
        c.dialingCode ||
        (c.phoneRules && (c.phoneRules.dialingCode || c.phoneRules.countryDialingCode)) ||
        null;

      // ✅ normalize languages from constants
      const seedLangsRaw =
        (Array.isArray(c.supportedLanguages) && c.supportedLanguages.length && c.supportedLanguages) ||
        (Array.isArray(c.languages) && c.languages.length && c.languages) ||
        ["en"];
      const seedLangs = normLangList(seedLangsRaw) || ["en"];

      const seedDefaultLang = normLangTag(c.defaultLanguage || "en");

      if (!existing) {
        await Country.create({
          code,
          name: c.name,
          flagEmoji: c.flagEmoji || null,
          currencyCode: c.currencyCode || "USD",
          currencySymbol: c.currencySymbol || null,
          timezone: c.timezone || "UTC",

          // ✅ canonical
          supportedLanguages: seedLangs,
          // ✅ keep legacy field for old clients if schema allows it (if not in schema, it will be ignored safely)
          languages: seedLangs,
          defaultLanguage: seedDefaultLang,

          region: c.region || "GLOBAL",
          phoneRules: c.phoneRules || {},
          dialingCode: seedDialingCode,
          isActive: c.isActive !== false,
          isPublic: c.isPublic !== false,
          tax: c.tax || { vatPercent: 0, vatName: "VAT", pricesIncludeVat: false },
        });
        created++;
        continue;
      }

      // Fill missing fields only (don’t overwrite custom admin edits)
      let dirty = false;

      if (!existing.name && c.name) {
        existing.name = c.name;
        dirty = true;
      }
      if (!existing.currencyCode && c.currencyCode) {
        existing.currencyCode = c.currencyCode;
        dirty = true;
      }
      if (!existing.timezone && c.timezone) {
        existing.timezone = c.timezone;
        dirty = true;
      }

      // ✅ LANGUAGE FIX: fill supportedLanguages if missing
      if (
        ((!existing.supportedLanguages || existing.supportedLanguages.length === 0) &&
          Array.isArray(seedLangs) &&
          seedLangs.length) ||
        ((!existing.languages || existing.languages.length === 0) &&
          Array.isArray(seedLangs) &&
          seedLangs.length)
      ) {
        existing.supportedLanguages = seedLangs;
        existing.languages = seedLangs;
        dirty = true;
      }

      if (!existing.defaultLanguage && seedDefaultLang) {
        existing.defaultLanguage = seedDefaultLang;
        dirty = true;
      }

      if (!existing.region && c.region) {
        existing.region = c.region;
        dirty = true;
      }
      if (!existing.flagEmoji && c.flagEmoji) {
        existing.flagEmoji = c.flagEmoji;
        dirty = true;
      }
      if (!existing.currencySymbol && c.currencySymbol) {
        existing.currencySymbol = c.currencySymbol;
        dirty = true;
      }
      if ((!existing.phoneRules || Object.keys(existing.phoneRules || {}).length === 0) && c.phoneRules) {
        existing.phoneRules = c.phoneRules;
        dirty = true;
      }

      // ✅ new: fill dialingCode if missing
      if (!existing.dialingCode && seedDialingCode) {
        existing.dialingCode = seedDialingCode;
        dirty = true;
      }

      if (dirty) {
        await existing.save();
        updated++;
      }
    }

    return res.status(200).json({
      message: "Countries seeded ✅",
      created,
      updated,
      totalSeed: entries.length,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Failed to seed countries",
      error: err.message,
    });
  }
}

/**
 * ✅ Admin: create/update a country
 * PUT /api/admin/countries/:code
 *
 * LANGUAGE FIX:
 * - Accept either supportedLanguages or languages
 * - Normalize to tags
 * - Persist supportedLanguages (canonical) and also set languages for legacy responses
 */
export async function upsertCountry(req, res) {
  try {
    const code = normCode(req.params.code);
    if (!code) return res.status(400).json({ message: "Invalid country code" });

    const body = req.body || {};

    const incomingLangs =
      Array.isArray(body.supportedLanguages) && body.supportedLanguages.length
        ? body.supportedLanguages
        : Array.isArray(body.languages) && body.languages.length
          ? body.languages
          : undefined;

    const normalizedLangs = incomingLangs ? normLangList(incomingLangs) : undefined;

    const update = {
      code,
      name: pickString(body.name),
      flagEmoji: pickString(body.flagEmoji),
      currencyCode: pickString(body.currencyCode, "USD")?.toUpperCase(),
      currencySymbol: pickString(body.currencySymbol),
      timezone: pickString(body.timezone, "UTC"),

      // ✅ canonical storage
      supportedLanguages: normalizedLangs,
      // ✅ legacy response field (if schema allows it)
      languages: normalizedLangs,

      defaultLanguage: normLangTag(pickString(body.defaultLanguage, "en")),

      region: pickString(body.region, "GLOBAL"),
      phoneRules: typeof body.phoneRules === "object" && body.phoneRules ? body.phoneRules : undefined,
      dialingCode: pickString(body.dialingCode),

      isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
      isPublic: typeof body.isPublic === "boolean" ? body.isPublic : undefined,
      tax: typeof body.tax === "object" && body.tax ? body.tax : undefined,
    };

    Object.keys(update).forEach((k) => update[k] === undefined && delete update[k]);

    const country = await Country.findOneAndUpdate(
      { code },
      { $set: update },
      { new: true, upsert: true }
    );

    await CountryServiceConfig.findOneAndUpdate(
      { countryCode: code },
      { $setOnInsert: { countryCode: code } },
      { upsert: true }
    );

    await CountryUiConfig.findOneAndUpdate(
      { countryCode: code },
      { $setOnInsert: { countryCode: code } },
      { upsert: true }
    );

    return res.status(200).json({ message: "Country saved ✅", country: normalizeCountryForApp(country) });
  } catch (err) {
    return res.status(500).json({
      message: "Failed to save country",
      error: err.message,
    });
  }
}

/**
 * ✅ Admin: toggle country active/public quickly
 * PATCH /api/admin/countries/:code/status
 */
export async function updateCountryStatus(req, res) {
  try {
    const code = normCode(req.params.code);
    if (!code) return res.status(400).json({ message: "Invalid country code" });

    const { isActive, isPublic } = req.body || {};

    const update = {};
    if (typeof isActive === "boolean") update.isActive = isActive;
    if (typeof isPublic === "boolean") update.isPublic = isPublic;

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    const country = await Country.findOneAndUpdate({ code }, { $set: update }, { new: true });
    if (!country) return res.status(404).json({ message: "Country not found" });

    return res.status(200).json({ message: "Country status updated ✅", country: normalizeCountryForApp(country) });
  } catch (err) {
    return res.status(500).json({
      message: "Failed to update country status",
      error: err.message,
    });
  }
}

/**
 * ✅ Admin: get country + configs (service/ui) in one call
 * GET /api/admin/countries/:code/details
 */
export async function getCountryDetails(req, res) {
  try {
    const code = normCode(req.params.code);
    if (!code) return res.status(400).json({ message: "Invalid country code" });

    const [country, services, ui] = await Promise.all([
      Country.findOne({ code }),
      CountryServiceConfig.findOne({ countryCode: code }),
      CountryUiConfig.findOne({ countryCode: code }),
    ]);

    if (!country) return res.status(404).json({ message: "Country not found" });

    return res.status(200).json({
      country: normalizeCountryForApp(country),
      serviceConfig: services || null,
      uiConfig: ui || null,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Failed to fetch country details",
      error: err.message,
    });
  }
}

/**
 * ✅ Admin: delete a country (normally you won't, but keep for maintenance)
 * DELETE /api/admin/countries/:code
 */
export async function deleteCountry(req, res) {
  try {
    const code = normCode(req.params.code);
    if (!code) return res.status(400).json({ message: "Invalid country code" });

    await Promise.all([
      Country.deleteOne({ code }),
      CountryServiceConfig.deleteOne({ countryCode: code }),
      CountryUiConfig.deleteOne({ countryCode: code }),
    ]);

    return res.status(200).json({ message: "Country deleted ✅" });
  } catch (err) {
    return res.status(500).json({
      message: "Failed to delete country",
      error: err.message,
    });
  }
}