import {
  submitRating,
  adminListRatings,
  adminGetRatingById,
} from "../services/rating.service.js";
import { USER_ROLES } from "../models/User.js";

/**
 * ✅ POST /api/jobs/rate  (Called by Mobile App)
 */
export async function submitRatingController(req, res) {
  try {
    const { jobId, rating, comment } = req.body || {};

    const result = await submitRating({
      userId: req.user._id,
      jobId,
      rating,
      comment,
    });

    return res.status(201).json({
      success: true,
      message: "Rating submitted ✅",
      ratingId: result.created?._id,
      updatedStats: result.stats,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ message: "You already rated this job" });
    }

    const status = err.statusCode || 500;
    return res.status(status).json({
      message: err.message || "Could not submit rating",
    });
  }
}

/**
 * ✅ GET /api/admin/ratings
 * Dashboard list + filters
 */
export async function adminListRatingsController(req, res) {
  try {
    // Only Admin / SuperAdmin
    if (![USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(req.user.role)) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const result = await adminListRatings(req.query || {});
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to load ratings" });
  }
}

/**
 * ✅ GET /api/admin/ratings/:id
 * Dashboard view details
 */
export async function adminGetRatingController(req, res) {
  try {
    if (![USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(req.user.role)) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const rating = await adminGetRatingById(req.params.id);
    return res.status(200).json({ rating });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ message: err.message || "Failed to load rating" });
  }
}