// src/models/CountryServiceConfig.js
import mongoose from "mongoose";

/**
 * CountryServiceConfig
 * - Feature flags per country (dashboard toggles)
 * - Controls which services are available in that country
 * - Also controls provider KYC requirements per service/country
 */

const kycRequirementsSchema = new mongoose.Schema(
  {
    // Global provider KYC docs (common)
    idDocumentRequired: { type: Boolean, default: true },
    selfieRequired: { type: Boolean, default: false },
    proofOfAddressRequired: { type: Boolean, default: false },

    // TowTruck-specific docs
    towTruckLicenseRequired: { type: Boolean, default: true },
    vehicleProofRequired: { type: Boolean, default: true },

    // Mechanic-specific docs
    workshopProofRequired: { type: Boolean, default: false },

    // Optional: extra docs list (country-specific)
    extraDocs: [
      {
        key: { type: String, default: "" }, // e.g. "tax_clearance"
        label: { type: String, default: "" }, // e.g. "Tax Clearance Certificate"
        required: { type: Boolean, default: false },
      },
    ],
  },
  { _id: false }
);

const servicesSchema = new mongoose.Schema(
  {
    // Core services
    towingEnabled: { type: Boolean, default: true },
    mechanicEnabled: { type: Boolean, default: true },

    // Future services (expand as you grow)
    roadsideAssistanceEnabled: { type: Boolean, default: false },
    batteryJumpstartEnabled: { type: Boolean, default: false },
    tyreChangeEnabled: { type: Boolean, default: false },
    fuelDeliveryEnabled: { type: Boolean, default: false },
    carWashEnabled: { type: Boolean, default: false },

    // Insurance workflow
    insuranceModeEnabled: { type: Boolean, default: false },
  },
  { _id: false }
);

const paymentRoutingSchema = new mongoose.Schema(
  {
    // Enables per country (you can expand later)
    paystackEnabled: { type: Boolean, default: false },
    ikhokhaEnabled: { type: Boolean, default: false },
    payfastEnabled: { type: Boolean, default: false },

    // Kenya / Uganda / Global additions
    mpesaEnabled: { type: Boolean, default: false },
    flutterwaveEnabled: { type: Boolean, default: false },
    stripeEnabled: { type: Boolean, default: false },

    // Booking fee rules
    bookingFeeRequired: { type: Boolean, default: true },
    bookingFeePercent: { type: Number, default: 0 }, // optional
    bookingFeeFlat: { type: Number, default: 0 }, // optional
  },
  { _id: false }
);

const supportRoutingSchema = new mongoose.Schema(
  {
    // Support routing per country
    supportEmail: { type: String, default: null },
    supportWhatsApp: { type: String, default: null },
    supportPhone: { type: String, default: null },

    // Optional queue key (for future: Zendesk/Freshdesk etc)
    queueKey: { type: String, default: null },
  },
  { _id: false }
);

const countryServiceConfigSchema = new mongoose.Schema(
  {
    // ISO country code (ZA, KE, UG, US, GB...)
    countryCode: { type: String, required: true, unique: true, index: true },

    // master enable switch
    enabled: { type: Boolean, default: true },

    // feature flags / services
    services: { type: servicesSchema, default: () => ({}) },

    // provider KYC requirements
    kyc: { type: kycRequirementsSchema, default: () => ({}) },

    // payment routing flags
    payments: { type: paymentRoutingSchema, default: () => ({}) },

    // support routing
    support: { type: supportRoutingSchema, default: () => ({}) },
  },
  { timestamps: true }
);

countryServiceConfigSchema.pre("validate", function (next) {
  if (this.countryCode) this.countryCode = String(this.countryCode).trim().toUpperCase();
  next();
});

export default mongoose.model("CountryServiceConfig", countryServiceConfigSchema);