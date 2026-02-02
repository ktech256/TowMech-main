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
     * Ensure req.countryCode exists (from tenant middleware).
     * If user has a countryCode, enforce that the request is scoped correctly.
     */
    const reqCountry = (req.countryCode || req.headers["x-country-code"] || "ZA")
      .toString()
      .trim()
      .toUpperCase();

    const userCountry = (user.countryCode || "").toString().trim().toUpperCase();

    // Only enforce if user has a country set.
    // SuperAdmin can bypass cross-country restriction.
    const isSuperAdmin = user.role === USER_ROLES.SUPER_ADMIN;

    if (!isSuperAdmin && userCountry && reqCountry && userCountry !== reqCountry) {
      return res.status(403).json({
        message: "Country mismatch. Access denied.",
        code: "COUNTRY_MISMATCH",
      });
    }

    /**
     * ✅ SINGLE-DEVICE LOGIN ENFORCEMENT (Providers ONLY)
     * - Only Mechanic + TowTruck are restricted to 1 phone session.
     * - Token is NOT auto-expired by time.
     * - Token becomes invalid ONLY when the provider logs in on another phone
     *   (because providerProfile.sessionId changes in DB).
     */
    const isProvider =
      user.role === USER_ROLES.MECHANIC || user.role === USER_ROLES.TOW_TRUCK;

    if (isProvider) {
      const tokenSid = decoded?.sid || null;
      const dbSid = user?.providerProfile?.sessionId || null;

      // If token has no sid, it means it was issued before we added session enforcement.
      // Force re-login once (only for providers) so the system becomes consistent.
      if (!tokenSid) {
        return res.status(401).json({
          message: "Session upgrade required. Please login again.",
          code: "SESSION_UPGRADE_REQUIRED",
        });
      }

      // If DB has no sid (older user record), also require login once.
      if (!dbSid) {
        return res.status(401).json({
          message: "Session not initialized. Please login again.",
          code: "SESSION_NOT_INITIALIZED",
        });
      }

      // Main enforcement: if mismatch -> logged in elsewhere
      if (tokenSid !== dbSid) {
        return res.status(401).json({
          message: "Logged in on another phone. Please login again.",
          code: "SESSION_REPLACED",
        });
      }
    }

    /**
     * ✅ Role-based reason visibility
     * Only Admin + SuperAdmin can see ban/suspend reasons
     */
    const canSeeReasons = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(user.role);

    /**
     * ✅ BLOCK users based on accountStatus
     */
    const status = user.accountStatus || {};

    if (!isSuperAdmin) {
      // ✅ Archived = blocked always
      if (status.isArchived) {
        return res.status(403).json({
          message: "Account archived. Access denied.",
        });
      }

      // ✅ Banned
      if (status.isBanned) {
        return res.status(403).json({
          message: "Account banned. Access denied.",
          ...(canSeeReasons && { reason: status.banReason || null }),
        });
      }

      // ✅ Suspended
      if (status.isSuspended) {
        return res.status(403).json({
          message: "Account suspended. Access denied.",
          ...(canSeeReasons && { reason: status.suspendReason || null }),
        });
      }
    }

    /**
     * ✅ Attach user to req
     * NOTE: req.user still includes providerProfile, but not password.
     */
    req.user = user;

    return next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

export default auth;