import mongoose from "mongoose";

/**
 * Ratings are tied to a Job.
 * A user can rate ONCE per job (unique by job + fromUser).
 * - Customer rates Provider (assignedTo)
 * - Provider rates Customer (job.customer)
 */
const ratingSchema = new mongoose.Schema(
  {
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
      index: true,
    },

    fromUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    toUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    fromRole: { type: String, required: true }, // "Customer" | "Mechanic" | "TowTruck"
    toRole: { type: String, required: true },   // "Customer" | "Mechanic" | "TowTruck"

    rating: { type: Number, required: true, min: 1, max: 5 },

    comment: { type: String, default: null, maxlength: 200 },
  },
  { timestamps: true }
);

// ✅ One rating per job per rater
ratingSchema.index({ job: 1, fromUser: 1 }, { unique: true });

// ✅ Helpful for admin searching
ratingSchema.index({ rating: 1, createdAt: -1 });
ratingSchema.index({ toUser: 1, createdAt: -1 });

export default mongoose.model("Rating", ratingSchema);