import axios from "axios";
import crypto from "crypto";
import SystemSettings from "../../models/SystemSettings.js"; // ✅ adjust if filename differs

/**
 * ✅ Generate iKhokha Signature (IK-SIGN)
 * signature = base64(sha512(payload + APP_SECRET))
 */
const generateSignature = (payload, secret) => {
  const payloadString = JSON.stringify(payload);

  return crypto
    .createHash("sha512")
    .update(payloadString + secret)
    .digest("base64");
};

/**
 * ✅ Load iKhokha keys from DB (SystemSettings) with ENV fallback
 */
async function loadIKhokhaConfig() {
  const settings = await SystemSettings.findOne();

  // ✅ DB first
  const dbKey = settings?.integrations?.ikhokha?.appKey || settings?.ikhokhaAppKey;
  const dbSecret = settings?.integrations?.ikhokha?.appSecret || settings?.ikhokhaAppSecret;
  const dbBaseUrl = settings?.integrations?.ikhokha?.baseUrl || settings?.ikhokhaBaseUrl;
  const dbMode = settings?.integrations?.ikhokha?.mode || settings?.ikhokhaMode;

  // ✅ fallback to ENV
  const APP_KEY = dbKey || process.env.IKHOKHA_APP_KEY;
  const APP_SECRET = dbSecret || process.env.IKHOKHA_APP_SECRET;
  const IKHOKHA_BASE_URL =
    dbBaseUrl || process.env.IKHOKHA_BASE_URL || "https://api.ikhokha.com/public-api/v1";
  const MODE = dbMode || process.env.IKHOKHA_MODE || "live";

  console.log("✅ iKhokha CONFIG LOADED:", {
    APP_KEY: APP_KEY ? "✅ present" : "❌ missing",
    APP_SECRET: APP_SECRET ? "✅ present" : "❌ missing",
    MODE,
    IKHOKHA_BASE_URL,
    source: dbKey && dbSecret ? "MongoDB ✅" : "ENV ⚠️"
  });

  return { APP_KEY, APP_SECRET, IKHOKHA_BASE_URL, MODE };
}

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
    const { APP_KEY, APP_SECRET, IKHOKHA_BASE_URL, MODE } = await loadIKhokhaConfig();

    // ✅ SAFETY CHECK
    if (!APP_KEY || !APP_SECRET) {
      throw new Error("iKhokha keys missing — please add in Admin Settings or Render ENV");
    }

    const CREATE_PAYLINK_ENDPOINT = `${IKHOKHA_BASE_URL}/api/payment`;

    // ✅ Convert amount to cents
    const amountInCents = Math.round(Number(amount) * 100);

    // ✅ PAYLOAD
    const payload = {
      amount: amountInCents,
      currency: currency || "ZAR",
      requesterUrl: "https://towmech-main.onrender.com",
      mode: MODE, // ✅ DB/ENV mode
      externalTransactionID: reference,
      description: `TowMech Booking Fee - ${reference}`,
      urls: {
        callbackUrl: `https://towmech-main.onrender.com/api/payments/verify/ikhokha/${reference}`,
        successPageUrl: "https://towmech.com/payment-success",
        failurePageUrl: "https://towmech.com/payment-failed",
        cancelUrl: "https://towmech.com/payment-cancelled"
      }
    };

    console.log("✅ iKhokha PAYLINK REQUEST PAYLOAD:", JSON.stringify(payload, null, 2));

    // ✅ Signature uses secret from DB/ENV
    const signature = generateSignature(payload, APP_SECRET);

    const response = await axios.post(CREATE_PAYLINK_ENDPOINT, payload, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "IK-APPID": APP_KEY.trim(),
        "IK-SIGN": signature.trim()
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
 */
export const verifyIKhokhaPayment = async (reference) => {
  console.log("⚠️ iKhokha VERIFY HIT (NO DIRECT VERIFY API):", reference);

  return {
    message: "Verification not supported directly by Paylink API",
    reference,
    status: "PENDING"
  };
};