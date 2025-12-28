import express from 'express';
import Job, { JOB_STATUSES } from '../models/Job.js';
import User, { USER_ROLES } from '../models/User.js';
import PricingConfig from '../models/PricingConfig.js';
import Payment, { PAYMENT_STATUSES } from '../models/Payment.js';
import auth from '../middleware/auth.js';
import authorizeRoles from '../middleware/role.js';

// ✅ Broadcast helper (ONLY AFTER PAYMENT)
import { broadcastJobToProviders } from '../utils/broadcastJob.js';

const router = express.Router();

/**
 * ✅ CUSTOMER creates job
 * ✅ Job is NOT broadcasted until booking fee is paid
 * POST /api/jobs
 */
router.post('/', auth, authorizeRoles(USER_ROLES.CUSTOMER), async (req, res) => {
  try {
    const {
      title,
      description,
      roleNeeded,
      pickupLat,
      pickupLng,
      pickupAddressText,
      dropoffLat,
      dropoffLng,
      dropoffAddressText,
      towTruckTypeNeeded,
      vehicleType
    } = req.body;

    // ✅ Required fields
    if (!title || !roleNeeded || pickupLat === undefined || pickupLng === undefined) {
      return res.status(400).json({
        message: 'title, roleNeeded, pickupLat, pickupLng are required'
      });
    }

    // ✅ TowTruck requires dropoff coordinates
    if (
      roleNeeded === USER_ROLES.TOW_TRUCK &&
      (dropoffLat === undefined || dropoffLng === undefined)
    ) {
      return res.status(400).json({
        message: 'TowTruck jobs require dropoffLat and dropoffLng'
      });
    }

    // ✅ Load pricing config
    let pricingConfig = await PricingConfig.findOne();
    if (!pricingConfig) pricingConfig = await PricingConfig.create({});

    const baseFee = pricingConfig.baseFee || 0;
    const perKmFee = pricingConfig.perKmFee || 0;

    const hasDropoff = dropoffLat !== undefined && dropoffLng !== undefined;

    /**
     * ✅ TowTruck estimated distance placeholder
     * (You can later calculate real distance using Google Maps)
     */
    const estimatedDistanceKm =
      roleNeeded === USER_ROLES.TOW_TRUCK && hasDropoff ? 25 : 0;

    const towMult =
      towTruckTypeNeeded
        ? pricingConfig.towTruckTypeMultipliers?.[towTruckTypeNeeded] || 1
        : 1;

    const vehicleMult =
      vehicleType
        ? pricingConfig.vehicleTypeMultipliers?.[vehicleType] || 1
        : 1;

    /**
     * ✅ Only TowTruck has total estimate
     * Mechanic total is unknown until mechanic arrives
     */
    const estimatedTotal =
      roleNeeded === USER_ROLES.TOW_TRUCK
        ? (baseFee + perKmFee * estimatedDistanceKm) * towMult * vehicleMult
        : 0;

    /**
     * ✅ BOOKING FEE
     * TowTruck = % of estimatedTotal
     * Mechanic = fixed booking fee
     */
    const towBookingPercent = pricingConfig.bookingFees?.towTruckPercent || 15;
    const mechanicFixedFee = pricingConfig.bookingFees?.mechanicFixed || 200;

    const bookingFee =
      roleNeeded === USER_ROLES.TOW_TRUCK
        ? Math.round((estimatedTotal * towBookingPercent) / 100)
        : mechanicFixedFee;

    /**
     * ✅ Provider payout amount
     * TowTruck = total - bookingFee
     * Mechanic = unknown, customer pays mechanic directly later
     */
    const providerPayoutAmount =
      roleNeeded === USER_ROLES.TOW_TRUCK
        ? Math.max(estimatedTotal - bookingFee, 0)
        : 0;

    /**
     * ✅ Create Job
     * Status stays CREATED until booking fee is paid
     */
    const job = await Job.create({
      title,
      description,
      roleNeeded,

      pickupLocation: {
        type: 'Point',
        coordinates: [pickupLng, pickupLat]
      },

      pickupAddressText: pickupAddressText || null,

      dropoffLocation: hasDropoff
        ? { type: 'Point', coordinates: [dropoffLng, dropoffLat] }
        : undefined,

      dropoffAddressText: hasDropoff ? dropoffAddressText : undefined,

      towTruckTypeNeeded: towTruckTypeNeeded || null,
      vehicleType: vehicleType || null,

      customer: req.user._id,

      status: JOB_STATUSES.CREATED,

      pricing: {
        currency: pricingConfig.currency || 'ZAR',
        baseFee,
        perKmFee,
        estimatedDistanceKm,
        towTruckTypeMultiplier: towMult,
        vehicleTypeMultiplier: vehicleMult,
        estimatedTotal,

        bookingFee,
        bookingFeePaid: false,
        providerPayoutAmount
      }
    });

    /**
     * ✅ Create Payment Request (BOOKING FEE ONLY)
     */
    const payment = await Payment.create({
      job: job._id,
      customer: req.user._id,
      amount: bookingFee,
      currency: pricingConfig.currency || 'ZAR',
      status: PAYMENT_STATUSES.PENDING,
      provider: 'SIMULATION'
    });

    return res.status(201).json({
      message:
        'Job created ✅ Booking fee payment required before matching provider',
      job,
      payment
    });
  } catch (err) {
    return res.status(500).json({
      message: 'Could not create job',
      error: err.message
    });
  }
});

/**
 * ✅ Provider sees jobs broadcasted to them
 * GET /api/jobs/available
 */
router.get('/available', auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];

    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: 'Only service providers can view available jobs'
      });
    }

    const jobs = await Job.find({
      status: JOB_STATUSES.BROADCASTED,
      assignedTo: null,
      broadcastedTo: req.user._id
    }).sort({ createdAt: -1 });

    return res.status(200).json(jobs);
  } catch (err) {
    return res.status(500).json({
      message: 'Could not fetch available jobs',
      error: err.message
    });
  }
});

/**
 * ✅ Customer active jobs
 * MUST COME BEFORE "/:id"
 * GET /api/jobs/my/active
 */
router.get('/my/active', auth, authorizeRoles(USER_ROLES.CUSTOMER), async (req, res) => {
  try {
    const jobs = await Job.find({
      customer: req.user._id,
      status: {
        $in: [
          JOB_STATUSES.CREATED,
          JOB_STATUSES.BROADCASTED,
          JOB_STATUSES.ASSIGNED,
          JOB_STATUSES.IN_PROGRESS
        ]
      }
    })
      .populate('assignedTo', 'name email role providerProfile')
      .sort({ updatedAt: -1 });

    return res.status(200).json({ jobs });
  } catch (err) {
    return res.status(500).json({ message: 'Could not fetch active jobs', error: err.message });
  }
});

/**
 * ✅ Customer job history
 * MUST COME BEFORE "/:id"
 * GET /api/jobs/my/history
 */
router.get('/my/history', auth, authorizeRoles(USER_ROLES.CUSTOMER), async (req, res) => {
  try {
    const jobs = await Job.find({
      customer: req.user._id,
      status: { $in: [JOB_STATUSES.COMPLETED, JOB_STATUSES.CANCELLED] }
    })
      .populate('assignedTo', 'name email role providerProfile')
      .sort({ updatedAt: -1 })
      .limit(50);

    return res.status(200).json({ jobs });
  } catch (err) {
    return res.status(500).json({ message: 'Could not fetch job history', error: err.message });
  }
});

/**
 * ✅ Provider accepts broadcasted job
 * PATCH /api/jobs/:id/accept
 */
router.patch('/:id/accept', auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];

    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Only service providers can accept jobs' });
    }

    const job = await Job.findOneAndUpdate(
      {
        _id: req.params.id,
        status: JOB_STATUSES.BROADCASTED,
        assignedTo: null,
        broadcastedTo: req.user._id
      },
      {
        assignedTo: req.user._id,
        lockedAt: new Date(),
        status: JOB_STATUSES.ASSIGNED
      },
      { new: true }
    );

    if (!job) {
      return res.status(409).json({
        message: 'Job already accepted by another provider or not available to you'
      });
    }

    return res.status(200).json({ message: 'Job accepted ✅', job });
  } catch (err) {
    return res.status(500).json({ message: 'Could not accept job', error: err.message });
  }
});

/**
 * ✅ Provider rejects job
 * PATCH /api/jobs/:id/reject
 */
router.patch('/:id/reject', auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];

    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Only service providers can reject jobs' });
    }

    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    job.broadcastedTo = job.broadcastedTo.filter(
      (id) => id.toString() !== req.user._id.toString()
    );

    job.excludedProviders = job.excludedProviders || [];
    if (!job.excludedProviders.map(String).includes(req.user._id.toString())) {
      job.excludedProviders.push(req.user._id);
    }

    await job.save();

    return res.status(200).json({ message: 'Job rejected ✅', job });
  } catch (err) {
    return res.status(500).json({ message: 'Could not reject job', error: err.message });
  }
});

/**
 * ✅ Update job status
 * PATCH /api/jobs/:id/status
 */
router.patch('/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;

    if (!Object.values(JOB_STATUSES).includes(status)) {
      return res.status(400).json({ message: 'Invalid status provided' });
    }

    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    const isAssignedProvider =
      job.assignedTo && job.assignedTo.toString() === req.user._id.toString();
    const isAdmin = req.user.role === USER_ROLES.ADMIN;

    if (!isAssignedProvider && !isAdmin) {
      return res.status(403).json({
        message: 'Only assigned provider or admin can update job status'
      });
    }

    // ✅ Require booking fee before IN_PROGRESS / COMPLETED
    if (
      [JOB_STATUSES.IN_PROGRESS, JOB_STATUSES.COMPLETED].includes(status) &&
      req.user.role !== USER_ROLES.ADMIN
    ) {
      const payment = await Payment.findOne({ job: job._id });

      if (!payment) return res.status(400).json({ message: 'Booking fee required before starting job' });
      if (payment.status !== PAYMENT_STATUSES.PAID) {
        return res.status(400).json({ message: 'Booking fee must be PAID before starting job' });
      }
    }

    job.status = status;
    await job.save();

    return res.status(200).json({ message: 'Job status updated ✅', job });
  } catch (err) {
    return res.status(500).json({ message: 'Could not update job status', error: err.message });
  }
});

/**
 * ✅ Get job by ID
 * GET /api/jobs/:id
 */
router.get('/:id', auth, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id)
      .populate('customer', 'name email role')
      .populate('assignedTo', 'name email role');

    if (!job) return res.status(404).json({ message: 'Job not found' });

    const isCustomerOwner =
      req.user.role === USER_ROLES.CUSTOMER &&
      job.customer &&
      job.customer._id.toString() === req.user._id.toString();

    const isAssignedProvider =
      job.assignedTo && job.assignedTo._id.toString() === req.user._id.toString();

    const isAdmin = req.user.role === USER_ROLES.ADMIN;

    if (!isCustomerOwner && !isAssignedProvider && !isAdmin) {
      return res.status(403).json({ message: 'Not authorized to view this job' });
    }

    return res.status(200).json(job);
  } catch (err) {
    return res.status(500).json({ message: 'Could not fetch job', error: err.message });
  }
});

/**
 * ✅ Customer cancels job
 * PATCH /api/jobs/:id/cancel
 */
router.patch('/:id/cancel', auth, authorizeRoles(USER_ROLES.CUSTOMER, USER_ROLES.ADMIN), async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    if (
      req.user.role === USER_ROLES.CUSTOMER &&
      job.customer.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: 'Not authorized to cancel this job' });
    }

    if (job.status === JOB_STATUSES.COMPLETED) {
      return res.status(400).json({ message: 'Cannot cancel a completed job' });
    }

    job.status = JOB_STATUSES.CANCELLED;
    job.cancelledBy = req.user._id;
    job.cancelReason = req.body.reason || 'Cancelled by customer';
    job.cancelledAt = new Date();

    await job.save();

    return res.status(200).json({ message: 'Job cancelled successfully ✅', job });
  } catch (err) {
    return res.status(500).json({ message: 'Could not cancel job', error: err.message });
  }
});

export default router;