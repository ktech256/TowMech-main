import axios from "axios";
import crypto from "crypto";

// ✅ Correct iKhokha Public API Base URL
const IKHOKHA_BASE_URL =
  process.env.IKHOKHA_BASE_URL || "https://api.ikhokha.com/public-api/v1";

// ✅ ENV Vars (must exist in Render)
const APP_KEY = process.env.IKHOKHA_APP_KEY;
const APP_SECRET = process.env.IKHOKHA_APP_SECRET;

// ✅ ENDPOINT
const CREATE_PAYLINK_ENDPOINT = `${IKHOKHA_BASE_URL}/api/payment`;

/**
 * ✅ Generate iKhokha Signature (IK-SIGN)
 * signature = base64(sha512(payload + APP_SECRET))
 */
const generateSignature = (payload) => {
  const payloadString = JSON.stringify(payload);

  return crypto
    .createHash("sha512")
    .update(payloadString + APP_SECRET)
    .digest("base64");
};

/**
 * ✅ CREATE PAYMENT LINK (PAYLINK)
 * iKhokha returns: paylinkUrl + externalTransactionID
 */
export const initializeIKhokhaPayment = async ({
  amount,
  currency,
  reference
}) => {
  try {
    // ✅ ENV CHECK (ENTITY REMOVED)
    if (!APP_KEY || !APP_SECRET) {
      console.log("❌ iKhokha ENV Missing:", {
        APP_KEY: APP_KEY ? "✅ present" : "❌ missing",
        APP_SECRET: APP_SECRET ? "✅ present" : "❌ missing"
      });

      throw new Error("Missing iKhokha ENV variables");
    }

    // ✅ Convert amount to cents (smallest unit)
    const amountInCents = Math.round(Number(amount) * 100);

    // ✅ PAYLOAD (ENTITY ID REMOVED)
    const payload = {
      amount: amountInCents,
      currency: currency || "ZAR",
      requesterUrl: "https://towmech-main.onrender.com",
      mode: "live", // or "test"
      externalTransactionID: reference,
      description: `TowMech Booking Fee - ${reference}`,
      urls: {
        callbackUrl: `https://towmech-main.onrender.com/api/payments/verify/ikhokha/${reference}`,
        successPageUrl: "https://towmech.com/payment-success",
        failurePageUrl: "https://towmech.com/payment-failed",
        cancelUrl: "https://towmech.com/payment-cancelled"
      }
    };

    console.log(
      "✅ iKhokha PAYLINK REQUEST PAYLOAD:",
      JSON.stringify(payload, null, 2)
    );

    // ✅ Generate signature
    const signature = generateSignature(payload);

    const response = await axios.post(CREATE_PAYLINK_ENDPOINT, payload, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "IK-APPID": APP_KEY.trim(),
        "IK-SIGN": signature.trim()
      }
    });

    console.log(
      "✅ iKhokha PAYLINK RAW RESPONSE:",
      JSON.stringify(response.data, null, 2)
    );

    return response.data;

  } catch (err) {
    console.log("❌ iKhokha INIT ERROR:", err.response?.data || err.message);
    throw err;
  }
};

/**
 * ✅ VERIFY PAYMENT (NO OFFICIAL VERIFY ENDPOINT IN PAYLINK API)
 */
export const verifyIKhokhaPayment = async (reference) => {
  console.log("⚠️ iKhokha VERIFY HIT (NO DIRECT VERIFY API):", reference);

  return {
    message: "Verification not supported directly by Paylink API",
    reference,
    status: "PENDING"
  };
};