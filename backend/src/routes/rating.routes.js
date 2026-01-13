import express from "express";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";

import {
  submitRating,
  adminListRatings,
  adminGetRatingById,
} from "../controllers/ratingsController.js";

const router = express.Router();

/**
 * ✅ POST /api/jobs/rate
 * Mounted as: app.use("/api/jobs", ratingRoutes)
 */
router.post(
  "/rate",
  auth,
  authorizeRoles(USER_ROLES.CUSTOMER, USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK),
  submitRating
);

/**
 * ✅ GET /api/admin/ratings
 * ✅ GET /api/admin/ratings/:id
 * Mounted as: app.use("/api/admin", ratingRoutes)
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