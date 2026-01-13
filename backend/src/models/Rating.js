import mongoose from "mongoose";

const ratingSchema = new mongoose.Schema(
  {
    job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true, index: true },
    rater: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    target: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: null },

    raterRole: { type: String, default: null },  // "Customer" / "TowTruck" / "Mechanic"
    targetRole: { type: String, default: null }, // "Provider" / "Customer"
  },
  { timestamps: true }
);

// prevent duplicate rating per job per rater
ratingSchema.index({ job: 1, rater: 1 }, { unique: true });

export default mongoose.model("Rating", ratingSchema);