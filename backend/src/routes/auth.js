import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import auth from '../middleware/auth.js';
import User, { USER_ROLES } from '../models/User.js';

const router = express.Router();

// ✅ Helper: Generate JWT token
const generateToken = (userId, role) =>
  jwt.sign({ id: userId, role }, process.env.JWT_SECRET, { expiresIn: '7d' });

/**
 * ✅ Register user
 * POST /api/auth/register
 */
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role = USER_ROLES.CUSTOMER } = req.body;

    console.log('🟦 REGISTER HIT:', email);

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required' });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      console.log('🟨 REGISTER FAIL: user already exists');
      return res.status(409).json({ message: 'User already exists' });
    }

    if (!Object.values(USER_ROLES).includes(role)) {
      return res.status(400).json({ message: 'Invalid role provided' });
    }

    const user = await User.create({ name, email, password, role });

    console.log('✅ REGISTER SUCCESS:', user.email, user.role);

    return res.status(201).json({
      message: 'User registered successfully ✅',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error('❌ REGISTER ERROR:', err);
    return res.status(500).json({ message: 'Registration failed', error: err.message });
  }
});

/**
 * ✅ Login user → generates OTP
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log('🟦 LOGIN HIT:', email);

    if (!email || !password) {
      console.log('🟥 LOGIN FAIL: Missing email/password');
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // ✅ MUST include password for bcrypt to work
    const user = await User.findOne({ email });

    console.log('🟩 USER FOUND:', user ? 'YES ✅' : 'NO ❌');

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    console.log('🟩 USER ROLE:', user.role);
    console.log('🟩 HASH PRESENT:', user.password ? 'YES ✅' : 'NO ❌');
    console.log('🟩 HASH PREVIEW:', user.password?.slice(0, 10) + '...');

    const isMatch = await user.matchPassword(password);

    console.log('🟦 MATCH RESULT:', isMatch);

    if (!isMatch) {
      console.log('🟥 LOGIN FAIL: Wrong password');
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // ✅ Create OTP
    const otpCode = crypto.randomInt(100000, 999999).toString();
    user.otpCode = otpCode;
    user.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    console.log('✅ OTP GENERATED:', otpCode);

    return res.status(200).json({
      message: 'OTP generated ✅ (placeholder - no SMS integration)',
      otp: process.env.ENABLE_OTP_DEBUG === 'true' ? otpCode : undefined
    });
  } catch (err) {
    console.error('❌ LOGIN ERROR:', err);
    return res.status(500).json({ message: 'Login failed', error: err.message });
  }
});

/**
 * ✅ Verify OTP → returns token
 * POST /api/auth/verify-otp
 */
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    console.log('🟦 VERIFY OTP HIT:', email);

    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and OTP are required' });
    }

    const user = await User.findOne({ email });

    console.log('🟩 USER FOUND:', user ? 'YES ✅' : 'NO ❌');

    if (!user || !user.otpCode) {
      return res.status(400).json({ message: 'OTP not requested or user not found' });
    }

    const isExpired = user.otpExpiresAt && user.otpExpiresAt < new Date();

    console.log('🟩 OTP EXPIRED:', isExpired);
    console.log('🟩 STORED OTP:', user.otpCode);
    console.log('🟩 INPUT OTP:', otp);

    if (isExpired || user.otpCode !== otp) {
      return res.status(401).json({ message: 'Invalid or expired OTP' });
    }

    // ✅ clear OTP
    user.otpCode = null;
    user.otpExpiresAt = null;
    await user.save();

    const token = generateToken(user._id, user.role);

    console.log('✅ OTP VERIFIED. TOKEN GENERATED.');

    return res.status(200).json({
      message: 'OTP verified ✅',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error('❌ OTP VERIFY ERROR:', err);
    return res.status(500).json({ message: 'OTP verification failed', error: err.message });
  }
});

/**
 * ✅ Get logged-in user profile
 * GET /api/auth/me
 */
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password -otpCode -otpExpiresAt');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json({
      user: {
        ...user.toObject(),
        providerProfile: user.providerProfile || null
      }
    });
  } catch (err) {
    console.error('❌ ME ERROR:', err);
    return res.status(500).json({ message: 'Could not fetch profile', error: err.message });
  }
});

export default router;