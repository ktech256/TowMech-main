import axios from "axios";
import crypto from "crypto";
import { URL } from "url";
import SystemSettings from "../../models/SystemSettings.js";

/**
 * iKhokha iK Pay API - Create Payment Link
 *
 * ✅ Fully aligned to iKhokha spec you pasted:
 *   IK-SIGN = HMAC_SHA256( path + requestBody , AppSecret )  -> HEX
 *   Headers:
 *     IK-APPID: Application ID (AppID / application key)
 *     IK-SIGN : Signature
 *
 * ✅ Request body fields aligned to spec:
 * {
 *   entityID, externalEntityID, amount, currency, requesterUrl, mode, externalTransactionID,
 *   urls: { callbackUrl, successPageUrl, failurePageUrl, cancelUrl }
 * }
 */

// Base URL (no trailing slash)
const IKHOKHA_BASE_URL = (
  process.env.IKHOKHA_BASE_URL || "https://api.ikhokha.com/public-api/v1"
).replace(/\/+$/, "");

// Endpoint path and full endpoint
const PAYMENT_PATH = "/api/payment";
const CREATE_PAYLINK_ENDPOINT = `${IKHOKHA_BASE_URL}${PAYMENT_PATH}`;

/**
 * Escape exactly like iKhokha JS sample:
 * return str.replace(/[\\"']/g, "\\$&").replace(/\u0000/g, "\\0");
 */
function jsStringEscape(str) {
  return String(str)
    .replace(/[\\"']/g, "\\$&")
    .replace(/\u0000/g, "\\0");
}

/**
 * Create payload to sign per iKhokha:
 * payloadToSign = path + requestBody
 * where path is the URL pathname (including query if present; their sample uses parsedUrl.path)
 */
function createPayloadToSign(fullUrlOrPath, bodyString = "") {
  // If a full URL is provided, extract .pathname + .search.
  // If a path is provided, use it as-is.
  let basePath = "";

  try {
    if (String(fullUrlOrPath).startsWith("http")) {
      const u = new URL(fullUrlOrPath);
      basePath = `${u.pathname}${u.search || ""}`;
    } else {
      // ensure it starts with "/"
      basePath = String(fullUrlOrPath).startsWith("/")
        ? String(fullUrlOrPath)
        : `/${String(fullUrlOrPath)}`;
    }

    if (!basePath) throw new Error("No basePath in url");
    const payload = basePath + (bodyString || "");
    return jsStringEscape(payload);
  } catch (e) {
    console.log("❌ Error in createPayloadToSign:", e?.message || e);
    throw e;
  }
}

/**
 * Generate IK-SIGN:
 * IK-SIGN = HMAC_SHA256(path + requestBody, AppSecret) -> hex
 */
function generateIkSign({ endpointUrl, requestBodyString, appSecret }) {
  const payloadToSign = createPayloadToSign(endpointUrl, requestBodyString);

  return crypto
    .createHmac("sha256", String(appSecret).trim())
    .update(payloadToSign, "utf8")
    .digest("hex");
}

/**
 * Load keys from DB first, fallback ENV (your original behavior).
 * NOTE: If your DB contains stale values, it can override Render env and break signatures.
 * We'll log the source used (without printing secrets).
 */
async function loadIKhokhaKeys() {
  const settings = await SystemSettings.findOne();

  const dbAppId = settings?.integrations?.ikhApiKey?.trim(); // Application ID (AppID)
  const dbSecret = settings?.integrations?.ikhSecretKey?.trim(); // App Secret
  const dbExternalEntityId = settings?.integrations?.ikhExternalEntityId?.trim(); // optional (if you add it)
  const dbEntityId = settings?.integrations?.ikhEntityId?.trim(); // optional (if you store entityID separately)

  const envAppId = process.env.IKHOKHA_APP_KEY?.trim();
  const envSecret = process.env.IKHOKHA_APP_SECRET?.trim();
  const envExternalEntityId = process.env.IKHOKHA_EXTERNAL_ENTITY_ID?.trim(); // optional
  const envEntityId = process.env.IKHOKHA_ENTITY_ID?.trim(); // optional

  const APP_ID = dbAppId || envAppId;
  const APP_SECRET = dbSecret || envSecret;

  // Per your docs: entityID is a required request field. You can supply it explicitly,
  // but in many setups it matches APP_ID. We'll use ENTITY_ID if provided, else fallback to APP_ID.
  const ENTITY_ID = (dbEntityId || envEntityId || APP_ID || "").trim();

  const EXTERNAL_ENTITY_ID = (dbExternalEntityId || envExternalEntityId || "").trim();

  const source = {
    appId: dbAppId ? "db" : envAppId ? "env" : "missing",
    secret: dbSecret ? "db" : envSecret ? "env" : "missing",
    entityId: dbEntityId ? "db" : envEntityId ? "env" : APP_ID ? "derived-from-appId" : "missing",
    externalEntityId: dbExternalEntityId ? "db" : envExternalEntityId ? "env" : "not-set",
  };

  return { APP_ID, APP_SECRET, ENTITY_ID, EXTERNAL_ENTITY_ID, source };
}

/**
 * createPayment() expected by payments.js
 */
async function createPayment({ amount, currency, reference }) {
  const { APP_ID, APP_SECRET, ENTITY_ID, EXTERNAL_ENTITY_ID, source } =
    await loadIKhokhaKeys();

  if (!APP_ID || !APP_SECRET) {
    console.log("❌ iKhokha Missing:", {
      IKHOKHA_APP_KEY: APP_ID ? "✅ present" : "❌ missing",
      IKHOKHA_APP_SECRET: APP_SECRET ? "✅ present" : "❌ missing",
      source,
    });
    throw new Error("iKhokha API keys missing ❌ Please update dashboard integrations");
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error(`Invalid amount provided to iKhokha: ${amount}`);
  }

  // iKhokha expects smallest unit (cents for ZAR)
  const amountInCents = Math.round(numericAmount * 100);

  const BACKEND_URL =
    (process.env.BACKEND_URL || "https://towmech-main.onrender.com").replace(/\/+$/, "");
  const FRONTEND_URL =
    (process.env.FRONTEND_URL || "https://towmech.com").replace(/\/+$/, "");

  // Build request exactly per spec
  const payload = {
    entityID: ENTITY_ID, // REQUIRED
    // externalEntityID is OPTIONAL (only include if set)
    ...(EXTERNAL_ENTITY_ID ? { externalEntityID: EXTERNAL_ENTITY_ID } : {}),
    amount: amountInCents,
    currency: currency || "ZAR",
    requesterUrl: BACKEND_URL,
    mode: "live",
    externalTransactionID: reference,
    urls: {
      callbackUrl: `${BACKEND_URL}/api/payments/verify/ikhokha/${reference}`,
      successPageUrl: `${FRONTEND_URL}/payment-success`,
      failurePageUrl: `${FRONTEND_URL}/payment-failed`,
      cancelUrl: `${FRONTEND_URL}/payment-cancelled`,
    },
  };

  const requestBodyString = JSON.stringify(payload);

  // ✅ Signature per iKhokha: path + body
  const signature = generateIkSign({
    endpointUrl: CREATE_PAYLINK_ENDPOINT, // sample uses apiEndPoint (full URL); we follow that
    requestBodyString,
    appSecret: APP_SECRET,
  });

  console.log("✅ iKhokha KEY SOURCE:", source);
  console.log("✅ iKhokha PAYLINK REQUEST:", requestBodyString);
  console.log("✅ iKhokha SIGNATURE (hex length):", signature.length);

  try {
    // Send the string we signed to avoid serialization mismatches
    const response = await axios.post(CREATE_PAYLINK_ENDPOINT, requestBodyString, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "IK-APPID": APP_ID.trim(),
        "IK-SIGN": signature.trim(),
      },
      timeout: 30000,
    });

    console.log("✅ iKhokha RESPONSE:", JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (err) {
    console.log("❌ iKhokha API ERROR:", {
      status: err.response?.status,
      data: err.response?.data || err.message,
      endpoint: CREATE_PAYLINK_ENDPOINT,
    });
    throw err;
  }
}

export default {
  createPayment,
};