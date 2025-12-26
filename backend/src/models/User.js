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

// ✅ Provider profile (TowTruck & Mechanic only)
const providerProfileSchema = new mongoose.Schema(
  {
    isOnline: { type: Boolean, default: false },
    lastSeenAt: { type: Date },

    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] } // [lng, lat]
    },

    towTruckTypes: [{ type: String, enum: TOW_TRUCK_TYPES }],
    carTypesSupported: [{ type: String, enum: VEHICLE_TYPES }],

    // ✅ Verification (admin approval)
    verificationStatus: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING'
    },

    verificationDocs: {
      idDocumentUrl: { type: String, default: null },
      licenseUrl: { type: String, default: null },
      vehicleProofUrl: { type: String, default: null },
      workshopProofUrl: { type: String, default: null }
    },

    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
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

    otpCode: String,
    otpExpiresAt: Date,

    // Only used for TowTruck + Mechanic users
    providerProfile: providerProfileSchema
  },
  { timestamps: true }
);

// ✅ Geo Index for fast nearest provider queries
userSchema.index({ 'providerProfile.location': '2dsphere' });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

export default mongoose.model('User', userSchema);
