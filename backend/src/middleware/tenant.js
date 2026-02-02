// backend/src/middleware/tenant.js

/**
 * TowMech Global Tenant Middleware
 * - Determines active country for every request
 * - Sets: req.countryCode
 *
 * Priority:
 * 1) Header: X-COUNTRY-CODE
 * 2) Query: ?country=ZA
 * 3) Body: { countryCode: "ZA" }
 * 4) Default: DEFAULT_COUNTRY (env) or "ZA"
 */

const DEFAULT_COUNTRY = (process.env.DEFAULT_COUNTRY || "ZA")
  .toString()
  .trim()
  .toUpperCase();

const normalizeCountryCode = (value) => {
  if (!value) return null;

  const code = String(value).trim().toUpperCase();

  // ISO 3166-1 alpha-2 (ZA, KE, UG, US, GB, etc)
  if (!/^[A-Z]{2}$/.test(code)) return null;

  return code;
};

export const tenantMiddleware = (req, res, next) => {
  try {
    const headerCountry = req.headers["x-country-code"];
    const queryCountry = req.query?.country;
    const bodyCountry = req.body?.countryCode;

    const countryCode =
      normalizeCountryCode(headerCountry) ||
      normalizeCountryCode(queryCountry) ||
      normalizeCountryCode(bodyCountry) ||
      DEFAULT_COUNTRY;

    req.countryCode = countryCode;

    // expose for debugging
    res.setHeader("X-COUNTRY-CODE", countryCode);

    return next();
  } catch (err) {
    console.error("❌ tenantMiddleware error:", err);
    req.countryCode = DEFAULT_COUNTRY;
    return next();
  }
};

export default tenantMiddleware;