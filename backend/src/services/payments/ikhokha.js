import crypto from "crypto";
import axios from "axios";
import SystemSettings from "../../models/SystemSettings.js";

/**
 * ✅ iKhokha base URLs
 */
const IKHOKHA_SANDBOX_URL = "https://api.ikhokha.com/public-api/v1";
const IKHOKHA_LIVE_URL = "https://api.ikhokha.com/public-api/v1";

/**
 * ✅ Generate iKhokha signature using HMAC-SHA256 HEX DIGEST
 * ⚠️ NOT BASE64 ❌
 */
function generateSignature(secretKey, payloadString) {
  return crypto
    .createHmac("sha256", secretKey)
    .update(payloadString)
    .digest("hex");
}

/**
 * ✅ Load iKhokha config from SystemSettings
 */
async function getIkhokhaConfig() {
  const settings = await SystemSettings.findOne();

  const integrations = settings?.integrations || {};

  return {
    entityId: integrations.ikhEntityId || "", // optional ✅
    apiKey: integrations.ikhApiKey || "",
    secretKey: integrations.ikhSecretKey || "",
    mode: integrations.ikhokhaMode || "SANDBOX",
  };
}

/**
 * ✅ Initialize iKhokha Paylink Payment
 */
async function createPayment({ amount, currency, reference, successUrl, cancelUrl }) {
  const config = await getIkhokhaConfig();
  if (!config.apiKey || !config.secretKey) {
    throw new Error("iKhokha API keys missing ❌ Please update dashboard integrations");
  }

  const baseURL = config.mode === "LIVE" ? IKHOKHA_LIVE_URL : IKHOKHA_SANDBOX_URL;

  const payload = {
    amount: amount.toFixed(2),
    currency: currency || "ZAR",
    reference,
    description: "TowMech Booking Fee",
    successUrl,
    cancelUrl,
  };

  /**
   * ✅ Build signature payload string
   * This is what iKhokha signs.
   * Must be consistent with their docs.
   */
  const payloadString = JSON.stringify(payload);

  const signature = generateSignature(config.secretKey, payloadString);

  const headers = {
    "Content-Type": "application/json",
    "IKHOKHA-API-KEY": config.apiKey,
    "IKHOKHA-SIGNATURE": signature,
  };

  // ✅ entityId is optional (only attach if present)
  if (config.entityId) {
    headers["IKHOKHA-ENTITY-ID"] = config.entityId;
  }

  const response = await axios.post(`${baseURL}/paylink/create`, payload, { headers });

  return response.data;
}

/**
 * ✅ Verify iKhokha Payment (Paylink verification is limited)
 */
async function verifyPayment(reference) {
  const config = await getIkhokhaConfig();
  if (!config.apiKey || !config.secretKey) {
    throw new Error("iKhokha API keys missing ❌");
  }

  const baseURL = config.mode === "LIVE" ? IKHOKHA_LIVE_URL : IKHOKHA_SANDBOX_URL;

  const payload = { reference };
  const payloadString = JSON.stringify(payload);
  const signature = generateSignature(config.secretKey, payloadString);

  const headers = {
    "Content-Type": "application/json",
    "IKHOKHA-API-KEY": config.apiKey,
    "IKHOKHA-SIGNATURE": signature,
  };

  if (config.entityId) {
    headers["IKHOKHA-ENTITY-ID"] = config.entityId;
  }

  const response = await axios.post(`${baseURL}/paylink/verify`, payload, { headers });

  return response.data;
}

export default {
  provider: "IKHOKHA",
  createPayment,
  verifyPayment,
};