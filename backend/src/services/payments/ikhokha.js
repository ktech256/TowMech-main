import axios from "axios";
import crypto from "crypto";
import SystemSettings from "../../models/SystemSettings.js";

// ✅ Correct iKhokha Public API Base URL
const IKHOKHA_BASE_URL =
  process.env.IKHOKHA_BASE_URL || "https://api.ikhokha.com/public-api/v1";

// ✅ ENDPOINT
const CREATE_PAYLINK_ENDPOINT = `${IKHOKHA_BASE_URL}/api/payment`;

/**
 * ✅ Generate iKhokha Signature
 * signature = base64(sha512(payload + secret))
 */
const generateSignature = (payload, secret) => {
  const payloadString = JSON.stringify(payload);

  return crypto
    .createHash("sha512")
    .update(payloadString + secret)
    .digest("base64");
};

/**
 * ✅ Load iKhokha keys from DB first
 * ✅ fallback to ENV if DB empty
 */
async function loadIKhokhaKeys() {
  const settings = await SystemSettings.findOne();

  const dbKey = settings?.integrations?.ikhApiKey?.trim();
  const dbSecret = settings?.integrations?.ikhSecretKey?.trim();

  const envKey = process.env.IKHOKHA_APP_KEY?.trim();
  const envSecret = process.env.IKHOKHA_APP_SECRET?.trim();

  const APP_KEY = dbKey || envKey;
  const APP_SECRET = dbSecret || envSecret;

  return { APP_KEY, APP_SECRET };
}

/**
 * ✅ MAIN PAYMENT METHOD EXPECTED BY payments.js
 * This matches:
 * gatewayAdapter.createPayment(...)
 */
async function createPayment({
  amount,
  currency,
  reference
}) {
  const { APP_KEY, APP_SECRET } = await loadIKhokhaKeys();

  if (!APP_KEY || !APP_SECRET) {
    console.log("❌ iKhokha keys missing in both DB and ENV");
    throw new Error("iKhokha API keys missing ❌ Please update dashboard integrations");
  }

  // ✅ Convert amount to cents
  const amountInCents = Math.round(Number(amount) * 100);

  const payload = {
    amount: amountInCents,
    currency: currency || "ZAR",
    requesterUrl: process.env.BACKEND_URL || "https://towmech-main.onrender.com",
    mode: "live", // or "test"
    externalTransactionID: reference,
    description: `TowMech Booking Fee - ${reference}`,
    urls: {
      callbackUrl: `${process.env.BACKEND_URL || "https://towmech-main.onrender.com"}/api/payments/verify/ikhokha/${reference}`,
      successPageUrl: `${process.env.FRONTEND_URL || "https://towmech.com"}/payment-success`,
      failurePageUrl: `${process.env.FRONTEND_URL || "https://towmech.com"}/payment-failed`,
      cancelUrl: `${process.env.FRONTEND_URL || "https://towmech.com"}/payment-cancelled`
    }
  };

  console.log("✅ iKhokha PAYLINK REQUEST:", JSON.stringify(payload, null, 2));

  const signature = generateSignature(payload, APP_SECRET);

  const response = await axios.post(CREATE_PAYLINK_ENDPOINT, payload, {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "IK-APPID": APP_KEY,
      "IK-SIGN": signature
    }
  });

  console.log("✅ iKhokha RESPONSE:", JSON.stringify(response.data, null, 2));

  return response.data;
}

/**
 * ✅ Export adapter expected by index.js
 */
export default {
  createPayment
};