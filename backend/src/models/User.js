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
  "Flatbed",
  "Wheel-Lift",
  "Hook and Chain",
  "Heavy Duty Tow Truck",
  "Pickup with tow hitch",
  "Tow Dolly",
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
 * ✅ Admin Permissions Schema (ONLY for Admin role)
 * ✅ MUST match frontend PERMISSION_KEYS
 */
const permissionsSchema = new mongoose.Schema(
  {
    // ✅ OVERVIEW
    canViewOverview: { type: Boolean, default: false },

    // ✅ PROVIDERS
    canVerifyProviders: { type: Boolean, default: false },

    // ✅ PAYMENTS
    canApprovePayments: { type: Boolean, default: false },
    canRefundPayments: { type: Boolean, default: false },

    // ✅ USERS / JOBS
    canManageUsers: { type: Boolean, default: false },
    canManageJobs: { type: Boolean, default: false },

    // ✅ NOTIFICATIONS
    canBroadcastNotifications: { type: Boolean, default: false },

    // ✅ SAFETY
    canManageSafety: { type: Boolean, default: false },

    // ✅ SETTINGS
    canManageSettings: { type: Boolean, default: false },

    // ✅ ZONES
    canManageZones: { type: Boolean, default: false },

    // ✅ SERVICE CATEGORIES
    canManageServiceCategories: { type: Boolean, default: false },

    // ✅ ANALYTICS + PRICING
    canViewAnalytics: { type: Boolean, default: false },
    canManagePricing: { type: Boolean, default: false },

    // ✅ OPTIONAL OLD KEY (kept for backward compatibility)
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
    suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    suspendReason: { type: String, default: null },

    isBanned: { type: Boolean, default: false },
    bannedAt: { type: Date, default: null },
    bannedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    banReason: { type: String, default: null },

    isArchived: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null },
    archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
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

    towTruckTypes: [{ type: String, enum: TOW_TRUCK_TYPES }],
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
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { _id: false }
);

/**
 * ✅ USER SCHEMA
 */
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },

    firstName: { type: String, required: true },
    lastName: { type: String, required: true },

    phone: { type: String, required: true },
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

    // ✅ ✅ permissions only used for Admin role
    permissions: { type: permissionsSchema, default: () => ({}) },

    accountStatus: { type: accountStatusSchema, default: () => ({}) },
  },
  { timestamps: true }
);

userSchema.index({ "providerProfile.location": "2dsphere" });

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