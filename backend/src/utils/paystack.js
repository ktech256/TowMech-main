import axios from "axios";

const PAYSTACK_BASE_URL = "https://api.paystack.co";

export const initializePaystackTransaction = async ({ email, amount, currency, metadata }) => {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;

  const response = await axios.post(
    `${PAYSTACK_BASE_URL}/transaction/initialize`,
    {
      email,
      amount,
      currency,
      metadata
    },
    {
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json"
      }
    }
  );

  return response.data;
};

export const verifyPaystackTransaction = async (reference) => {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;

  const response = await axios.get(
    `${PAYSTACK_BASE_URL}/transaction/verify/${reference}`,
    {
      headers: {
        Authorization: `Bearer ${secretKey}`
      }
    }
  );

  return response.data;
};