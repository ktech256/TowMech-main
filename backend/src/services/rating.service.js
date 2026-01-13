import mongoose from "mongoose";
import Job from "../models/Job.js";
import User, { USER_ROLES } from "../models/User.js";
import Rating from "../models/Rating.js";
import { JOB_STATUSES } from "../models/Job.js";

function safeAvgUpdate(currentAvg, currentCount, newRating) {
  const count = Number(currentCount || 0);
  const avg = Number(currentAvg || 0);

  const newCount = count + 1;
  const newAvg = (avg * count + newRating) / newCount;

  return { avg: Number(newAvg.toFixed(2)), count: newCount };
}

export async function createRatingAndUpdateStats({ raterId, jobId, rating, comment }) {
  // Validate IDs
  if (!mongoose.Types.ObjectId.isValid(jobId)) {
    const e = new Error("Invalid jobId");
    e.statusCode = 400;
    throw e;
  }

  const job = await Job.findById(jobId).populate("customer assignedTo");
  if (!job) {
    const e = new Error("Job not found");
    e.statusCode = 404;
    throw e;
  }

  if (job.status !== JOB_STATUSES.COMPLETED) {
    const e = new Error("You can only rate a completed job");
    e.statusCode = 400;
    throw e;
  }

  const rater = await User.findById(raterId);
  if (!rater) {
    const e = new Error("Rater not found");
    e.statusCode = 404;
    throw e;
  }

  const isCustomerRater = rater.role === USER_ROLES.CUSTOMER;
  const isProviderRater = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK].includes(rater.role);

  if (!isCustomerRater && !isProviderRater) {
    const e = new Error("Role not allowed to rate");
    e.statusCode = 403;
    throw e;
  }

  // Determine target:
  // - Customer rates assigned provider
  // - Provider rates customer
  let targetUser = null;
  let raterRole = "";
  let targetRole = "";

  if (isCustomerRater) {
    if (!job.assignedTo) {
      const e = new Error("Cannot rate: job has no assigned provider");
      e.statusCode = 400;
      throw e;
    }
    targetUser = job.assignedTo;
    raterRole = "Customer";
    targetRole = "Provider";
  } else {
    // provider rater
    if (!job.customer) {
      const e = new Error("Cannot rate: job has no customer");
      e.statusCode = 400;
      throw e;
    }
    // must be assigned provider for this job
    if (!job.assignedTo || String(job.assignedTo._id) !== String(rater._id)) {
      const e = new Error("Not allowed: job not assigned to you");
      e.statusCode = 403;
      throw e;
    }
    targetUser = job.customer;
    raterRole = rater.role; // TowTruck / Mechanic
    targetRole = "Customer";
  }

  // prevent duplicate rating per (job, rater)
  const existing = await Rating.findOne({ job: job._id, rater: rater._id });
  if (existing) {
    const e = new Error("You already rated this job");
    e.statusCode = 409;
    throw e;
  }

  // create rating
  const created = await Rating.create({
    job: job._id,
    rater: rater._id,
    target: targetUser._id,
    rating,
    comment: (comment || "").trim().slice(0, 200) || null,
    raterRole,
    targetRole,
  });

  // update ratingStats on target user
  const target = await User.findById(targetUser._id);
  if (target) {
    if (!target.ratingStats) target.ratingStats = {};
    if (!target.ratingStats.asProvider)
      target.ratingStats.asProvider = { avg: 0, count: 0 };
    if (!target.ratingStats.asCustomer)
      target.ratingStats.asCustomer = { avg: 0, count: 0 };

    if (targetRole === "Provider") {
      const next = safeAvgUpdate(
        target.ratingStats.asProvider.avg,
        target.ratingStats.asProvider.count,
        rating
      );
      target.ratingStats.asProvider = next;
    } else {
      const next = safeAvgUpdate(
        target.ratingStats.asCustomer.avg,
        target.ratingStats.asCustomer.count,
        rating
      );
      target.ratingStats.asCustomer = next;
    }

    await target.save();
  }

  return created;
}

export async function listRatingsAdmin({ page = 1, limit = 20, search = "", minStars, maxStars }) {
  const safePage = Math.max(1, page);
  const safeLimit = Math.min(100, Math.max(1, limit));
  const skip = (safePage - 1) * safeLimit;

  const filter = {};

  if (typeof minStars === "number") filter.rating = { ...(filter.rating || {}), $gte: minStars };
  if (typeof maxStars === "number") filter.rating = { ...(filter.rating || {}), $lte: maxStars };

  // basic search across comment + rater/target name/email (via populate match later)
  // We'll do comment/job title search directly; name/email search uses regex on populated docs isn't native.
  if (search) {
    filter.$or = [
      { comment: { $regex: search, $options: "i" } },
    ];
  }

  const [total, ratings] = await Promise.all([
    Rating.countDocuments(filter),
    Rating.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate("job", "title")
      .populate("rater", "name email role")
      .populate("target", "name email role"),
  ]);

  // If search includes names/emails, do a second-pass filter in-memory
  let finalRatings = ratings;
  if (search) {
    const s = search.toLowerCase();
    finalRatings = ratings.filter((r) => {
      const rater = r.rater || {};
      const target = r.target || {};
      const job = r.job || {};
      return (
        String(r.comment || "").toLowerCase().includes(s) ||
        String(job.title || "").toLowerCase().includes(s) ||
        String(rater.name || "").toLowerCase().includes(s) ||
        String(rater.email || "").toLowerCase().includes(s) ||
        String(target.name || "").toLowerCase().includes(s) ||
        String(target.email || "").toLowerCase().includes(s)
      );
    });
  }

  return {
    page: safePage,
    limit: safeLimit,
    total,
    ratings: finalRatings,
  };
}

export async function getRatingByIdAdmin(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;

  return Rating.findById(id)
    .populate("job", "title")
    .populate("rater", "name email role")
    .populate("target", "name email role");
}