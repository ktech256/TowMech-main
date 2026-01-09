import mongoose from "mongoose";

const ServiceCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },

    // ✅ Provider type this service belongs to
    providerType: {
      type: String,
      required: true,
      enum: ["TOW_TRUCK", "MECHANIC"],
    },

    // ✅ Optional base price (can later help pricing calculations)
    basePrice: { type: Number, default: 0 },

    // ✅ Active toggle
    active: { type: Boolean, default: true },

    // ✅ Audit
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export default mongoose.model("ServiceCategory", ServiceCategorySchema);