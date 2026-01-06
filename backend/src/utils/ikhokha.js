import axios from "axios";

// ✅ Correct iKhokha Public API Base URL
const IKHOKHA_BASE_URL =
  process.env.IKHOKHA_BASE_URL || "https://api.ikhokha.com/public-api/v1";

// ✅ ENV Vars (must exist in Render)
const ENTITY_ID = process.env.IKHOKHA_ENTITY_ID;
const APP_KEY = process.env.IKHOKHA_APP_KEY;
const APP_SECRET = process.env.IKHOKHA_APP_SECRET;

// ✅ ENDPOINT
const CREATE_PAYLINK_ENDPOINT = `${IKHOKHA_BASE_URL}/api/payment`;

/**
 * ✅ CREATE PAYMENT LINK (PAYLINK)
 * iKhokha returns: paylinkUrl + externalTransactionID
 */
export const initializeIKhokhaPayment = async ({
  amount,
  currency,
  reference,
  customerEmail,
  metadata
}) => {
  try {
    if (!ENTITY_ID || !APP_KEY || !APP_SECRET) {
      console.log("❌ iKhokha ENV Missing:", {
        ENTITY_ID,
        APP_KEY: APP_KEY ? "✅ present" : "❌ missing",
        APP_SECRET: APP_SECRET ? "✅ present" : "❌ missing"
      });

      throw new Error("Missing iKhokha ENV variables");
    }

    // ✅ Convert amount to cents (smallest unit)
    // ZAR 130.00 → 13000
    const amountInCents = Math.round(Number(amount) * 100);

    const payload = {
      entityID: ENTITY_ID,
      amount: amountInCents,
      currency: currency || "ZAR",
      requesterUrl: "https://towmech-main.onrender.com",
      mode: "live", // change to "test" if your iKhokha account is test
      externalTransactionID: reference,
      description: `TowMech Booking Fee - ${reference}`,
      urls: {
        callbackUrl: "https://towmech-main.onrender.com/api/payments/verify/ikhokha/" + reference,
        successPageUrl: "https://towmech.com/payment-success",
        failurePageUrl: "https://towmech.com/payment-failed",
        cancelUrl: "https://towmech.com/payment-cancelled"
      }
    };

    console.log("✅ iKhokha PAYLINK REQUEST PAYLOAD:", JSON.stringify(payload, null, 2));

    const response = await axios.post(CREATE_PAYLINK_ENDPOINT, payload, {
      headers: {
        "Content-Type": "application/json",
        AppKey: APP_KEY,
        AppSecret: APP_SECRET
      }
    });

    console.log("✅ iKhokha PAYLINK RAW RESPONSE:", JSON.stringify(response.data, null, 2));

    return response.data;
  } catch (err) {
    console.log("❌ iKhokha INIT ERROR:", err.response?.data || err.message);
    throw err;
  }
};

/**
 * ✅ VERIFY PAYMENT (NO OFFICIAL VERIFY ENDPOINT IN PAYLINK API)
 * You will verify by:
 * - callbackUrl hit
 * OR
 * - manual check using your dashboard
 * For now return a placeholder until iKhokha provides verify endpoint
 */
export const verifyIKhokhaPayment = async (reference) => {
  try {
    console.log("⚠️ iKhokha VERIFY HIT (NO DIRECT VERIFY API):", reference);

    return {
      message: "Verification not supported directly by Paylink API",
      reference,
      status: "PENDING"
    };
  } catch (err) {
    console.log("❌ iKhokha VERIFY ERROR:", err.response?.data || err.message);
    throw err;
  }
};