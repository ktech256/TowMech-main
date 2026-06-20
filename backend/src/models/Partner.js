// backend/src/models/Partner.js
import mongoose from "mongoose";

const PartnerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["FLEET", "MECHANIC", "INSURANCE"],
      required: true,
      index: true,
    },
    partnerCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      unique: true,
      index: true,
    },
    contactEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
    },
    contactPhone: {
      type: String,
      required: true,
      trim: true,
    },
    country: {
      type: String,
      required: true,
      index: true,
    },
    countryCode: {
      type: String,
      required: true,
      uppercase: true,
      index: true,
    },
    workspace: {
      type: String,
      default: "default",
      index: true,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "PENDING_ACTIVATION"],
      default: "PENDING_ACTIVATION",
      index: true,
    },
    activationToken: {
      type: String,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

const Partner = mongoose.models.Partner || mongoose.model("Partner", PartnerSchema);
export default Partner;
