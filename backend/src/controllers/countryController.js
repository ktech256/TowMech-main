// src/controllers/countryController.js
import Country from "../models/Country.js";
import CountryServiceConfig from "../models/CountryServiceConfig.js";
import CountryUiConfig from "../models/CountryUiConfig.js";
import { ALL_COUNTRIES } from "../constants/countries.js";

/**
 * Helpers
 */
function normCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase();
}

function pickString(v, fallback = null) {
  if (typeof v !== "string") return fallback;
  const s = v.trim();
  return s ? s : fallback;
}

/**
 * ✅ Public: list active public countries (for app Country picker)
 * GET /api/config/countries
 */
export async function listPublicCountries(req, res) {
  try {
    const countries = await Country.find({ isActive: true, isPublic: true })
      .sort({ name: 1 })
      .select(
        "code name flagEmoji currencyCode currencySymbol timezone languages defaultLanguage phoneRules dialingCode isActive isPublic region"
      );

    return res.status(200).json({ countries });
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
 */
export async function listAllCountries(req, res) {
  try {
    const countries = await Country.find({})
      .sort({ name: 1 })
      .select(
        "code name flagEmoji currencyCode currencySymbol timezone languages defaultLanguage phoneRules dialingCode isActive isPublic region tax createdAt updatedAt"
      );

    return res.status(200).json({ countries });
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

      if (!existing) {
        await Country.create({
          code,
          name: c.name,
          flagEmoji: c.flagEmoji || null,
          currencyCode: c.currencyCode || "USD",
          currencySymbol: c.currencySymbol || null,
          timezone: c.timezone || "UTC",
          languages: Array.isArray(c.languages) && c.languages.length ? c.languages : ["en"],
          defaultLanguage: c.defaultLanguage || "en",
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
      if ((!existing.languages || existing.languages.length === 0) && Array.isArray(c.languages)) {
        existing.languages = c.languages;
        dirty = true;
      }
      if (!existing.defaultLanguage && c.defaultLanguage) {
        existing.defaultLanguage = c.defaultLanguage;
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
      if (
        (!existing.phoneRules || Object.keys(existing.phoneRules || {}).length === 0) &&
        c.phoneRules
      ) {
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
 */
export async function upsertCountry(req, res) {
  try {
    const code = normCode(req.params.code);
    if (!code) return res.status(400).json({ message: "Invalid country code" });

    const body = req.body || {};

    const update = {
      code,
      name: pickString(body.name),
      flagEmoji: pickString(body.flagEmoji),
      currencyCode: pickString(body.currencyCode, "USD")?.toUpperCase(),
      currencySymbol: pickString(body.currencySymbol),
      timezone: pickString(body.timezone, "UTC"),
      languages:
        Array.isArray(body.languages) && body.languages.length
          ? body.languages.map((x) => String(x).trim()).filter(Boolean)
          : undefined,
      defaultLanguage: pickString(body.defaultLanguage, "en"),
      region: pickString(body.region, "GLOBAL"),
      phoneRules: typeof body.phoneRules === "object" && body.phoneRules ? body.phoneRules : undefined,

      // ✅ new (optional): dialingCode
      dialingCode: pickString(body.dialingCode),

      isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
      isPublic: typeof body.isPublic === "boolean" ? body.isPublic : undefined,
      tax: typeof body.tax === "object" && body.tax ? body.tax : undefined,
    };

    // remove undefined keys
    Object.keys(update).forEach((k) => update[k] === undefined && delete update[k]);

    const country = await Country.findOneAndUpdate(
      { code },
      { $set: update },
      { new: true, upsert: true }
    );

    // Ensure configs exist for this country (service/ui)
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

    return res.status(200).json({ message: "Country saved ✅", country });
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

    return res.status(200).json({ message: "Country status updated ✅", country });
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
      country,
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