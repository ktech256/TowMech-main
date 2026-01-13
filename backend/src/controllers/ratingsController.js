import {
  createRatingAndUpdateStats,
  listRatingsAdmin,
  getRatingByIdAdmin,
} from "../services/rating.service.js";

export async function submitRating(req, res) {
  try {
    const { jobId, rating, comment } = req.body;

    if (!jobId) return res.status(400).json({ message: "jobId is required" });
    if (typeof rating !== "number")
      return res.status(400).json({ message: "rating must be a number" });
    if (rating < 1 || rating > 5)
      return res.status(400).json({ message: "rating must be 1..5" });

    const result = await createRatingAndUpdateStats({
      raterId: req.user._id,
      jobId,
      rating,
      comment,
    });

    return res.status(201).json({
      success: true,
      message: "Rating submitted ✅",
      rating: result,
    });
  } catch (err) {
    console.error("❌ submitRating error:", err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || "Failed to submit rating",
    });
  }
}

export async function adminListRatings(req, res) {
  try {
    const { page, limit, search, minStars, maxStars } = req.query;

    const data = await listRatingsAdmin({
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      search: search ? String(search) : "",
      minStars: minStars !== undefined ? Number(minStars) : undefined,
      maxStars: maxStars !== undefined ? Number(maxStars) : undefined,
    });

    return res.status(200).json({ success: true, ...data });
  } catch (err) {
    console.error("❌ adminListRatings error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load ratings",
    });
  }
}

export async function adminGetRatingById(req, res) {
  try {
    const { id } = req.params;

    const rating = await getRatingByIdAdmin(id);
    if (!rating)
      return res.status(404).json({ success: false, message: "Rating not found" });

    return res.status(200).json({ success: true, rating });
  } catch (err) {
    console.error("❌ adminGetRatingById error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load rating",
    });
  }
}