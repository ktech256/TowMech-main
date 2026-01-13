import mongoose from "mongoose";
import Rating from "../models/Rating.js";
import Job, { JOB_STATUSES } from "../models/Job.js";
import User, { USER_ROLES } from "../models/User.js";

/**
 * ✅ Recompute ratingStats on a User
 * Updates:
 *  - ratingStats.asProvider.avg + count  (if toRole != Customer)
 *  - ratingStats.asCustomer.avg + count  (if toRole == Customer)
 */
export async function recomputeUserRatingStats(userId) {
  const targetId = new mongoose.Types.ObjectId(userId);

  // Provider stats: toRole != "Customer"
  const providerAgg = await Rating.aggregate([
    { $match: { toUser: targetId, toRole: { $ne: USER_ROLES.CUSTOMER } } },
    { $group: { _id: "$toUser", avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);

  // Customer stats: toRole == "Customer"
  const customerAgg = await Rating.aggregate([
    { $match: { toUser: targetId, toRole: USER_ROLES.CUSTOMER } },
    { $group: { _id: "$toUser", avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);

  const providerStats = providerAgg[0]
    ? { avg: Number(providerAgg[0].avg.toFixed(2)), count: providerAgg[0].count }
    : { avg: 0, count: 0 };

  const customerStats = customerAgg[0]
    ? { avg: Number(customerAgg[0].avg.toFixed(2)), count: customerAgg[0].count }
    : { avg: 0, count: 0 };

  await User.findByIdAndUpdate(userId, {
    $set: {
      "ratingStats.asProvider": providerStats,
      "ratingStats.asCustomer": customerStats,
    },
  });

  return { providerStats, customerStats };
}

/**
 * ✅ Submit rating (Customer rates Provider OR Provider rates Customer)
 * Body: { jobId, rating, comment }
 *
 * Rules:
 * - Job must exist and be COMPLETED
 * - Only Customer or Provider can rate
 * - Only once per job per user
 * - Comment max 200 chars
 */
export async function submitRating({ userId, jobId, rating, comment }) {
  if (!jobId) {
    const err = new Error("jobId is required");
    err.statusCode = 400;
    throw err;
  }

  const stars = Number(rating);
  if (!stars || stars < 1 || stars > 5) {
    const err = new Error("rating must be 1..5");
    err.statusCode = 400;
    throw err;
  }

  const safeComment = comment ? String(comment).trim().slice(0, 200) : null;

  const job = await Job.findById(jobId).populate("customer").populate("assignedTo");
  if (!job) {
    const err = new Error("Job not found");
    err.statusCode = 404;
    throw err;
  }

  if (job.status !== JOB_STATUSES.COMPLETED) {
    const err = new Error("Job must be COMPLETED before rating");
    err.statusCode = 400;
    throw err;
  }

  const me = await User.findById(userId);
  if (!me) {
    const err = new Error("User not found");
    err.statusCode = 401;
    throw err;
  }

  const myRole = me.role;

  const isCustomer = myRole === USER_ROLES.CUSTOMER;
  const isProvider = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK].includes(myRole);

  if (!isCustomer && !isProvider) {
    const err = new Error("Role not allowed to rate");
    err.statusCode = 403;
    throw err;
  }

  let toUser = null;
  let toRole = null;

  // Customer rates Provider
  if (isCustomer) {
    if (!job.assignedTo) {
      const err = new Error("Cannot rate: no provider assigned");
      err.statusCode = 400;
      throw err;
    }
    toUser = job.assignedTo._id;
    toRole = job.assignedTo.role || "Provider";
  }

  // Provider rates Customer
  if (isProvider) {
    if (!job.customer) {
      const err = new Error("Cannot rate: missing job customer");
      err.statusCode = 400;
      throw err;
    }
    toUser = job.customer._id;
    toRole = USER_ROLES.CUSTOMER;
  }

  // Prevent duplicate rating from same user for same job
  const existing = await Rating.findOne({ job: job._id, fromUser: me._id });
  if (existing) {
    const err = new Error("You already rated this job");
    err.statusCode = 409;
    throw err;
  }

  const created = await Rating.create({
    job: job._id,
    fromUser: me._id,
    toUser,
    fromRole: myRole,
    toRole,
    rating: stars,
    comment: safeComment,
  });

  // Update stats on the user who received the rating
  const stats = await recomputeUserRatingStats(toUser);

  return { created, stats };
}

/**
 * ✅ Admin list ratings (Support & Disputes)
 * Filters:
 * - jobId
 * - toUser
 * - fromUser
 * - minRating / maxRating
 * - fromRole / toRole
 * - search (comment text)
 * - page / limit
 */
export async function adminListRatings(filters = {}) {
  const {
    page = 1,
    limit = 20,
    jobId,
    toUser,
    fromUser,
    minRating,
    maxRating,
    fromRole,
    toRole,
    search,
  } = filters;

  const q = {};

  if (jobId) q.job = jobId;
  if (toUser) q.toUser = toUser;
  if (fromUser) q.fromUser = fromUser;
  if (fromRole) q.fromRole = fromRole;
  if (toRole) q.toRole = toRole;

  if (minRating || maxRating) {
    q.rating = {};
    if (minRating) q.rating.$gte = Number(minRating);
    if (maxRating) q.rating.$lte = Number(maxRating);
  }

  if (search) {
    q.comment = { $regex: String(search).trim(), $options: "i" };
  }

  const safeLimit = Math.min(Number(limit) || 20, 100);
  const skip = (Number(page) - 1) * safeLimit;

  const [items, total] = await Promise.all([
    Rating.find(q)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate("job", "title status pickupAddressText dropoffAddressText roleNeeded")
      .populate("fromUser", "name role phone email ratingStats")
      .populate("toUser", "name role phone email ratingStats"),
    Rating.countDocuments(q),
  ]);

  return {
    page: Number(page),
    limit: safeLimit,
    total,
    pages: Math.ceil(total / safeLimit),
    items,
  };
}

/**
 * ✅ Admin get a single rating
 */
export async function adminGetRatingById(ratingId) {
  const rating = await Rating.findById(ratingId)
    .populate("job", "title status pickupAddressText dropoffAddressText roleNeeded pricing customer assignedTo createdAt")
    .populate("fromUser", "name role phone email ratingStats")
    .populate("toUser", "name role phone email ratingStats");

  if (!rating) {
    const err = new Error("Rating not found");
    err.statusCode = 404;
    throw err;
  }

  return rating;
}