import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User, { USER_ROLES } from '../models/User.js';

dotenv.config();

const run = async () => {
  try {
    if (!process.env.MONGO_URI) {
      console.error("❌ MONGO_URI missing in .env");
      process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB connected");

    const email = "superadmin@test.com";
    const password = "123456";

    const existing = await User.findOne({ email });

    if (existing) {
      console.log("⚠️ SuperAdmin already exists:", existing.email);
      process.exit(0);
    }

    const superAdmin = await User.create({
      name: "Super Admin",
      email,
      password,
      role: USER_ROLES.SUPER_ADMIN
    });

    console.log("✅ SuperAdmin created successfully");
    console.log({
      id: superAdmin._id.toString(),
      email: superAdmin.email,
      role: superAdmin.role
    });

    process.exit(0);
  } catch (err) {
    console.error("❌ Failed to create SuperAdmin:", err.message);
    process.exit(1);
  }
};

run();