import axios from "axios";

const IKHOKHA_BASE_URL = process.env.IKHOKHA_BASE_URL || "https://dev.ikhokha.com";

// ✅ INIT PAYMENT
export const initializeIKhokhaPayment = async ({
  amount,
  currency,
  reference,
  customerEmail,
  metadata
}) => {
  const apiKey = process.env.IKHOKHA_API_KEY;
  const secretKey = process.env.IKHOKHA_SECRET_KEY;

  const response = await axios.post(
    `${IKHOKHA_BASE_URL}/pay/api/v1/transactions/initiate`,
    {
      amount,
      currency,
      reference,
      customerEmail,
      metadata
    },
    {
      headers: {
        "Content-Type": "application/json",
        "IK-API-KEY": apiKey,
        "IK-SECRET": secretKey
      }
    }
  );

  // ✅ TEMP LOG (DO NOT REMOVE UNTIL WE CONFIRM RESPONSE FIELDS)
  console.log("✅ iKhokha INIT FULL RESPONSE:", response.data);

  return response.data;
};

// ✅ VERIFY PAYMENT
export const verifyIKhokhaPayment = async (reference) => {
  const apiKey = process.env.IKHOKHA_API_KEY;
  const secretKey = process.env.IKHOKHA_SECRET_KEY;

  const response = await axios.get(
    `${IKHOKHA_BASE_URL}/pay/api/v1/transactions/${reference}`,
    {
      headers: {
        "IK-API-KEY": apiKey,
        "IK-SECRET": secretKey
      }
    }
  );

  // ✅ TEMP LOG (DO NOT REMOVE UNTIL WE CONFIRM RESPONSE FIELDS)
  console.log("✅ iKhokha VERIFY FULL RESPONSE:", response.data);

  return response.data;
};