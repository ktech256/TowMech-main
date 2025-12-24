import Job from '../models/job.js';

export const createJob = async (payload) => {
  const job = new Job(payload);
  return job.save();
};

export const listJobs = async () => {
  return Job.find({}).populate('customer provider');
};
