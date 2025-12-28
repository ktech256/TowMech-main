import express from 'express';
import Payment, { PAYMENT_STATUSES } from '../models/Payment.js';
import Job, { JOB_STATUSES } from '../models/Job.js';
import auth from '../middleware/auth.js';
import authorizeRoles from '../middleware/role.js';
import { USER_ROLES } from '../models/User.js';

// ✅ BROADCAST + PUSH helper
import { broadcastJobToProviders } from '../utils/broadcastJob.js';

const router = express.Router();

/**
 * ✅ Customer creates booking fee payment for a Job
 * POST /api/payments/create
 */
router.post('/create', auth, authorizeRoles(USER_ROLES.CUSTOMER), async (req, res) => {
  try {
    const { jobId } = req.body;

    if (!jobId) return res.status(400).json({ message: 'jobId is required' });

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    // ✅ Customer must own job
    if (job.customer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to pay for this job' });
    }

    // ✅ Cannot pay cancelled/completed jobs
    if ([JOB_STATUSES.CANCELLED, JOB_STATUSES.COMPLETED].includes(job.status)) {
      return res.status(400).json({ message: `Cannot pay for job in status ${job.status}` });
    }

    // ✅ Prevent duplicate payment requests
    const existing = await Payment.findOne({ job: job._id });
    if (existing) {
      return res.status(200).json({ message: 'Payment already exists ✅', payment: existing });
    }

    const bookingFee = job.pricing?.bookingFee || 0;

    if (bookingFee <= 0) {
      return res.status(400).json({
        message: 'Booking fee is not set for this job. Cannot create payment.'
      });
    }

    const payment = await Payment.create({
      job: job._id,
      customer: req.user._id,
      amount: bookingFee,
      currency: job.pricing?.currency || 'ZAR',
      status: PAYMENT_STATUSES.PENDING,
      provider: 'SIMULATION'
    });

    return res.status(201).json({
      message: 'Booking fee payment created ✅',
      payment
    });
  } catch (err) {
    console.error('❌ PAYMENT CREATE ERROR:', err);
    return res.status(500).json({ message: 'Could not create payment', error: err.message });
  }
});

/**
 * ✅ Fetch payment for a job
 * GET /api/payments/job/:jobId
 */
router.get('/job/:jobId', auth, async (req, res) => {
  try {
    const payment = await Payment.findOne({ job: req.params.jobId }).populate('job');

    if (!payment) return res.status(404).json({ message: 'Payment not found for job' });

    // ✅ Customer can only view own payment
    if (
      req.user.role === USER_ROLES.CUSTOMER &&
      payment.customer.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: 'Not authorized to view this payment' });
    }

    return res.status(200).json({ payment });
  } catch (err) {
    console.error('❌ PAYMENT FETCH ERROR:', err);
    return res.status(500).json({ message: 'Could not fetch payment', error: err.message });
  }
});

/**
 * ✅ Mark payment PAID using JOB ID
 * PATCH /api/payments/job/:jobId/mark-paid
 */
router.patch('/job/:jobId/mark-paid', auth, async (req, res) => {
  try {
    console.log('🔥 MARK-PAID HIT: jobId =', req.params.jobId);

    const payment = await Payment.findOne({ job: req.params.jobId });

    if (!payment) {
      return res.status(404).json({ message: 'Payment not found for job' });
    }

    // ✅ Only Admin or Customer
    if (![USER_ROLES.ADMIN, USER_ROLES.CUSTOMER].includes(req.user.role)) {
      return res.status(403).json({ message: 'Only Admin or Customer can mark payment as paid' });
    }

    // ✅ Customer can only mark own payment
    if (
      req.user.role === USER_ROLES.CUSTOMER &&
      payment.customer.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: 'Not authorized to mark this payment' });
    }

    // ✅ Prevent re-payment
    if (payment.status === PAYMENT_STATUSES.PAID) {
      return res.status(200).json({ message: 'Payment already marked PAID ✅', payment });
    }

    // ✅ Mark payment as PAID
    payment.status = PAYMENT_STATUSES.PAID;
    payment.providerReference = `SIM-${Date.now()}`;
    await payment.save();

    console.log('✅ Payment marked PAID:', payment._id.toString());

    // ✅ Update job booking fee fields
    const job = await Job.findById(payment.job);

    if (!job) return res.status(404).json({ message: 'Job not found' });

    job.pricing.bookingFeeStatus = 'PAID';
    job.pricing.bookingFeePaidAt = new Date();
    await job.save();

    console.log('✅ Job updated: bookingFeeStatus = PAID');

    // ✅ Broadcast + Push
    const broadcastResult = await broadcastJobToProviders(job._id);

    console.log('✅ broadcastJobToProviders RESULT:', broadcastResult);

    return res.status(200).json({
      message: 'Booking fee PAID ✅ Broadcast triggered ✅ Check logs for push status',
      payment,
      broadcastResult
    });
  } catch (err) {
    console.error('❌ MARK-PAID ERROR FULL:', err);
    return res.status(500).json({ message: 'Could not mark payment', error: err.message });
  }
});

/**
 * ✅ Mark payment PAID using PAYMENT ID
 * PATCH /api/payments/:paymentId/mark-paid
 */
router.patch('/:paymentId/mark-paid', auth, async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.paymentId);

    if (!payment) return res.status(404).json({ message: 'Payment not found' });

    // ✅ Only Admin or Customer
    if (![USER_ROLES.ADMIN, USER_ROLES.CUSTOMER].includes(req.user.role)) {
      return res.status(403).json({ message: 'Only Admin or Customer can mark payment as paid' });
    }

    // ✅ Customer can only mark own payment
    if (
      req.user.role === USER_ROLES.CUSTOMER &&
      payment.customer.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: 'Not authorized to mark this payment' });
    }

    if (payment.status === PAYMENT_STATUSES.PAID) {
      return res.status(200).json({ message: 'Payment already marked PAID ✅', payment });
    }

    payment.status = PAYMENT_STATUSES.PAID;
    payment.providerReference = `SIM-${Date.now()}`;
    await payment.save();

    // ✅ Update job booking fee fields
    const job = await Job.findById(payment.job);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    job.pricing.bookingFeeStatus = 'PAID';
    job.pricing.bookingFeePaidAt = new Date();
    await job.save();

    const broadcastResult = await broadcastJobToProviders(job._id);

    return res.status(200).json({
      message: 'Booking fee PAID ✅ Broadcast triggered ✅ Check logs for push status',
      payment,
      broadcastResult
    });
  } catch (err) {
    console.error('❌ MARK-PAID ERROR FULL:', err);
    return res.status(500).json({ message: 'Could not mark payment', error: err.message });
  }
});

export default router;