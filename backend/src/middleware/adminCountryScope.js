// backend/src/middleware/adminCountryScope.js

/**
 * Enforces "country workspace" scoping for admin dashboard routes.
 *
 * Rules:
 * - Admin without canSwitchCountryWorkspace: locked to their own user.countryCode
 * - SuperAdmin OR Admin with canSwitchCountryWorkspace: can select country via header (x-country-code)
 *
 * Result:
 * - req.countryCode is ALWAYS set (effective workspace country)
 * - req.canSwitchCountryWorkspace boolean is set
 */

export default function adminCountryScope(req, res, next) {
  try {
    const user = req.user || {};
    const role = String(user.role || "");

    const perms = (user.permissions && typeof user.permissions === "object")
      ? user.permissions
      : {};

    const canSwitch =
      role === "SuperAdmin" || perms.canSwitchCountryWorkspace === true;

    // Accept country from header/query/body (dashboard should send x-country-code)
    const fromHeader =
      req.headers["x-country-code"] ||
      req.headers["x-country"] ||
      req.headers["countrycode"] ||
      req.headers["country"];

    const fromQuery = req.query?.countryCode || req.query?.country;
    const fromBody = req.body?.countryCode || req.body?.country;

    const requested =
      (fromHeader || fromQuery || fromBody || "")
        .toString()
        .trim()
        .toUpperCase();

    const userCC =
      (user.countryCode || process.env.DEFAULT_COUNTRY || "ZA")
        .toString()
        .trim()
        .toUpperCase();

    // Effective country:
    // - If can switch AND a country is requested -> use requested
    // - Else -> lock to the admin's own country
    const effectiveCountryCode = canSwitch && requested ? requested : userCC;

    req.countryCode = effectiveCountryCode;
    req.canSwitchCountryWorkspace = canSwitch;

    return next();
  } catch (e) {
    // fail safe: never allow cross-country by accident
    req.countryCode =
      (req.user?.countryCode || process.env.DEFAULT_COUNTRY || "ZA")
        .toString()
        .trim()
        .toUpperCase();
    req.canSwitchCountryWorkspace =
      String(req.user?.role || "") === "SuperAdmin" ||
      req.user?.permissions?.canSwitchCountryWorkspace === true;

    return next();
  }
}