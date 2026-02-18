import axios from "axios";
import crypto from "crypto";
import SystemSettings from "../../models/SystemSettings.js";

// ✅ Base URL (no trailing slash)
const IKHOKHA_BASE_URL = (
  process.env.IKHOKHA_BASE_URL || "https://api.ikhokha.com/public-api/v1"
).replace(/\/+$/, "");

// ✅ Endpoint
const CREATE_PAYLINK_ENDPOINT = `${IKHOKHA_BASE_URL}/api/payment`;

/**
 * ✅ HMAC-SHA256(payloadString, secret) -> HEX
 */
function generateSignatureFromString(payloadString, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(payloadString, "utf8")
    .digest("hex");
}

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

  // ✅ Ensure all exist (entityID is REQUIRED by the API per Render logs)
  if (!APP_KEY || !APP_SECRET || !ENTITY_ID) {
    console.log("❌ iKhokha Missing:", {
      IKHOKHA_APP_KEY: APP_KEY ? "✅ present" : "❌ missing",
      IKHOKHA_APP_SECRET: APP_SECRET ? "✅ present" : "❌ missing",
      IKHOKHA_ENTITY_ID: ENTITY_ID ? "✅ present" : "❌ missing (REQUIRED by /api/payment)",
    });

    throw new Error(
      "iKhokha config missing ❌ Please update dashboard integrations (APP_KEY, APP_SECRET, ENTITY_ID)"
    );
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error(`Invalid amount provided to iKhokha: ${amount}`);
  }

  const amountInCents = Math.round(numericAmount * 100);

  const BACKEND_URL =
    (process.env.BACKEND_URL || "https://towmech-main.onrender.com").replace(/\/+$/, "");
  const FRONTEND_URL =
    (process.env.FRONTEND_URL || "https://towmech.com").replace(/\/+$/, "");

  const payload = {
    entityID: ENTITY_ID, // ✅ REQUIRED by API
    amount: amountInCents,
    currency: currency || "ZAR",
    requesterUrl: BACKEND_URL,
    mode: "live",
    externalTransactionID: reference,
    description: `TowMech Booking Fee - ${reference}`,
    urls: {
      callbackUrl: `${BACKEND_URL}/api/payments/verify/ikhokha/${reference}`,
      successPageUrl: `${FRONTEND_URL}/payment-success`,
      failurePageUrl: `${FRONTEND_URL}/payment-failed`,
      cancelUrl: `${FRONTEND_URL}/payment-cancelled`,
    },
  };

  // Sign EXACT string we send
  const payloadString = JSON.stringify(payload);
  const signature = generateSignatureFromString(payloadString, APP_SECRET);

  console.log("✅ iKhokha PAYLINK REQUEST:", payloadString);
  console.log("✅ iKhokha SIGNATURE (hex length):", signature.length);

  try {
    // Send exact string to avoid serialization differences
    const response = await axios.post(CREATE_PAYLINK_ENDPOINT, payloadString, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "IK-APPID": APP_KEY,
        "IK-SIGN": signature,
      },
      timeout: 30000,
    });

    console.log("✅ iKhokha RESPONSE:", JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (err) {
    const status = err.response?.status;
    const data = err.response?.data;

    console.log("❌ iKhokha API ERROR:", {
      status,
      data: data || err.message,
      endpoint: CREATE_PAYLINK_ENDPOINT,
    });

    const message =
      (data && (data.message || data.error || JSON.stringify(data))) ||
      err.message ||
      "Unknown iKhokha error";

    const wrapped = new Error(`iKhokha request failed: ${message}`);
    wrapped.cause = err;
    throw wrapped;
  }
}

export default {
  createPayment,
};