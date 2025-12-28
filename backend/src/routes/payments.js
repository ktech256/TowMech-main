import express from 'express';
import Payment, { PAYMENT_STATUSES } from '../models/Payment.js';
import Job, { JOB_STATUSES } from '../models/Job.js';
import auth from '../middleware/auth.js';
import authorizeRoles from '../middleware/role.js';
import { USER_ROLES } from '../models/User.js';

const router = express.Router();

/**
 * ✅ Customer creates payment request for a Job
 * POST /api/payments/create
 */
router.post('/create', auth, authorizeRoles(USER_ROLES.CUSTOMER), async (req, res) => {
  try {
    const { jobId } = req.body;

    if (!jobId) {
      return res.status(400).json({ message: 'jobId is required' });
    }

    const job = await Job.findById(jobId);

    if (!job) return res.status(404).json({ message: 'Job not found' });

    // ✅ Customer must own job
    if (job.customer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to pay for this job' });
    }

    // ✅ Cannot pay cancelled/completed
    if ([JOB_STATUSES.CANCELLED, JOB_STATUSES.COMPLETED].includes(job.status)) {
      return res.status(400).json({ message: `Cannot pay for job in status ${job.status}` });
    }

    // ✅ Prevent duplicate payment requests
    const existing = await Payment.findOne({ job: job._id });
    if (existing) {
      return res.status(200).json({ message: 'Payment already exists', payment: existing });
    }

    const amount = job.pricing?.estimatedTotal || 0;

    const payment = await Payment.create({
      job: job._id,
      customer: req.user._id,
      amount,
      currency: job.pricing?.currency || 'ZAR',
      status: PAYMENT_STATUSES.PENDING,
      provider: 'SIMULATION'
    });

    return res.status(201).json({
      message: 'Payment created (pending)',
      payment
    });
  } catch (err) {
    return res.status(500).json({ message: 'Could not create payment', error: err.message });
  }
});

/**
 * ✅ Fetch payment for a job (Customer/Admin)
 * GET /api/payments/job/:jobId
 */
router.get('/job/:jobId', auth, async (req, res) => {
  try {
    const payment = await Payment.findOne({ job: req.params.jobId }).populate('job');

    if (!payment) {
      return res.status(404).json({ message: 'Payment not found for job' });
    }

    // ✅ Customer can only view own payments
    if (
      req.user.role === USER_ROLES.CUSTOMER &&
      payment.customer.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: 'Not authorized to view this payment' });
    }

    return res.status(200).json({ payment });
  } catch (err) {
    return res.status(500).json({ message: 'Could not fetch payment', error: err.message });
  }
});

/**
 * ✅ Mark payment PAID by JOB ID (SIMULATION)
 * PATCH /api/payments/job/:jobId/mark-paid
 */
router.patch('/job/:jobId/mark-paid', auth, async (req, res) => {
  try {
    const payment = await Payment.findOne({ job: req.params.jobId });

    if (!payment) {
      return res.status(404).json({ message: 'Payment not found for job' });
    }

    // ✅ Customer can mark paid only for own job
    if (
      req.user.role === USER_ROLES.CUSTOMER &&
      payment.customer.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: 'Not authorized to mark this payment' });
    }

    // ✅ Only Admin or Customer
    if (![USER_ROLES.ADMIN, USER_ROLES.CUSTOMER].includes(req.user.role)) {
      return res.status(403).json({ message: 'Only Admin or Customer can mark payment as paid' });
    }

    payment.status = PAYMENT_STATUSES.PAID;
    payment.providerReference = `SIM-${Date.now()}`;
    await payment.save();

    return res.status(200).json({ message: 'Payment marked PAID ✅ (simulation)', payment });
  } catch (err) {
    return res.status(500).json({ message: 'Could not mark payment', error: err.message });
  }
});

/**
 * ✅ Mark payment PAID by PAYMENT ID (SIMULATION)
 * PATCH /api/payments/:paymentId/mark-paid
 *
 * ✅ This matches your CURL command
 */
router.patch('/:paymentId/mark-paid', auth, async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.paymentId);

    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    // ✅ Customer can mark paid only for own payment
    if (
      req.user.role === USER_ROLES.CUSTOMER &&
      payment.customer.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: 'Not authorized to mark this payment' });
    }

    // ✅ Only Admin or Customer
    if (![USER_ROLES.ADMIN, USER_ROLES.CUSTOMER].includes(req.user.role)) {
      return res.status(403).json({ message: 'Only Admin or Customer can mark payment as paid' });
    }

    payment.status = PAYMENT_STATUSES.PAID;
    payment.providerReference = `SIM-${Date.now()}`;
    await payment.save();

    return res.status(200).json({ message: 'Payment marked PAID ✅ (simulation)', payment });
  } catch (err) {
    return res.status(500).json({ message: 'Could not mark payment', error: err.message });
  }
});

export default router;