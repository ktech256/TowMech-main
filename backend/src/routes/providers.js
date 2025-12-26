import express from 'express';
import auth from '../middleware/auth.js';
import User, { USER_ROLES } from '../models/User.js';
import Job from '../models/Job.js';

const router = express.Router();

/**
 * ✅ Provider updates online/offline + current location
 * PATCH /api/providers/me/status
 */
router.patch('/me/status', auth, async (req, res) => {
  try {
    const { isOnline, lat, lng, towTruckTypes, carTypesSupported } = req.body;

    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Only service providers can update status' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.providerProfile) user.providerProfile = {};

    if (typeof isOnline === 'boolean') user.providerProfile.isOnline = isOnline;

    if (lat !== undefined && lng !== undefined) {
      user.providerProfile.location = {
        type: 'Point',
        coordinates: [lng, lat]
      };
    }

    user.providerProfile.lastSeenAt = new Date();

    // Optional update capabilities
    if (Array.isArray(towTruckTypes)) user.providerProfile.towTruckTypes = towTruckTypes;
    if (Array.isArray(carTypesSupported)) user.providerProfile.carTypesSupported = carTypesSupported;

    await user.save();

    return res
      .status(200)
      .json({ message: 'Provider status updated', providerProfile: user.providerProfile });
  } catch (err) {
    return res.status(500).json({ message: 'Could not update provider status', error: err.message });
  }
});

/**
 * ✅ Provider fetches jobs broadcasted to them
 * GET /api/providers/jobs/broadcasted
 */
router.get('/jobs/broadcasted', auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Only providers can view broadcasted jobs' });
    }

    const jobs = await Job.find({
      status: 'BROADCASTED',
      assignedTo: null,
      broadcastedTo: req.user._id
    })
      .sort({ createdAt: -1 })
      .limit(20);

    return res.status(200).json({ jobs });
  } catch (err) {
    return res.status(500).json({ message: 'Could not fetch broadcasted jobs', error: err.message });
  }
});

/**
 * ✅ Provider accepts job (first accept wins)
 * PATCH /api/providers/jobs/:jobId/accept
 */
router.patch('/jobs/:jobId/accept', auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Only providers can accept jobs' });
    }

    const job = await Job.findOneAndUpdate(
      {
        _id: req.params.jobId,
        status: 'BROADCASTED',
        assignedTo: null,
        broadcastedTo: req.user._id
      },
      {
        assignedTo: req.user._id,
        status: 'ASSIGNED',
        lockedAt: new Date()
      },
      { new: true }
    );

    if (!job) {
      return res.status(409).json({ message: 'Job already claimed or not available' });
    }

    return res.status(200).json({ message: 'Job accepted', job });
  } catch (err) {
    return res.status(500).json({ message: 'Could not accept job', error: err.message });
  }
});

/**
 * ✅ Provider rejects job (does not accept)
 * PATCH /api/providers/jobs/:jobId/reject
 */
router.patch('/jobs/:jobId/reject', auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];
    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Only providers can reject jobs' });
    }

    const job = await Job.findOne({
      _id: req.params.jobId,
      status: 'BROADCASTED',
      assignedTo: null,
      broadcastedTo: req.user._id
    });

    if (!job) {
      return res.status(404).json({ message: 'Job not found or not available' });
    }

    // remove provider from broadcast list
    job.broadcastedTo = job.broadcastedTo.filter(
      (id) => id.toString() !== req.user._id.toString()
    );

    await job.save();

    return res.status(200).json({ message: 'Job rejected', jobId: job._id });
  } catch (err) {
    return res.status(500).json({ message: 'Could not reject job', error: err.message });
  }
});

/**
 * ✅ Provider cancels job → job is re-broadcasted automatically
 * PATCH /api/providers/jobs/:jobId/cancel
 */
router.patch('/jobs/:jobId/cancel', auth, async (req, res) => {
  try {
    const providerRoles = [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK];

    if (!providerRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Only providers can cancel jobs' });
    }

    const job = await Job.findById(req.params.jobId);

    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    // ✅ Only the assigned provider can cancel
    if (!job.assignedTo || job.assignedTo.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to cancel this job' });
    }

    // ✅ Cannot cancel completed job
    if (job.status === JOB_STATUSES.COMPLETED) {
      return res.status(400).json({ message: 'Cannot cancel a completed job' });
    }

    // ✅ Add provider to excluded list so they won't receive this job again
    if (!job.excludedProviders) job.excludedProviders = [];
    if (!job.excludedProviders.includes(req.user._id)) {
      job.excludedProviders.push(req.user._id);
    }

    // ✅ Reset job to broadcast mode
    job.assignedTo = null;
    job.lockedAt = null;
    job.status = JOB_STATUSES.BROADCASTED;
    job.broadcastedTo = [];

    job.cancelledBy = req.user._id;
    job.cancelReason = req.body.reason || 'Cancelled by provider';
    job.cancelledAt = new Date();

    await job.save();

    // ✅ Find new providers (excluding those already excluded)
    const newProviders = await User.find({
      role: job.roleNeeded,
      'providerProfile.isOnline': true,
      _id: { $nin: job.excludedProviders }
    }).limit(10);

    // ✅ Assign broadcast list
    job.broadcastedTo = newProviders.map((p) => p._id);

    // ✅ Add dispatch attempts
    job.dispatchAttempts = job.dispatchAttempts || [];
    newProviders.forEach((p) => {
      job.dispatchAttempts.push({
        providerId: p._id,
        attemptedAt: new Date()
      });
    });

    await job.save();

    return res.status(200).json({
      message: 'Provider cancelled. Job rebroadcasted.',
      job,
      broadcastedTo: job.broadcastedTo
    });
  } catch (err) {
    return res.status(500).json({
      message: 'Could not cancel and rebroadcast job',
      error: err.message
    });
  }
});


export default router;
