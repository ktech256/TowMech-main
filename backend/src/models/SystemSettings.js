import mongoose from "mongoose";

const ZoneSchema = new mongoose.Schema(
  {
    name: { type: String, required: true }, // e.g Johannesburg Central
    description: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
  },
  { _id: false }
);

const ServiceCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true }, // e.g Flatbed Tow
    providerType: {
      type: String,
      enum: ["TOW_TRUCK", "MECHANIC"],
      required: true,
    },
    isActive: { type: Boolean, default: true },
  },
  { _id: false }
);

const PeakScheduleSchema = new mongoose.Schema(
  {
    nightFeePercentage: { type: Number, default: 0 }, // e.g 15%
    weekendFeePercentage: { type: Number, default: 0 }, // e.g 20%
    nightStartHour: { type: Number, default: 20 }, // 8PM
    nightEndHour: { type: Number, default: 6 }, // 6AM
    weekendDays: {
      type: [String],
      default: ["SATURDAY", "SUNDAY"],
    },
  },
  { _id: false }
);

const IntegrationSchema = new mongoose.Schema(
  {
    paymentProvider: { type: String, default: "" }, // e.g PAYSTACK
    paymentApiKey: { type: String, default: "" },

    smsProvider: { type: String, default: "" }, // e.g TWILIO
    smsApiKey: { type: String, default: "" },

    googleMapsKey: { type: String, default: "" },
  },
  { _id: false }
);

const SystemSettingsSchema = new mongoose.Schema(
  {
    zones: { type: [ZoneSchema], default: [] },
    serviceCategories: { type: [ServiceCategorySchema], default: [] },
    peakSchedule: { type: PeakScheduleSchema, default: {} },
    integrations: { type: IntegrationSchema, default: {} },
  },
  { timestamps: true }
);

export default mongoose.model("SystemSettings", SystemSettingsSchema);