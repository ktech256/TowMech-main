import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

export const USER_ROLES = {
  CUSTOMER: 'Customer',
  MECHANIC: 'Mechanic',
  TOW_TRUCK: 'TowTruck',
  ADMIN: 'Admin'
};

export const TOW_TRUCK_TYPES = [
  'Flatbed',
  'Wheel-Lift',
  'Hook and Chain',
  'Heavy Duty Tow Truck',
  'Pickup with tow hitch',
  'Tow Dolly'
];

export const VEHICLE_TYPES = [
  'Sedan',
  'SUV',
  'Pickup',
  'Van',
  'Small Truck',
  'Heavy Truck',
  'Motorcycle'
];

// ✅ Provider profile schema (TowTruck + Mechanic)
const providerProfileSchema = new mongoose.Schema(
  {
    isOnline: { type: Boolean, default: false },
    lastSeenAt: { type: Date, default: null },

    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] } // [lng, lat]
    },

    towTruckTypes: [{ type: String, enum: TOW_TRUCK_TYPES }],
    carTypesSupported: [{ type: String, enum: VEHICLE_TYPES }],

    // ✅ Admin verification requirement
    verificationStatus: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING'
    },

    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    verificationDocs: {
      idDocumentUrl: { type: String, default: null },
      licenseUrl: { type: String, default: null },
      vehicleProofUrl: { type: String, default: null },
      workshopProofUrl: { type: String, default: null }
    },

    // ✅ Firebase token storage
    fcmToken: { type: String, default: null }
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },

    email: { type: String, required: true, unique: true },

    password: { type: String, required: true },

    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      default: USER_ROLES.CUSTOMER
    },

    otpCode: { type: String, default: null },
    otpExpiresAt: { type: Date, default: null },

    providerProfile: providerProfileSchema
  },
  { timestamps: true }
);

// ✅ Geo Index for fast nearest provider queries
userSchema.index({ 'providerProfile.location': '2dsphere' });

// ✅ Password hashing
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// ✅ Compare password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

export default mongoose.model('User', userSchema);