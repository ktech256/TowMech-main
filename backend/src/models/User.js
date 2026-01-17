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
 * Used for mechanic onboarding + filtering during mechanic job requests
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

function normalizePhone(phone) {
  if (!phone) return "";
  let p = String(phone).trim();

  p = p.replace(/\s+/g, "");
  p = p.replace(/[-()]/g, "");

  if (p.startsWith("00")) p = "+" + p.slice(2);

  return p;
}

const permissionsSchema = new mongoose.Schema(
  {
    canViewOverview: { type: Boolean, default: false },

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

    // ✅ Mechanic only (NEW)
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
      set: normalizePhone,
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

userSchema.index({ "providerProfile.location": "2dsphere" });

userSchema.pre("validate", function (next) {
  if (this.phone) this.phone = normalizePhone(this.phone);
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

  // ✅ hide provider sessionId from all API responses
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