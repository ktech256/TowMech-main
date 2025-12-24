import express from 'express';
import Job, { JOB_STATUSES } from '../models/Job.js';
import { USER_ROLES } from '../models/User.js';
import auth from '../middleware/auth.js';
import authorizeRoles from '../middleware/role.js';

const router = express.Router();

const isValidTransition = (current, next) => {
  switch (current) {
    case JOB_STATUSES.CREATED:
      return [JOB_STATUSES.ASSIGNED, JOB_STATUSES.CANCELLED].includes(next);
    case JOB_STATUSES.ASSIGNED:
      return [JOB_STATUSES.IN_PROGRESS, JOB_STATUSES.CANCELLED].includes(next);
    case JOB_STATUSES.IN_PROGRESS:
      return [JOB_STATUSES.COMPLETED, JOB_STATUSES.CANCELLED].includes(next);
    default:
      return false;
  }
};

router.post('/', auth, authorizeRoles(USER_ROLES.CUSTOMER), async (req, res) => {
  try {
    const { title, description, location, vehicle, roleNeeded } = req.body;

    if (!title || !roleNeeded) {
      return res.status(400).json({ message: 'Title and roleNeeded are required' });
    }

    const job = await Job.create({
      title,
      description,
      location,
      vehicle,
      roleNeeded,
      customer: req.user._id
    });

    return res.status(201).json({ message: 'Job created', job });
  } catch (err) {
    return res.status(500).json({ message: 'Could not create job', error: err.message });
  }
});

router.get('/', auth, async (req, res) => {
  try {
    const filter = req.user.role === USER_ROLES.CUSTOMER ? { customer: req.user._id } : {};
    const jobs = await Job.find(filter)
      .populate('customer', 'name email role')
      .populate('assignedTo', 'name email role')
      .sort({ createdAt: -1 });
    return res.status(200).json(jobs);
  } catch (err) {
    return res.status(500).json({ message: 'Could not fetch jobs', error: err.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id)
      .populate('customer', 'name email role')
      .populate('assignedTo', 'name email role');

    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    if (
      req.user.role === USER_ROLES.CUSTOMER &&
      job.customer.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: 'Not authorized to view this job' });
    }

    return res.status(200).json(job);
  } catch (err) {
    return res.status(500).json({ message: 'Could not fetch job', error: err.message });
  }
});

router.patch(
  '/:id/assign',
  auth,
  authorizeRoles(USER_ROLES.ADMIN),
  async (req, res) => {
    try {
      const { assignedTo } = req.body;

      if (!assignedTo) {
        return res.status(400).json({ message: 'assignedTo user id is required' });
      }

      const job = await Job.findById(req.params.id);
      if (!job) {
        return res.status(404).json({ message: 'Job not found' });
      }

      if (job.status !== JOB_STATUSES.CREATED) {
        return res.status(400).json({ message: 'Only newly created jobs can be assigned' });
      }

      job.assignedTo = assignedTo;
      job.status = JOB_STATUSES.ASSIGNED;
      await job.save();

      return res.status(200).json({ message: 'Job assigned', job });
    } catch (err) {
      return res.status(500).json({ message: 'Could not assign job', error: err.message });
    }
  }
);

router.patch('/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;

    if (!Object.values(JOB_STATUSES).includes(status)) {
      return res.status(400).json({ message: 'Invalid status provided' });
    }

    const job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    const isCustomerOwner =
      req.user.role === USER_ROLES.CUSTOMER && job.customer.toString() === req.user._id.toString();
    const isAssignedProvider =
      [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK].includes(req.user.role) &&
      job.assignedTo &&
      job.assignedTo.toString() === req.user._id.toString();
    const isAdmin = req.user.role === USER_ROLES.ADMIN;

    if (!isCustomerOwner && !isAssignedProvider && !isAdmin) {
      return res.status(403).json({ message: 'Not authorized to update this job' });
    }

    if (!isValidTransition(job.status, status)) {
      return res
        .status(400)
        .json({ message: `Invalid status transition from ${job.status} to ${status}` });
    }

    job.status = status;
    await job.save();

    return res.status(200).json({ message: 'Job status updated', job });
  } catch (err) {
    return res.status(500).json({ message: 'Could not update job', error: err.message });
  }
});

export default router;
