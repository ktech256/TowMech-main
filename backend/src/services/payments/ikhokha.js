import axios from "axios";
import crypto from "crypto";
import SystemSettings from "../../models/SystemSettings.js";

// ✅ Base URL
const IKHOKHA_BASE_URL =
  process.env.IKHOKHA_BASE_URL || "https://api.ikhokha.com/public-api/v1";

// ✅ Endpoint
const CREATE_PAYLINK_ENDPOINT = `${IKHOKHA_BASE_URL}/api/payment`;

/**
 * ✅ Correct iKhokha Signature
 * ✅ HMAC-SHA256(payload, secret) -> HEX
 */
const generateSignature = (payload, secret) => {
  const payloadString = JSON.stringify(payload);

  return crypto
    .createHmac("sha256", secret)
    .update(payloadString)
    .digest("hex");
};

/**
 * ✅ Load iKhokha keys from DB first, fallback ENV
 */
async function loadIKhokhaKeys() {
  const settings = await SystemSettings.findOne();

  const dbKey = settings?.integrations?.ikhApiKey?.trim();
  const dbSecret = settings?.integrations?.ikhSecretKey?.trim();
  const dbEntityId = settings?.integrations?.ikhEntityId?.trim();

  const envKey = process.env.IKHOKHA_APP_KEY?.trim();
  const envSecret = process.env.IKHOKHA_APP_SECRET?.trim();
  const envEntityId = process.env.IKHOKHA_ENTITY_ID?.trim();

  const APP_KEY = dbKey || envKey;
  const APP_SECRET = dbSecret || envSecret;
  const ENTITY_ID = dbEntityId || envEntityId;

  return { APP_KEY, APP_SECRET, ENTITY_ID };
}

/**
 * ✅ createPayment() expected by payments.js
 */
async function createPayment({ amount, currency, reference }) {
  const { APP_KEY, APP_SECRET, ENTITY_ID } = await loadIKhokhaKeys();

  // ✅ Ensure all exist
  if (!APP_KEY || !APP_SECRET || !ENTITY_ID) {
    console.log("❌ iKhokha Missing:", {
      APP_KEY: APP_KEY ? "✅ present" : "❌ missing",
      APP_SECRET: APP_SECRET ? "✅ present" : "❌ missing",
      ENTITY_ID: ENTITY_ID ? "✅ present" : "❌ missing",
    });

    throw new Error("iKhokha API keys missing ❌ Please update dashboard integrations");
  }

  const amountInCents = Math.round(Number(amount) * 100);

  const payload = {
    entityID: ENTITY_ID,
    amount: amountInCents,
    currency: currency || "ZAR",
    requesterUrl: process.env.BACKEND_URL || "https://towmech-main.onrender.com",
    mode: "live",
    externalTransactionID: reference,
    description: `TowMech Booking Fee - ${reference}`,
    urls: {
      callbackUrl: `${process.env.BACKEND_URL || "https://towmech-main.onrender.com"}/api/payments/verify/ikhokha/${reference}`,
      successPageUrl: `${process.env.FRONTEND_URL || "https://towmech.com"}/payment-success`,
      failurePageUrl: `${process.env.FRONTEND_URL || "https://towmech.com"}/payment-failed`,
      cancelUrl: `${process.env.FRONTEND_URL || "https://towmech.com"}/payment-cancelled`,
    },
  };

  console.log("✅ iKhokha PAYLINK REQUEST:", JSON.stringify(payload, null, 2));

  // ✅ Correct Signature
  const signature = generateSignature(payload, APP_SECRET);

  console.log("✅ iKhokha SIGNATURE (hex):", signature);

  try {
    const response = await axios.post(CREATE_PAYLINK_ENDPOINT, payload, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "IK-APPID": APP_KEY,
        "IK-SIGN": signature,
      },
    });

    console.log("✅ iKhokha RESPONSE:", JSON.stringify(response.data, null, 2));
    return response.data;

  } catch (err) {
    console.log("❌ iKhokha API ERROR:", err.response?.data || err.message);
    throw err;
  }
}

export default {
  createPayment,
};