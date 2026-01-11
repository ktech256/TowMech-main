import crypto from "crypto";
import SystemSettings from "../../models/SystemSettings.js";

const PAYFAST_SANDBOX_URL = "https://sandbox.payfast.co.za/eng/process";
const PAYFAST_LIVE_URL = "https://www.payfast.co.za/eng/process";

/**
 * ✅ PayFast encoding:
 * - encodeURIComponent
 * - spaces must be "+"
 * ❌ DO NOT decode %2F or %3A etc
 */
function encodePayfast(value) {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

/**
 * ✅ Build PayFast param string in the EXACT ORDER we send it
 * Excludes signature
 */
function buildParamString(params) {
  return Object.entries(params)
    .filter(([_, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${encodePayfast(v.toString().trim())}`)
    .join("&");
}

/**
 * ✅ Generate signature:
 * MD5( param_string + &passphrase=... )
 */
function generatePayfastSignature(params, passphrase = "") {
  let paramString = buildParamString(params);

  if (passphrase && passphrase.trim() !== "") {
    paramString += `&passphrase=${encodePayfast(passphrase.trim())}`;
  }

  return crypto.createHash("md5").update(paramString).digest("hex");
}

/**
 * ✅ Load PayFast config
 * ✅ ENV FIRST → DB fallback
 */
async function getPayfastConfig() {
  const settings = await SystemSettings.findOne();
  const i = settings?.integrations || {};

  return {
    merchantId:
      process.env.PAYFAST_MERCHANT_ID ||
      i.payfastMerchantId ||
      i.paymentPublicKey ||
      "",

    merchantKey:
      process.env.PAYFAST_MERCHANT_KEY ||
      i.payfastMerchantKey ||
      i.paymentSecretKey ||
      "",

    passphrase:
      process.env.PAYFAST_PASSPHRASE ||
      i.payfastPassphrase ||
      i.paymentWebhookSecret ||
      "",

    mode: process.env.PAYFAST_MODE || i.payfastMode || "SANDBOX",
  };
}

/**
 * ✅ Create PayFast Payment URL
 */
async function createPayment({
  amount,
  reference,
  successUrl,
  cancelUrl,
  notifyUrl,
  customerEmail,
}) {
  const config = await getPayfastConfig();

  if (!config.merchantId || !config.merchantKey) {
    console.log("❌ PayFast config missing:", config);
    throw new Error("PayFast Merchant details missing ❌");
  }

  const mode = config.mode?.toUpperCase() === "LIVE" ? "LIVE" : "SANDBOX";
  const baseURL = mode === "LIVE" ? PAYFAST_LIVE_URL : PAYFAST_SANDBOX_URL;

  console.log("✅ PayFast MODE:", mode);
  console.log("✅ PayFast Base URL:", baseURL);
  console.log("✅ PayFast MerchantId:", config.merchantId);
  console.log("✅ PayFast MerchantKey:", config.merchantKey);
  console.log("✅ PayFast Passphrase:", config.passphrase ? "✅ present" : "❌ missing");

  /**
   * ✅ IMPORTANT:
   * Keep param insertion order EXACTLY as we want it sent
   */
  const params = {
    merchant_id: config.merchantId.trim(),
    merchant_key: config.merchantKey.trim(),
    return_url: successUrl.trim(),
    cancel_url: cancelUrl.trim(),
    notify_url: notifyUrl.trim(),
    email_address: customerEmail?.trim() || "",
    m_payment_id: reference.trim(),
    amount: Number(amount).toFixed(2),
    item_name: "TowMech Booking Fee",
  };

  // ✅ Remove email_address if empty (optional field)
  if (!params.email_address) {
    delete params.email_address;
  }

  const signature = generatePayfastSignature(params, config.passphrase);

  // ✅ Build final URL using SAME order + SAME encoding
  const fullUrl = `${baseURL}?${buildParamString({
    ...params,
    signature,
  })}`;

  console.log("✅ SIGNATURE:", signature);
  console.log("✅ PAYMENT URL GENERATED:", fullUrl);

  return {
    paymentUrl: fullUrl,
    reference,
    gateway: "PAYFAST",
    signature,
  };
}

async function verifyPayment() {
  return { message: "PayFast verification handled via notify_url ITN ✅" };
}

export default {
  provider: "PAYFAST",
  createPayment,
  verifyPayment,
};