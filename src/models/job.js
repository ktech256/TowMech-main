import mongoose from 'mongoose';

const jobStates = ['REQUESTED', 'OFFERED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'FAILED'];

const jobSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    type: { type: String, enum: ['mechanic', 'tow'], required: true },
    state: { type: String, enum: jobStates, default: 'REQUESTED' },
    locked: { type: Boolean, default: false },
    price: { type: Number },
    location: { type: String },
    destination: { type: String },
    requestedAt: { type: Date, default: Date.now },
    completedAt: { type: Date }
  },
  {
    timestamps: true
  }
);

export default mongoose.model('Job', jobSchema);
