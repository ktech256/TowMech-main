// backend/src/routes/rating.routes.js
import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";
import CountryServiceConfig from "../models/CountryServiceConfig.js";

import {
  submitRating,
  adminListRatings,
  adminGetRatingById,
} from "../controllers/ratingsController.js";

const router = express.Router();

function resolveReqCountryCode(req) {
  return (
    req.countryCode ||
    req.headers["x-country-code"] ||
    req.query?.country ||
    req.query?.countryCode ||
    req.body?.countryCode ||
    process.env.DEFAULT_COUNTRY ||
    "ZA"
  )
    .toString()
    .trim()
    .toUpperCase();
}

async function ratingsEnabledMiddleware(req, res, next) {
  try {
    const cc = resolveReqCountryCode(req);
    const cfg = await CountryServiceConfig.findOne({ countryCode: cc }).select("services.ratingsEnabled").lean();
    const enabled = typeof cfg?.services?.ratingsEnabled === "boolean" ? cfg.services.ratingsEnabled : true;
    if (!enabled) return res.status(403).json({ message: "Ratings are disabled in this country." });
    return next();
  } catch (err) {
    return res.status(500).json({ message: "Service check failed", error: err.message });
  }
}

/**
 * ✅ POST /api/jobs/rate
 * Mounted as: app.use("/api/jobs", ratingRoutes)
 */
router.post(
  "/rate",
  auth,
  authorizeRoles(USER_ROLES.CUSTOMER, USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK),
  ratingsEnabledMiddleware,
  submitRating
);

/**
 * ✅ Admin routes unchanged
 */
router.get(
  "/ratings",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  adminListRatings
);

router.get(
  "/ratings/:id",
  auth,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  adminGetRatingById
);

export default router;