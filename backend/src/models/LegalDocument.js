// src/models/LegalDocument.js
import mongoose from "mongoose";

/**
 * LegalDocument
 * Country + language specific legal pages:
 * - Terms & Conditions
 * - Privacy Policy
 * - Refund Policy
 * - Dispute Policy
 *
 * Used by:
 * - Android app (show correct legal docs per selected country/language)
 * - Website (country routes /za/terms etc)
 * - Admin dashboard (edit per country)
 */

const LegalDocumentSchema = new mongoose.Schema(
  {
    // Scope
    countryCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },

    languageCode: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      default: "en",
      index: true,
    },

    // Document type
    type: {
      type: String,
      required: true,
      enum: ["TERMS", "PRIVACY", "REFUND", "DISPUTE"],
      index: true,
    },

    // Versioning
    version: {
      type: String,
      default: "1.0",
      trim: true,
    },

    // Content
    title: {
      type: String,
      required: true,
      trim: true,
    },

    content: {
      type: String,
      required: true,
      default: "",
    },

    // Public visibility
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    // Publish control
    publishedAt: {
      type: Date,
      default: null,
    },

    // Audit
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

// Only one active document per (country + language + type)
LegalDocumentSchema.index(
  { countryCode: 1, languageCode: 1, type: 1, isActive: 1 },
  { unique: false }
);

export default mongoose.model("LegalDocument", LegalDocumentSchema);