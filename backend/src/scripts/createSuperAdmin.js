import dotenv from "dotenv";
import mongoose from "mongoose";
import User, { USER_ROLES } from "../models/User.js";

dotenv.config();

const run = async () => {
  try {
    if (!process.env.MONGO_URI) {
      console.error("❌ MONGO_URI missing in .env");
      process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB connected");

    // ✅ CHANGE THESE IF YOU WANT
    const email = "ktech256@gmail.com";      // ✅ your real email
    const password = "12345";                // ✅ your preferred password

    // ✅ Check if already exists
    const existing = await User.findOne({ email });

    if (existing) {
      console.log("⚠️ SuperAdmin already exists:", existing.email);
      process.exit(0);
    }

    // ✅ Create SuperAdmin with REQUIRED NEW FIELDS
    const superAdmin = await User.create({
      firstName: "Killian",
      lastName: "Ongus",
      phone: "0713110111",
      email,
      password,
      birthday: "1986-05-03",
      nationalityType: "ForeignNational",
      passportNumber: "AK1270004",
      country: "Other",
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