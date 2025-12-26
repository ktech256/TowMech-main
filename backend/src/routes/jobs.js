import express from 'express';
import Job, { JOB_STATUSES } from '../models/Job.js';
import User, { USER_ROLES } from '../models/User.js';
import auth from '../middleware/auth.js';
import authorizeRoles from '../middleware/role.js';

const router = express.Router();

/**
 * ✅ Broadcast job to nearest 10 matching providers
 */
const broadcastJobToProviders = async (job) => {
  const [lng, lat] = job.pickupLocation.coordinates;

  const role = job.roleNeeded;

  const providerQuery = {
    role,
    'providerProfile.isOnline': true
  };

  // TowTruck additional filters
  if (role === USER_ROLES.TOW_TRUCK) {
    if (job.towTruckTypeNeeded) {
      providerQuery['providerProfile.towTruckTypes'] = job.towTruckTypeNeeded;
    }
    if (job.vehicleType) {
      providerQuery['providerProfile.carTypesSupported'] = job.vehicleType;
    }
  }

  const providers = await User.find(providerQuery)
    .where('providerProfile.location')
    .near({
      center: { type: 'Point', coordinates: [lng, lat] },
      maxDistance: 20000, // 20km radius
      spherical: true
    })
    .limit(10);

  job.broadcastedTo = providers.map((p) => p._id);
  job.status = JOB_STATUSES.BROADCASTED;

  job.dispatchAttempts = providers.map((p) => ({
    providerId: p._id,
    attemptedAt: new Date()
  }));

  await job.save();

  return providers;
};

/**
 * ✅ CUSTOMER creates job → system broadcasts to nearest 10 providers
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
      towTruckTypeNeeded,
      vehicleType
    } = req.body;

    if (!title || !roleNeeded || pickupLat === undefined || pickupLng === undefined) {
      return res.status(400).json({ message: 'title, roleNeeded, pickupLat, pickupLng are required' });
    }

    const job = await Job.create({
      title,
      description,
      roleNeeded,
      pickupLocation: {
        type: 'Point',
        coordinates: [pickupLng, pickupLat]
      },
      pickupAddressText,
      towTruckTypeNeeded,
      vehicleType,
      customer: req.user._id,
      status: JOB_STATUSES.CREATED
    });

    await broadcastJobToProviders(job);

    return res.status(201).json({ message: 'Job created and broadcasted', job });
  } catch (err) {
    return res.status(500).json({ message: 'Could not create job', error: err.message });
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
      return res.status(403).json({ message: 'Only service providers can view available jobs' });
    }

    const jobs = await Job.find({
      status: JOB_STATUSES.BROADCASTED,
      assignedTo: null,
      broadcastedTo: req.user._id
    }).sort({ createdAt: -1 });

    return res.status(200).json(jobs);
  } catch (err) {
    return res.status(500).json({ message: 'Could not fetch available jobs', error: err.message });
  }
});

/**
 * ✅ Provider accepts a broadcasted job (first accept wins)
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
      return res.status(409).json({ message: 'Job already accepted by another provider or not available to you' });
    }

    return res.status(200).json({ message: 'Job accepted', job });
  } catch (err) {
    return res.status(500).json({ message: 'Could not accept job', error: err.message });
  }
});

/**
 * ✅ Provider rejects job → removes them from broadcast list
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

    // Remove provider from broadcast list
    job.broadcastedTo = job.broadcastedTo.filter((id) => id.toString() !== req.user._id.toString());
    await job.save();

    return res.status(200).json({ message: 'Job rejected', job });
  } catch (err) {
    return res.status(500).json({ message: 'Could not reject job', error: err.message });
  }
});

/**
 * ✅ Update job status (Assigned provider only)
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
      return res.status(403).json({ message: 'Only assigned provider or admin can update job status' });
    }

    job.status = status;
    await job.save();

    return res.status(200).json({ message: 'Job status updated', job });
  } catch (err) {
    return res.status(500).json({ message: 'Could not update job status', error: err.message });
  }
});

/**
 * ✅ Get job by ID (Customer can view their job, Provider can view assigned job, Admin can view all)
 * GET /api/jobs/:id
 */
router.get('/:id', auth, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id)
      .populate('customer', 'name email role')
      .populate('assignedTo', 'name email role');

    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    const isCustomerOwner =
      req.user.role === USER_ROLES.CUSTOMER &&
      job.customer &&
      job.customer._id.toString() === req.user._id.toString();

    const isAssignedProvider =
      job.assignedTo &&
      job.assignedTo._id.toString() === req.user._id.toString();

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
 * ✅ Customer cancels a job
 * PATCH /api/jobs/:id/cancel
 */
router.patch('/:id/cancel', auth, authorizeRoles(USER_ROLES.CUSTOMER, USER_ROLES.ADMIN), async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    // ✅ Customers can cancel only their own jobs
    if (
      req.user.role === USER_ROLES.CUSTOMER &&
      job.customer.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: 'Not authorized to cancel this job' });
    }

    // ✅ Cannot cancel if already completed
    if (job.status === JOB_STATUSES.COMPLETED) {
      return res.status(400).json({ message: 'Cannot cancel a completed job' });
    }

    job.status = JOB_STATUSES.CANCELLED;
    job.cancelledBy = req.user._id;
    job.cancelReason = req.body.reason || 'Cancelled by customer';
    job.cancelledAt = new Date();

    await job.save();

    return res.status(200).json({ message: 'Job cancelled successfully', job });
  } catch (err) {
    return res.status(500).json({ message: 'Could not cancel job', error: err.message });
  }
});
/**
 * ✅ Customer gets active jobs
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
 * ✅ Customer gets job history
 * GET /api/jobs/my/history
 */
router.get('/my/history', auth, authorizeRoles(USER_ROLES.CUSTOMER), async (req, res) => {
  try {
    const jobs = await Job.find({
      customer: req.user._id,
      status: {
        $in: [JOB_STATUSES.COMPLETED, JOB_STATUSES.CANCELLED]
      }
    })
      .populate('assignedTo', 'name email role providerProfile')
      .sort({ updatedAt: -1 })
      .limit(50);

    return res.status(200).json({ jobs });
  } catch (err) {
    return res.status(500).json({ message: 'Could not fetch job history', error: err.message });
  }
});



export default router;
