import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import User, { USER_ROLES } from '../models/User.js';

const router = express.Router();

const generateToken = (userId, role) =>
  jwt.sign({ id: userId, role }, process.env.JWT_SECRET, { expiresIn: '7d' });

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role = USER_ROLES.CUSTOMER } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required' });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: 'User already exists' });
    }

    if (!Object.values(USER_ROLES).includes(role)) {
      return res.status(400).json({ message: 'Invalid role provided' });
    }

    const user = await User.create({ name, email, password, role });
    return res.status(201).json({
      message: 'User registered successfully',
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    return res.status(500).json({ message: 'Registration failed', error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const otpCode = crypto.randomInt(100000, 999999).toString();
    user.otpCode = otpCode;
    user.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    return res.status(200).json({
      message: 'OTP generated (placeholder - no SMS integration)',
      otp: process.env.ENABLE_OTP_DEBUG === 'true' ? otpCode : undefined
    });
  } catch (err) {
    return res.status(500).json({ message: 'Login failed', error: err.message });
  }
});

router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and OTP are required' });
    }

    const user = await User.findOne({ email });
    if (!user || !user.otpCode) {
      return res.status(400).json({ message: 'OTP not requested or user not found' });
    }

    const isExpired = user.otpExpiresAt && user.otpExpiresAt < new Date();
    if (isExpired || user.otpCode !== otp) {
      return res.status(401).json({ message: 'Invalid or expired OTP' });
    }

    user.otpCode = undefined;
    user.otpExpiresAt = undefined;
    await user.save();

    const token = generateToken(user._id, user.role);
    return res.status(200).json({
      message: 'OTP verified',
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    return res.status(500).json({ message: 'OTP verification failed', error: err.message });
  }
});

export default router;
