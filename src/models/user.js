import mongoose from 'mongoose';

const roles = ['customer', 'mechanic', 'tow_truck', 'admin', 'support', 'super_admin'];

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    phone: { type: String, required: true },
    role: { type: String, enum: roles, required: true },
    isSuspended: { type: Boolean, default: false },
    passwordHash: { type: String },
    createdAt: { type: Date, default: Date.now }
  },
  {
    timestamps: true
  }
);

export default mongoose.model('User', userSchema);
