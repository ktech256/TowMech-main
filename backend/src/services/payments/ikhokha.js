// src/backend/src/services/payments/ikhokha.js
import axios from "axios";
import crypto from "crypto";
import SystemSettings from "../../models/SystemSettings.js";

/**
 * iKhokha (Public API) Paylink / Payment create helper
 *
 * Key fixes vs your current version:
 * - ENTITY_ID is OPTIONAL (iKhokha support says they don't have "entity id")
 * - If ENTITY_ID exists in your DB/env, we still include it (backward compatible)
 * - Signature is computed as HMAC-SHA256 over the EXACT JSON string we send (hex digest)
 * - Better logging for debugging without leaking secrets
 * - More robust validation + URL defaults
 */

// ✅ Base URL (no trailing slash)
const IKHOKHA_BASE_URL = (
  process.env.IKHOKHA_BASE_URL || "https://api.ikhokha.com/public-api/v1"
).replace(/\/+$/, "");

// ✅ Endpoint (paylink create)
const CREATE_PAYLINK_ENDPOINT = `${IKHOKHA_BASE_URL}/api/payment`;

/**
 * ✅ Generate signature (HEX)
 * HMAC-SHA256(payloadString, secret) -> hex (64 chars)
 */
function generateSignatureFromString(payloadString, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(payloadString, "utf8")
    .digest("hex");
}

/**
 * ✅ Load iKhokha keys from DB first, fallback to ENV
 * NOTE: ENTITY_ID is optional; we keep it only for backward compatibility.
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

  // Optional
  const ENTITY_ID = dbEntityId || envEntityId || "";

  return { APP_KEY, APP_SECRET, ENTITY_ID };
}

/**
 * ✅ createPayment() expected by payments.js
 */
async function createPayment({ amount, currency, reference }) {
  const { APP_KEY, APP_SECRET, ENTITY_ID } = await loadIKhokhaKeys();

  // ✅ Only require key + secret
  if (!APP_KEY || !APP_SECRET) {
    console.log("❌ iKhokha Missing:", {
      IKHOKHA_APP_KEY: APP_KEY ? "✅ present" : "❌ missing",
      IKHOKHA_APP_SECRET: APP_SECRET ? "✅ present" : "❌ missing",
      IKHOKHA_ENTITY_ID: ENTITY_ID ? "✅ present (optional)" : "⚪ not set (optional)",
    });

    throw new Error(
      "iKhokha API keys missing ❌ Please update dashboard integrations"
    );
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error(`Invalid amount provided to iKhokha: ${amount}`);
  }

  const amountInCents = Math.round(numericAmount * 100);

  const BACKEND_URL =
    (process.env.BACKEND_URL || "https://towmech-main.onrender.com").replace(
      /\/+$/,
      ""
    );
  const FRONTEND_URL =
    (process.env.FRONTEND_URL || "https://towmech.com").replace(/\/+$/, "");

  // Build payload
  const payload = {
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

  // Backward compatible: only include entityID if you set it in DB/ENV
  if (ENTITY_ID) {
    payload.entityID = ENTITY_ID;
  }

  // IMPORTANT: sign EXACT string we send
  const payloadString = JSON.stringify(payload);
  const signature = generateSignatureFromString(payloadString, APP_SECRET);

  console.log("✅ iKhokha PAYLINK REQUEST:", payloadString);
  console.log("✅ iKhokha SIGNATURE (hex length):", signature.length);

  try {
    // Send the exact JSON string to avoid any serialization differences
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

    // Re-throw a cleaner error while preserving original
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