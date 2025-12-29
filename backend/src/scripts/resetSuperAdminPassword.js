import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';

dotenv.config();

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected');

    const user = await User.findOne({ email: 'superadmin@test.com' });

    if (!user) {
      console.log('❌ SuperAdmin not found');
      process.exit(0);
    }

    user.password = '123456'; // ✅ will auto-hash because pre-save middleware runs
    await user.save();

    console.log('✅ SuperAdmin password reset successfully');
    console.log({ id: user._id.toString(), email: user.email, role: user.role });

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
};

run();