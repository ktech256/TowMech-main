import User from '../models/user.js';

export const createUser = async (payload) => {
  const user = new User(payload);
  return user.save();
};

export const listUsers = async () => {
  return User.find({});
};
