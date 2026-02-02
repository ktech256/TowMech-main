// backend/src/middleware/auth.js

import jwt from "jsonwebtoken";
import User, { USER_ROLES } from "../models/User.js";

const auth = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No authorization token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    /**
     * ✅ MULTI-COUNTRY SUPPORT (TowMech Global)
     *
     * FIX:
     * - If request has no country header OR it still equals DEFAULT_COUNTRY (ZA),
     *   auto-scope req.countryCode to user.countryCode.
     * - If client explicitly tries to use a DIFFERENT country than user.countryCode,
     *   deny (unless SuperAdmin).
     */
    const DEFAULT_COUNTRY = (process.env.DEFAULT_COUNTRY || "ZA")
      .toString()
      .trim()
      .toUpperCase();

    const reqCountryRaw = (req.countryCode ||
      req.headers["x-country-code"] ||
      DEFAULT_COUNTRY)
      .toString()
      .trim()
      .toUpperCase();

    const userCountry = (user.countryCode || DEFAULT_COUNTRY)
      .toString()
      .trim()
      .toUpperCase();

    const isSuperAdmin = user.role === USER_ROLES.SUPER_ADMIN;

    if (!isSuperAdmin) {
      const reqLooksDefault =
        !reqCountryRaw || reqCountryRaw === DEFAULT_COUNTRY;

      // ✅ auto scope to user country
      if (reqLooksDefault && userCountry) {
        req.countryCode = userCountry;
      } else {
        req.countryCode = reqCountryRaw;
      }

      // ✅ block explicit mismatch attempts
      if (userCountry && req.countryCode && userCountry !== req.countryCode) {
        return res.status(403).json({
          message: "Country mismatch. Access denied.",
          code: "COUNTRY_MISMATCH",
          expected: userCountry,
          received: req.countryCode,
        });
      }
    } else {
      // SuperAdmin can operate across countries
      req.countryCode = reqCountryRaw || DEFAULT_COUNTRY;
    }

    // expose for debugging
    res.setHeader("X-COUNTRY-CODE", req.countryCode);

    /**
     * ✅ SINGLE-DEVICE LOGIN ENFORCEMENT (Providers ONLY)
     */
    const isProvider =
      user.role === USER_ROLES.MECHANIC || user.role === USER_ROLES.TOW_TRUCK;

    if (isProvider) {
      const tokenSid = decoded?.sid || null;
      const dbSid = user?.providerProfile?.sessionId || null;

      if (!tokenSid) {
        return res.status(401).json({
          message: "Session upgrade required. Please login again.",
          code: "SESSION_UPGRADE_REQUIRED",
        });
      }

      if (!dbSid) {
        return res.status(401).json({
          message: "Session not initialized. Please login again.",
          code: "SESSION_NOT_INITIALIZED",
        });
      }

      if (tokenSid !== dbSid) {
        return res.status(401).json({
          message: "Logged in on another phone. Please login again.",
          code: "SESSION_REPLACED",
        });
      }
    }

    /**
     * ✅ Role-based reason visibility
     */
    const canSeeReasons = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(
      user.role
    );

    /**
     * ✅ BLOCK users based on accountStatus
     */
    const status = user.accountStatus || {};

    if (!isSuperAdmin) {
      if (status.isArchived) {
        return res.status(403).json({
          message: "Account archived. Access denied.",
        });
      }

      if (status.isBanned) {
        return res.status(403).json({
          message: "Account banned. Access denied.",
          ...(canSeeReasons && { reason: status.banReason || null }),
        });
      }

      if (status.isSuspended) {
        return res.status(403).json({
          message: "Account suspended. Access denied.",
          ...(canSeeReasons && { reason: status.suspendReason || null }),
        });
      }
    }

    // attach user to req
    req.user = user;

    return next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

export default auth;