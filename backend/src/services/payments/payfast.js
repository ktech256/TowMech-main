import crypto from "crypto";
import SystemSettings from "../../models/SystemSettings.js";

/**
 * ✅ PayFast base URLs
 */
const PAYFAST_SANDBOX_URL = "https://sandbox.payfast.co.za/eng/process";
const PAYFAST_LIVE_URL = "https://www.payfast.co.za/eng/process";

/**
 * ✅ Generate PayFast signature
 * PayFast requires MD5 hash of query string in original order
 */
function generatePayfastSignature(params, passphrase) {
  const queryString = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%20/g, "+")}`)
    .join("&");

  const finalString = passphrase
    ? `${queryString}&passphrase=${encodeURIComponent(passphrase).replace(
        /%20/g,
        "+"
      )}`
    : queryString;

  return crypto.createHash("md5").update(finalString).digest("hex");
}

/**
 * ✅ Load PayFast config (DB first, fallback generic dashboard keys, fallback ENV)
 */
async function getPayfastConfig() {
  const settings = await SystemSettings.findOne();
  const i = settings?.integrations || {};

  return {
    // ✅ 1️⃣ DB PayFast fields (if available)
    // ✅ 2️⃣ fallback to generic dashboard keys
    // ✅ 3️⃣ fallback ENV variables

    merchantId:
      i.payfastMerchantId ||
      i.paymentPublicKey ||
      process.env.PAYFAST_MERCHANT_ID ||
      "",

    merchantKey:
      i.payfastMerchantKey ||
      i.paymentSecretKey ||
      process.env.PAYFAST_MERCHANT_KEY ||
      "",

    passphrase:
      i.payfastPassphrase ||
      i.paymentWebhookSecret ||
      process.env.PAYFAST_PASSPHRASE ||
      "",

    // ✅ ✅ ✅ FIXED: ENV first → DB fallback → default SANDBOX
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

  const baseURL =
    config.mode === "LIVE" ? PAYFAST_LIVE_URL : PAYFAST_SANDBOX_URL;

  console.log("✅ PayFast MODE:", config.mode);
  console.log("✅ PayFast Base URL:", baseURL);
  console.log("✅ PayFast MerchantId:", config.merchantId);
  console.log("✅ PayFast MerchantKey:", config.merchantKey);
  console.log(
    "✅ PayFast Passphrase:",
    config.passphrase ? "✅ present" : "❌ missing"
  );

  // ✅ IMPORTANT: PayFast signature relies on this EXACT ORDER
  const params = {
    merchant_id: config.merchantId,
    merchant_key: config.merchantKey,
    return_url: successUrl,
    cancel_url: cancelUrl,
    notify_url: notifyUrl,
    email_address: customerEmail,
    m_payment_id: reference,
    amount: Number(amount).toFixed(2),
    item_name: "TowMech Booking Fee",
  };

  const signature = generatePayfastSignature(params, config.passphrase);

  const fullUrl =
    baseURL +
    "?" +
    Object.entries({ ...params, signature })
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");

  console.log("✅ PAYMENT URL GENERATED:", fullUrl);

  return {
    paymentUrl: fullUrl,
    reference,
    gateway: "PAYFAST",
    signature,
  };
}

/**
 * ✅ PayFast verification happens via ITN notify_url callback
 */
async function verifyPayment() {
  return { message: "PayFast verification handled via notify_url ITN ✅" };
}

export default {
  provider: "PAYFAST",
  createPayment,
  verifyPayment,
};