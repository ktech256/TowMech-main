import mongoose from "mongoose";
import bcrypt from "bcryptjs";

/**
 * ✅ USER ROLES
 */
export const USER_ROLES = {
  SUPER_ADMIN: "SuperAdmin",
  CUSTOMER: "Customer",
  MECHANIC: "Mechanic",
  TOW_TRUCK: "TowTruck",
  ADMIN: "Admin",
};

/**
 * ✅ PROVIDER TYPES (TowTruck types)
 */
export const TOW_TRUCK_TYPES = [
  "Hook & Chain",
  "Wheel-Lift",
  "Flatbed/Roll Back",
  "Boom Trucks(With Crane)",
  "Integrated / Wrecker",
  "Heavy-Duty Rotator(Recovery)",

  "TowTruck",
  "Rollback",
  "TowTruck-XL",
  "TowTruck-XXL",
  "Recovery",
  "Flatbed",
];

/**
 * ✅ MECHANIC CATEGORIES (NEW)
 */
export const MECHANIC_CATEGORIES = [
  "General Mechanic",
  "Engine Mechanic",
  "Gearbox Mechanic",
  "Suspension & Alignment",
  "Tyre and rims",
  "Car wiring and Diagnosis",
];

export const VEHICLE_TYPES = [
  "Sedan",
  "SUV",
  "Pickup",
  "Van",
  "Small Truck",
  "Heavy Truck",
  "Motorcycle",
];

/**
 * ✅ Base normalization (safe, no country assumptions)
 */
function normalizePhoneRaw(phone) {
  if (!phone) return "";
  let p = String(phone).trim();

  p = p.replace(/\s+/g, "");
  p = p.replace(/[-()]/g, "");

  // If someone sends "00.." convert to +..
  if (p.startsWith("00")) p = "+" + p.slice(2);

  return p;
}

/**
 * ✅ TowMech Global: Dialing code map fallback (safe defaults)
 * NOTE: We still prefer country configs in auth.js where we can read Country model.
 * Here in the model we keep a conservative fallback so DB stays consistent.
 */
const DIALING_CODE_FALLBACK = {
  ZA: "+27",
  KE: "+254",
  UG: "+256",
};

/**
 * ✅ Convert phone to a consistent E.164-ish storage string for uniqueness & parallelization.
 * - If already "+", keep it.
 * - If digits-only or local leading 0, prefix dialing code based on countryCode.
 * - If uncertain, return raw normalized (never crash).
 */
function normalizePhoneForStorage(phone, countryCode = "ZA") {
  const raw = normalizePhoneRaw(phone);
  if (!raw) return "";

  // Keep E.164 if already in +
  if (raw.startsWith("+")) return raw;

  const cc = String(countryCode || "ZA").trim().toUpperCase();
  const dial = DIALING_CODE_FALLBACK[cc] || null;

  // Digits-only
  const digitsOnly = raw.replace(/[^\d]/g, "");
  if (!digitsOnly) return raw;

  // If local "0xxxxxxxx" style (common in many countries), replace leading 0 with dialing code
  if (dial && /^0\d{6,14}$/.test(digitsOnly)) {
    return `${dial}${digitsOnly.slice(1)}`;
  }

  // If already starts with dialing digits (e.g. "2547..." without +)
  if (dial) {
    const dialDigits = dial.replace("+", "");
    if (digitsOnly.startsWith(dialDigits)) {
      return `+${digitsOnly}`;
    }
  }

  // If short-ish digits and we have dial code, assume national number and prefix
  // (kept conservative: <= 12)
  if (dial && /^\d{7,12}$/.test(digitsOnly)) {
    return `${dial}${digitsOnly}`;
  }

  // Fallback: store cleaned digits as-is
  return raw;
}

const permissionsSchema = new mongoose.Schema(
  {
    /**
     * ✅ NEW: Country workspace switching
     * If false => dropdown can be hidden/disabled for that admin (frontend can enforce)
     */
    canSwitchCountryWorkspace: { type: Boolean, default: false },

    // Existing permissions
    canViewOverview: { type: Boolean, default: false },

    // ✅ NEW: Live Map permission (aligned with admin-nav + dashboard)
    canViewLiveMap: { type: Boolean, default: false },

    canVerifyProviders: { type: Boolean, default: false },
    canApprovePayments: { type: Boolean, default: false },
    canRefundPayments: { type: Boolean, default: false },
    canManageUsers: { type: Boolean, default: false },
    canManageJobs: { type: Boolean, default: false },
    canBroadcastNotifications: { type: Boolean, default: false },

    canManageSafety: { type: Boolean, default: false },
    canManageSettings: { type: Boolean, default: false },

    canManageZones: { type: Boolean, default: false },
    canManageServiceCategories: { type: Boolean, default: false },

    canViewAnalytics: { type: Boolean, default: false },
    canManagePricing: { type: Boolean, default: false },

    // ✅ Menu-based permissions you requested
    canManageChats: { type: Boolean, default: false },
    canManageNotifications: { type: Boolean, default: false },
    canManageRoles: { type: Boolean, default: false },

    canManageCountries: { type: Boolean, default: false },
    canManageCountryServices: { type: Boolean, default: false },
    canManagePaymentRouting: { type: Boolean, default: false },
    canManageLegal: { type: Boolean, default: false },
    canManageInsurance: { type: Boolean, default: false },

    canViewStats: { type: Boolean, default: false },
  },
  { _id: false }
);

const accountStatusSchema = new mongoose.Schema(
  {
    isSuspended: { type: Boolean, default: false },
    suspendedAt: { type: Date, default: null },
    suspendedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    suspendReason: { type: String, default: null },

    isBanned: { type: Boolean, default: false },
    bannedAt: { type: Date, default: null },
    bannedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    banReason: { type: String, default: null },

    isArchived: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null },
    archivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    archiveReason: { type: String, default: null },
  },
  { _id: false }
);

const providerProfileSchema = new mongoose.Schema(
  {
    isOnline: { type: Boolean, default: false },
    lastSeenAt: { type: Date, default: null },

    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: [0, 0] },
    },

    // ✅ TowTruck only
    towTruckTypes: [{ type: String, enum: TOW_TRUCK_TYPES }],

    // ✅ Mechanic only
    mechanicCategories: [{ type: String, enum: MECHANIC_CATEGORIES }],

    carTypesSupported: [{ type: String, enum: VEHICLE_TYPES }],

    fcmToken: { type: String, default: null },

    verificationStatus: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
    },

    verificationDocs: {
      idDocumentUrl: { type: String, default: null },
      licenseUrl: { type: String, default: null },
      vehicleProofUrl: { type: String, default: null },
      workshopProofUrl: { type: String, default: null },
    },

    verifiedAt: { type: Date, default: null },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // ✅ session enforcement (single device login)
    sessionId: { type: String, default: null },
    sessionIssuedAt: { type: Date, default: null },

    /**
     * ✅ TowMech Global: provider can be restricted to specific countries
     */
    allowedCountries: { type: [String], default: [] },
  },
  { _id: false }
);

const ratingStatsSchema = new mongoose.Schema(
  {
    asProvider: {
      avg: { type: Number, default: 0 },
      count: { type: Number, default: 0 },
    },
    asCustomer: {
      avg: { type: Number, default: 0 },
      count: { type: Number, default: 0 },
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },

    firstName: { type: String, required: true },
    lastName: { type: String, required: true },

    phone: {
      type: String,
      required: true,
      unique: true,
      index: true,
      // keep setter but make it raw-safe (country-aware conversion happens in pre-validate)
      set: normalizePhoneRaw,
    },

    /**
     * ✅ PRIMARY country the account belongs to
     */
    countryCode: {
      type: String,
      default: "ZA",
      uppercase: true,
      trim: true,
      index: true,
    },

    languageCode: {
      type: String,
      default: "en",
      lowercase: true,
      trim: true,
    },

    birthday: { type: Date, required: true },

    nationalityType: {
      type: String,
      enum: ["SouthAfrican", "ForeignNational"],
      required: true,
    },

    saIdNumber: { type: String, default: null },
    passportNumber: { type: String, default: null },
    country: { type: String, default: null },

    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },

    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      default: USER_ROLES.CUSTOMER,
    },

    otpCode: { type: String, default: null },
    otpExpiresAt: { type: Date, default: null },

    providerProfile: { type: providerProfileSchema, default: null },

    permissions: { type: permissionsSchema, default: null },

    ratingStats: { type: ratingStatsSchema, default: () => ({}) },

    accountStatus: { type: accountStatusSchema, default: () => ({}) },
  },
  { timestamps: true }
);

userSchema.index({ countryCode: 1, role: 1 });
userSchema.index({ "providerProfile.location": "2dsphere" });

userSchema.pre("validate", function (next) {
  // normalize codes first
  if (this.countryCode)
    this.countryCode = String(this.countryCode).trim().toUpperCase();
  if (this.languageCode)
    this.languageCode = String(this.languageCode).trim().toLowerCase();

  // ✅ country-aware phone storage normalization (parallel by dial code)
  if (this.phone) {
    const cc = this.countryCode || "ZA";
    this.phone = normalizePhoneForStorage(this.phone, cc);
  }

  next();
});

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.toSafeJSON = function (viewerRole) {
  const obj = this.toObject();

  delete obj.password;
  delete obj.otpCode;
  delete obj.otpExpiresAt;

  if (obj.providerProfile) {
    delete obj.providerProfile.sessionId;
    delete obj.providerProfile.sessionIssuedAt;
  }

  const status = obj.accountStatus || {};

  if (![USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(viewerRole)) {
    delete obj.accountStatus;
    return obj;
  }

  if (viewerRole === USER_ROLES.ADMIN) {
    obj.accountStatus = {
      isSuspended: status.isSuspended,
      suspendReason: status.suspendReason,

      isBanned: status.isBanned,
      banReason: status.banReason,

      isArchived: status.isArchived,
    };
    return obj;
  }

  obj.accountStatus = status;
  return obj;
};

export default mongoose.model("User", userSchema);