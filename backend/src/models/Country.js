// backend/src/models/Country.js
import mongoose from "mongoose";

const CountrySchema = new mongoose.Schema(
  {
    // Dashboard expects "code" (ISO2)
    code: { type: String, required: true, uppercase: true, trim: true, unique: true },

    name: { type: String, required: true, trim: true },

    currency: { type: String, required: true, uppercase: true, trim: true },

    defaultLanguage: { type: String, default: "en", lowercase: true, trim: true },

    supportedLanguages: { type: [String], default: ["en"] },

    timezone: { type: String, default: "Africa/Johannesburg", trim: true },

    isActive: { type: Boolean, default: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export default mongoose.models.Country || mongoose.model("Country", CountrySchema);