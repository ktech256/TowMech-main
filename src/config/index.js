import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: process.env.PORT || 4000,
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/towmech',
  jwtSecret: process.env.JWT_SECRET || 'change-me',
  environment: process.env.NODE_ENV || 'development'
};
