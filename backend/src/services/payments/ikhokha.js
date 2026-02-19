// backend/src/services/payments/ikhokha.js
import axios from "axios";
import crypto from "crypto";
import { URL } from "url";

/**
 * iKhokha iK Pay API - Create Payment Link
 *
 * ✅ IK-SIGN = HMAC_SHA256( path + requestBody , AppSecret )  -> HEX
 * Headers:
 *  IK-APPID: Application ID (AppID)
 *  IK-SIGN : Signature
 */

const IKHOKHA_BASE_URL = (process.env.IKHOKHA_BASE_URL || "https://api.ikhokha.com/public-api/v1")
  .replace(/\/+$/, "");

const PAYMENT_PATH = "/api/payment";
const CREATE_PAYLINK_ENDPOINT = `${IKHOKHA_BASE_URL}${PAYMENT_PATH}`;

function jsStringEscape(str) {
  return String(str).replace(/[\\"']/g, "\\$&").replace(/\u0000/g, "\\0");
}

function createPayloadToSign(fullUrlOrPath, bodyString = "") {
  let basePath = "";

  if (String(fullUrlOrPath).startsWith("http")) {
    const u = new URL(fullUrlOrPath);
    basePath = `${u.pathname}${u.search || ""}`;
  } else {
    basePath = String(fullUrlOrPath).startsWith("/") ? String(fullUrlOrPath) : `/${String(fullUrlOrPath)}`;
  }

  if (!basePath) throw new Error("No basePath in url");

  const payload = basePath + (bodyString || "");
  return jsStringEscape(payload);
}

function generateIkSign({ endpointUrl, requestBodyString, appSecret }) {
  const payloadToSign = createPayloadToSign(endpointUrl, requestBodyString);

  return crypto
    .createHmac("sha256", String(appSecret).trim())
    .update(payloadToSign, "utf8")
    .digest("hex");
}

/**
 * ✅ Load iKhokha config for a country from routing + ENV
 * - Secrets from ENV (recommended)
 * - Non-secret config from routing.providers[].config
 */
function loadIKhokhaConfig({ countryCode, routing }) {
  const cc = String(countryCode || routing?.countryCode || "ZA").trim().toUpperCase();

  const providerDef = (routing?.providers || []).find(
    (p) => String(p?.gateway || "").toUpperCase() === "IKHOKHA"
  );

  const cfg = providerDef?.config || {};

  // ENV secrets (preferred)
  const envAppId = process.env.IKHOKHA_APP_KEY?.trim(); // AppID
  const envSecret = process.env.IKHOKHA_APP_SECRET?.trim(); // AppSecret

  // Routing may contain NON-secret fields (optional)
  const entityIdFromRouting = cfg.entityID || cfg.entityId || cfg.entity_id || cfg.ENTITY_ID || "";
  const externalEntityIdFromRouting =
    cfg.externalEntityID || cfg.externalEntityId || cfg.external_entity_id || cfg.EXTERNAL_ENTITY_ID || "";

  // As per your earlier logic: entityID often equals APP_ID; allow override
  const APP_ID = envAppId || "";
  const APP_SECRET = envSecret || "";
  const ENTITY_ID = String(entityIdFromRouting || APP_ID || "").trim();
  const EXTERNAL_ENTITY_ID = String(externalEntityIdFromRouting || "").trim();

  return {
    countryCode: cc,
    APP_ID,
    APP_SECRET,
    ENTITY_ID,
    EXTERNAL_ENTITY_ID,
    mode: String(cfg.mode || process.env.IKHOKHA_MODE || "live").toLowerCase(), // "live" | "test"
  };
}

/**
 * createPayment() expected by payments.js (unified)
 */
async function createPayment({
  amount,
  currency,
  reference,
  successUrl,
  cancelUrl,
  notifyUrl, // iKhokha uses callbackUrl - can map it
  customerEmail, // optional
  countryCode,
  routing,
}) {
  const config = loadIKhokhaConfig({ countryCode, routing });

  if (!config.APP_ID || !config.APP_SECRET) {
    throw new Error("iKhokha API keys missing (IKHOKHA_APP_KEY / IKHOKHA_APP_SECRET) ❌");
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error(`Invalid amount provided to iKhokha: ${amount}`);
  }

  // iKhokha expects smallest unit (cents for ZAR)
  const amountInCents = Math.round(numericAmount * 100);

  const BACKEND_URL = (process.env.BACKEND_URL || "https://api.towmech.com").replace(/\/+$/, "");
  const FRONTEND_URL = (process.env.FRONTEND_URL || "https://towmech.com").replace(/\/+$/, "");

  // iKhokha spec wants urls.* fields
  const payload = {
    entityID: config.ENTITY_ID,
    ...(config.EXTERNAL_ENTITY_ID ? { externalEntityID: config.EXTERNAL_ENTITY_ID } : {}),
    amount: amountInCents,
    currency: (currency || "ZAR").toUpperCase(),
    requesterUrl: BACKEND_URL,
    mode: config.mode === "test" ? "test" : "live",
    externalTransactionID: reference,
    urls: {
      // Use notifyUrl if provided, otherwise provide a backend verification endpoint (safe)
      callbackUrl: notifyUrl?.trim() || `${BACKEND_URL}/api/payments/verify/ikhokha/${encodeURIComponent(reference)}`,
      successPageUrl: successUrl?.trim() || `${FRONTEND_URL}/payment-success`,
      failurePageUrl: `${FRONTEND_URL}/payment-failed`,
      cancelUrl: cancelUrl?.trim() || `${FRONTEND_URL}/payment-cancel`,
    },
  };

  // iKhokha signing must use EXACT string we send
  const requestBodyString = JSON.stringify(payload);

  const signature = generateIkSign({
    endpointUrl: CREATE_PAYLINK_ENDPOINT,
    requestBodyString,
    appSecret: config.APP_SECRET,
  });

  try {
    const response = await axios.post(CREATE_PAYLINK_ENDPOINT, requestBodyString, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "IK-APPID": config.APP_ID.trim(),
        "IK-SIGN": signature.trim(),
      },
      timeout: 30000,
    });

    // Normalize response to support payments.js redirect extraction
    // Some iKhokha responses include a "url" or "paylinkUrl" shape depending on spec version.
    return {
      ...response.data,
      gateway: "IKHOKHA",
      reference,
    };
  } catch (err) {
    const msg = err?.response?.data || err?.message || "iKhokha createPayment failed";
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
}

export default {
  provider: "IKHOKHA",
  createPayment,
};