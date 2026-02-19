// backend/src/models/CountryServiceConfig.js
import mongoose from "mongoose";

const PaymentProviderSchema = new mongoose.Schema(
  {
    gateway: { type: String, required: true, trim: true }, // e.g. "PAYFAST"
    flowType: { type: String, default: "REDIRECT", trim: true }, // "SDK" | "REDIRECT"
    enabled: { type: Boolean, default: false },

    // ✅ Phase 2 routing fields
    priority: { type: Number, default: 0 }, // higher = preferred (optional)

    // ✅ public / non-secret configs (dashboard-editable safely)
    sdkConfig: { type: mongoose.Schema.Types.Mixed, default: {} },
    redirectConfig: { type: mongoose.Schema.Types.Mixed, default: {} },

    // ✅ legacy/back-compat bucket (older dashboard pages or older code)
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const CountryServiceConfigSchema = new mongoose.Schema(
  {
    countryCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      unique: true,
      index: true,
    },

    services: {
      towingEnabled: { type: Boolean, default: true },
      mechanicEnabled: { type: Boolean, default: true },
      emergencySupportEnabled: { type: Boolean, default: true },
      insuranceEnabled: { type: Boolean, default: false },
      chatEnabled: { type: Boolean, default: true },
      ratingsEnabled: { type: Boolean, default: true },

      winchRecoveryEnabled: { type: Boolean, default: false },
      roadsideAssistanceEnabled: { type: Boolean, default: false },
      jumpStartEnabled: { type: Boolean, default: false },
      tyreChangeEnabled: { type: Boolean, default: false },
      fuelDeliveryEnabled: { type: Boolean, default: false },
      lockoutEnabled: { type: Boolean, default: false },

      // legacy alias
      supportEnabled: { type: Boolean, default: true },
    },

    payments: {
      // legacy flags (keep for old code / old UI)
      paystackEnabled: { type: Boolean, default: false },
      ikhokhaEnabled: { type: Boolean, default: false },
      payfastEnabled: { type: Boolean, default: false },
      mpesaEnabled: { type: Boolean, default: false },
      flutterwaveEnabled: { type: Boolean, default: false },
      stripeEnabled: { type: Boolean, default: false },

      bookingFeeRequired: { type: Boolean, default: true },
      bookingFeePercent: { type: Number, default: 0 },
      bookingFeeFlat: { type: Number, default: 0 },

      // ✅ payment routing (dashboard decides)
      defaultProvider: { type: String, default: "ikhokha", trim: true }, // key like "payfast" or enum like "PAYFAST"
      providers: { type: [PaymentProviderSchema], default: [] },
    },
  },
  { timestamps: true }
);

function normalizeFlowType(v) {
  const t = String(v || "REDIRECT").trim().toUpperCase();
  return t === "SDK" ? "SDK" : "REDIRECT";
}

function normalizeMixedObject(v) {
  if (!v || typeof v !== "object") return {};
  return v;
}

CountryServiceConfigSchema.pre("validate", function (next) {
  if (this.countryCode) this.countryCode = String(this.countryCode).trim().toUpperCase();

  // keep legacy supportEnabled aligned
  if (this.services) {
    if (typeof this.services.emergencySupportEnabled === "boolean") {
      this.services.supportEnabled = this.services.emergencySupportEnabled;
    }
  }

  // normalize providers items
  if (this.payments && Array.isArray(this.payments.providers)) {
    this.payments.providers = this.payments.providers
      .filter(Boolean)
      .map((p) => ({
        gateway: String(p.gateway || "").trim(),
        flowType: normalizeFlowType(p.flowType),
        enabled: !!p.enabled,
        priority: Number.isFinite(Number(p.priority)) ? Number(p.priority) : 0,

        sdkConfig: normalizeMixedObject(p.sdkConfig),
        redirectConfig: normalizeMixedObject(p.redirectConfig),

        // legacy config
        config: normalizeMixedObject(p.config),
      }))
      .filter((p) => !!p.gateway);
  }

  next();
});

export default mongoose.models.CountryServiceConfig ||
  mongoose.model("CountryServiceConfig", CountryServiceConfigSchema);