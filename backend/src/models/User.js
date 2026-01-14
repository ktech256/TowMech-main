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
 * ✅ MUST MATCH PRICING LOGIC EXACTLY
 *
 * IMPORTANT:
 * - We add the NEW preferred names (cheapest → expensive) FIRST for alignment.
 * - We KEEP legacy names for backward compatibility so existing data and old clients won't break.
 */
export const TOW_TRUCK_TYPES = [
  // ✅ NEW preferred names (cheapest → most expensive)
  "Hook & Chain",
  "Wheel-Lift",
  "Flatbed/Roll Back",
  "Boom Trucks(With Crane)",
  "Integrated / Wrecker",
  "Heavy-Duty Rotator(Recovery)",

  // ✅ Legacy values (keep for backward support)
  "TowTruck",
  "Rollback",
  "TowTruck-XL",
  "TowTruck-XXL",
  "Recovery",
  "Flatbed", // ✅ keep flatbed for backward support
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
 * ✅ Normalize phone for consistent login + uniqueness
 */
function normalizePhone(phone) {
  if (!phone) return "";
  let p = String(phone).trim();

  // remove spaces and separators
  p = p.replace(/\s+/g, "");
  p = p.replace(/[-()]/g, "");

  // convert 00 prefix → +
  if (p.startsWith("00")) p = "+" + p.slice(2);

  return p;
}

/**
 * ✅ Admin Permissions Schema (ONLY for Admin role)
 * ✅ MUST MATCH DASHBOARD PERMISSION KEYS
 */
const permissionsSchema = new mongoose.Schema(
  {
    // ✅ Overview
    canViewOverview: { type: Boolean, default: false },

    // ✅ Core admin
    canVerifyProviders: { type: Boolean, default: false },
    canApprovePayments: { type: Boolean, default: false },
    canRefundPayments: { type: Boolean, default: false },
    canManageUsers: { type: Boolean, default: false },
    canManageJobs: { type: Boolean, default: false },
    canBroadcastNotifications: { type: Boolean, default: false },

    // ✅ Safety + settings
    canManageSafety: { type: Boolean, default: false },
    canManageSettings: { type: Boolean, default: false },

    // ✅ Zones + Service Categories
    canManageZones: { type: Boolean, default: false },
    canManageServiceCategories: { type: Boolean, default: false },

    // ✅ Analytics + pricing
    canViewAnalytics: { type: Boolean, default: false },
    canManagePricing: { type: Boolean, default: false },

    // ✅ Legacy keys (safe to keep)
    canViewStats: { type: Boolean, default: false },
  },
  { _id: false }
);

/**
 * ✅ Account Status Schema
 */
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

/**
 * ✅ Provider Profile Schema
 */
const providerProfileSchema = new mongoose.Schema(
  {
    isOnline: { type: Boolean, default: false },
    lastSeenAt: { type: Date, default: null },

    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: [0, 0] },
    },

    // ✅ TowTruck providers select from these
    towTruckTypes: [{ type: String, enum: TOW_TRUCK_TYPES }],

    // ✅ Mechanic providers may use this later
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
  },
  { _id: false }
);

/**
 * ✅ Rating Stats Schema (NEW)
 */
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

/**
 * ✅ USER SCHEMA
 */
const userSchema = new mongoose.Schema(
  {
    // ✅ Basic identity
    name: { type: String, required: true },

    firstName: { type: String, required: true },
    lastName: { type: String, required: true },

    /**
     * ✅ Phone is now the PRIMARY LOGIN identifier
     */
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

    // ✅ Auth
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

    // ✅ NEW rating stats field
    ratingStats: { type: ratingStatsSchema, default: () => ({}) },

    accountStatus: { type: accountStatusSchema, default: () => ({}) },
  },
  { timestamps: true }
);

userSchema.index({ "providerProfile.location": "2dsphere" });

/**
 * ✅ Ensure phone normalization happens even if set() isn't triggered
 */
userSchema.pre("validate", function (next) {
  if (this.phone) this.phone = normalizePhone(this.phone);
  next();
});

/**
 * ✅ Hash password
 */
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

/**
 * ✅ Compare password
 */
userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

/**
 * ✅ Safe JSON output with role-based visibility
 */
userSchema.methods.toSafeJSON = function (viewerRole) {
  const obj = this.toObject();

  delete obj.password;
  delete obj.otpCode;
  delete obj.otpExpiresAt;

  const status = obj.accountStatus || {};

  // ❌ Customers and Providers see no accountStatus
  if (![USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(viewerRole)) {
    delete obj.accountStatus;
    return obj;
  }

  // ✅ Admin sees LIMITED fields + reasons
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

  // ✅ SuperAdmin sees FULL accountStatus
  obj.accountStatus = status;
  return obj;
};

export default mongoose.model("User", userSchema);