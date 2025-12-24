import mongoose from 'mongoose';

import app from './app.js';
import { config } from './config/index.js';

const start = async () => {
  try {
    await mongoose.connect(config.mongoUri);
    // eslint-disable-next-line no-console
    console.log('Connected to MongoDB');

    app.listen(config.port, () => {
      // eslint-disable-next-line no-console
      console.log(`TowMech API running on port ${config.port}`);
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to start server', error);
    process.exit(1);
  }
};

start();
