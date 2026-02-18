import axios from "axios";
import crypto from "crypto";
import SystemSettings from "../../models/SystemSettings.js";

/**
 * iK Pay API (Create Payment Link)
 * Aligns with dev.ikhokha.com fields shown in your screenshot:
 * - entityID (REQUIRED) = Application key ID  -> we use APP_KEY
 * - externalEntityID (OPTIONAL)
 * - amount (REQUIRED) in smallest unit (cents for ZAR)
 * - currency (REQUIRED)
 * - requesterUrl (REQUIRED)
 * - mode (REQUIRED) e.g. "live"
 * - externalTransactionID (REQUIRED)
 * - description (OPTIONAL)
 * - urls.callbackUrl (REQUIRED)
 * - urls.successPageUrl (REQUIRED)
 * - urls.failurePageUrl (REQUIRED)
 * - urls.cancelUrl (OPTIONAL)
 *
 * Signature:
 * HMAC-SHA256 over the EXACT JSON string sent in the request body, hex digest.
 * Headers:
 * IK-APPID = APP_KEY
 * IK-SIGN  = signature
 */

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
 * NOTE: We do NOT require a separate "entity id" because iKhokha requires entityID
 * and defines it as the Application key ID (APP_KEY) in your screenshot.
 */
async function loadIKhokhaKeys() {
  const settings = await SystemSettings.findOne();

  const dbKey = settings?.integrations?.ikhApiKey?.trim();
  const dbSecret = settings?.integrations?.ikhSecretKey?.trim();
  const dbExternalEntityId = settings?.integrations?.ikhExternalEntityId?.trim(); // optional (if you later add it)

  const envKey = process.env.IKHOKHA_APP_KEY?.trim();
  const envSecret = process.env.IKHOKHA_APP_SECRET?.trim();
  const envExternalEntityId = process.env.IKHOKHA_EXTERNAL_ENTITY_ID?.trim(); // optional

  const APP_KEY = dbKey || envKey;
  const APP_SECRET = dbSecret || envSecret;
  const EXTERNAL_ENTITY_ID = dbExternalEntityId || envExternalEntityId || "";

  return { APP_KEY, APP_SECRET, EXTERNAL_ENTITY_ID };
}

/**
 * ✅ createPayment() expected by payments.js
 */
async function createPayment({ amount, currency, reference, externalEntityId }) {
  const { APP_KEY, APP_SECRET, EXTERNAL_ENTITY_ID } = await loadIKhokhaKeys();

  // ✅ Require only key + secret
  if (!APP_KEY || !APP_SECRET) {
    console.log("❌ iKhokha Missing:", {
      IKHOKHA_APP_KEY: APP_KEY ? "✅ present" : "❌ missing",
      IKHOKHA_APP_SECRET: APP_SECRET ? "✅ present" : "❌ missing",
    });

    throw new Error(
      "iKhokha API keys missing ❌ Please update dashboard integrations"
    );
  }

  // amount must be numeric; convert to cents (smallest unit)
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

  // ✅ Build payload matching screenshot fields
  const payload = {
    // REQUIRED (per screenshot): Application key ID
    entityID: APP_KEY,

    // OPTIONAL (per screenshot): 3rd party account identifier
    ...(externalEntityId || EXTERNAL_ENTITY_ID
      ? { externalEntityID: externalEntityId || EXTERNAL_ENTITY_ID }
      : {}),

    // REQUIRED: smallest unit
    amount: amountInCents,

    // REQUIRED
    currency: currency || "ZAR",

    // REQUIRED: URL from which call originates
    requesterUrl: BACKEND_URL,

    // REQUIRED
    mode: "live",

    // REQUIRED: unique transaction ID
    externalTransactionID: reference,

    // OPTIONAL
    description: `TowMech Booking Fee - ${reference}`,

    // REQUIRED/OPTIONAL URLs (as per screenshot)
    urls: {
      callbackUrl: `${BACKEND_URL}/api/payments/verify/ikhokha/${reference}`,
      successPageUrl: `${FRONTEND_URL}/payment-success`,
      failurePageUrl: `${FRONTEND_URL}/payment-failed`,
      cancelUrl: `${FRONTEND_URL}/payment-cancelled`, // optional in docs; safe to include
    },
  };

  // Sign EXACT JSON string we send
  const payloadString = JSON.stringify(payload);
  const signature = generateSignatureFromString(payloadString, APP_SECRET);

  console.log("✅ iKhokha PAYLINK REQUEST:", payloadString);
  console.log("✅ iKhokha SIGNATURE (hex length):", signature.length);

  try {
    // Send exact string to avoid any serialization differences
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