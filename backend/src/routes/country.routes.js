// backend/src/constants/countries.js

/**
 * TowMech Global Countries (ISO 3166-1 alpha-2)
 * - Used for validation + defaults
 * - You can add/remove anytime without breaking DB
 */

export const DEFAULT_COUNTRY_CODE = process.env.DEFAULT_COUNTRY || "ZA";

/**
 * Minimal safe global list (worldwide)
 * If you want, we can later replace this with a DB-driven list (Country model)
 */
export const COUNTRY_LIST = [
  // =========================
  // AFRICA
  // =========================
  "DZ","AO","BJ","BW","BF","BI","CV","CM","CF","TD","KM","CG","CD","CI","DJ","EG","GQ","ER","SZ","ET",
  "GA","GM","GH","GN","GW","KE","LS","LR","LY","MG","MW","ML","MR","MU","MA","MZ","NA","NE","NG","RW",
  "ST","SN","SC","SL","SO","ZA","SS","SD","TZ","TG","TN","UG","ZM","ZW",

  // =========================
  // EUROPE
  // =========================
  "AL","AD","AM","AT","AZ","BY","BE","BA","BG","HR","CY","CZ","DK","EE","FI","FR","GE","DE","GR","HU",
  "IS","IE","IT","KZ","XK","LV","LI","LT","LU","MT","MD","MC","ME","NL","MK","NO","PL","PT","RO","RU",
  "SM","RS","SK","SI","ES","SE","CH","TR","UA","GB","VA",

  // =========================
  // ASIA
  // =========================
  "AF","BH","BD","BT","BN","KH","CN","HK","IN","ID","IR","IQ","IL","JP","JO","KW","KG","LA","LB","MO",
  "MY","MV","MN","MM","NP","KP","OM","PK","PH","QA","SA","SG","KR","LK","SY","TW","TJ","TH","TL","TM",
  "AE","UZ","VN","YE",

  // =========================
  // NORTH AMERICA
  // =========================
  "AG","BS","BB","BZ","CA","CR","CU","DM","DO","SV","GD","GT","HT","HN","JM","MX","NI","PA","KN","LC",
  "VC","TT","US",

  // =========================
  // SOUTH AMERICA
  // =========================
  "AR","BO","BR","CL","CO","EC","GY","PY","PE","SR","UY","VE",

  // =========================
  // OCEANIA
  // =========================
  "AU","FJ","KI","MH","FM","NR","NZ","PW","PG","WS","SB","TO","TV","VU",
];

/**
 * Fast lookup set
 */
export const COUNTRY_SET = new Set(COUNTRY_LIST);

/**
 * Helper: validate ISO2 country code
 */
export function isValidCountryCode(code) {
  if (!code) return false;
  const c = String(code).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) && COUNTRY_SET.has(c);
}

/**
 * Helper: normalize ISO2 country code (returns DEFAULT if invalid)
 */
export function normalizeCountryCode(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return DEFAULT_COUNTRY_CODE;
  if (!COUNTRY_SET.has(c)) return DEFAULT_COUNTRY_CODE;
  return c;
}