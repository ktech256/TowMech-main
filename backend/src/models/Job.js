import mongoose from 'mongoose';
import { USER_ROLES } from './User.js';

export const JOB_STATUSES = {
  CREATED: 'CREATED',
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED'
};

const jobSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      trim: true
    },
    location: {
      type: String,
      trim: true
    },
    vehicle: {
      type: String,
      trim: true
    },
    status: {
      type: String,
      enum: Object.values(JOB_STATUSES),
      default: JOB_STATUSES.CREATED
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    roleNeeded: {
      type: String,
      enum: [USER_ROLES.MECHANIC, USER_ROLES.TOW_TRUCK],
      required: true
    }
  },
  { timestamps: true }
);

const Job = mongoose.model('Job', jobSchema);

export default Job;
