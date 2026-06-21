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
      enum: ["ACTIVE", "INACTIVE", "PENDING_ACTIVATION", "SUSPENDED"],
      default: "PENDING_ACTIVATION",
      index: true,
    },
    isSuspended: { type: Boolean, default: false },
    portalAccessFlags: {
      canViewLiveMap: { type: Boolean, default: true },
      canGenerateCodes: { type: Boolean, default: true },
      canViewStatements: { type: Boolean, default: true },
    },
    activationToken: {
      type: String,
      default: null,
    },
    activationTokenExpiry: {
      type: Date,
      default: null,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    lastInvitationSent: {
      type: Date,
      default: null,
    },
    invitationStatus: {
      type: String,
      enum: ["Not Sent", "Sent", "Delivered", "Activated", "Expired"],
      default: "Not Sent",
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
