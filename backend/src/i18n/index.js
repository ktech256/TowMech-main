// backend/src/i18n/index.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Folder: backend/src/i18n/locales
const LOCALES_DIR = path.join(__dirname, "locales");

// cache: { en: {...}, sw: {...} }
const CACHE = new Map();

function safeReadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
}

function loadLocale(lang) {
  const key = String(lang || "en").trim().toLowerCase();
  if (CACHE.has(key)) return CACHE.get(key);

  const filePath = path.join(LOCALES_DIR, `${key}.json`);
  const data = safeReadJson(filePath);

  // fallback to en if missing
  if (!data && key !== "en") return loadLocale("en");

  const finalData = data || {};
  CACHE.set(key, finalData);
  return finalData;
}

function resolveSupportedLanguagesFromEnvOrDisk() {
  // If you want, you can control this with env: SUPPORTED_LANGUAGES=en,sw,pt
  const env = String(process.env.SUPPORTED_LANGUAGES || "").trim();
  if (env) {
    return env
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
  }

  // else: use whatever json files exist in locales folder
  try {
    if (!fs.existsSync(LOCALES_DIR)) return ["en"];
    const files = fs.readdirSync(LOCALES_DIR);
    const langs = files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", "").toLowerCase())
      .filter(Boolean);

    return langs.length ? langs : ["en"];
  } catch (_e) {
    return ["en"];
  }
}

export function getSupportedLanguages() {
  return resolveSupportedLanguagesFromEnvOrDisk();
}

/**
 * Pick language from:
 * - X-LANGUAGE
 * - Accept-Language (first tag)
 * - fallback "en"
 *
 * Then clamp to supported languages on disk.
 */
export function resolveLanguage(req) {
  const supported = getSupportedLanguages();

  const xLang = req.headers["x-language"] || req.headers["X-LANGUAGE"];
  const accept = req.headers["accept-language"] || req.headers["Accept-Language"];

  const raw = String(xLang || accept || "en").trim();
  const first = raw.split(",")[0]?.trim() || "en"; // "en-US,en;q=0.9" -> "en-US"

  // normalize: "en-US" -> "en"
  const base = first.split("-")[0]?.toLowerCase() || "en";

  return supported.includes(base) ? base : "en";
}

/**
 * Translate key using dot notation:
 * t("auth.otp_sent")
 */
export function translate(lang, key, vars = {}) {
  const dict = loadLocale(lang);

  // support dot keys
  const parts = String(key || "").split(".");
  let cur = dict;

  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) cur = cur[p];
    else {
      // fallback
      return vars.fallback || key;
    }
  }

  if (typeof cur !== "string") return vars.fallback || key;

  // simple {name} replacement
  return cur.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars?.[k];
    return v === undefined || v === null ? "" : String(v);
  });
}