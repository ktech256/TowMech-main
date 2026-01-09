import axios from "axios";
import SystemSettings from "../../models/SystemSettings.js";

/**
 * ✅ Peach Payments base URLs
 */
const PEACH_SANDBOX_URL = "https://test.oppwa.com/v1/checkouts";
const PEACH_LIVE_URL = "https://oppwa.com/v1/checkouts";

/**
 * ✅ Load Peach config
 */
async function getPeachConfig() {
  const settings = await SystemSettings.findOne();
  const i = settings?.integrations || {};

  return {
    entityId: i.peachEntityId || "",
    accessToken: i.peachAccessToken || "",
    mode: i.peachMode || "SANDBOX",
  };
}

/**
 * ✅ Create Peach Checkout
 */
async function createPayment({ amount, currency, reference }) {
  const config = await getPeachConfig();

  if (!config.entityId || !config.accessToken) {
    throw new Error("Peach Payments keys missing ❌");
  }

  const baseURL = config.mode === "LIVE" ? PEACH_LIVE_URL : PEACH_SANDBOX_URL;

  const params = new URLSearchParams();
  params.append("entityId", config.entityId);
  params.append("amount", amount.toFixed(2));
  params.append("currency", currency || "ZAR");
  params.append("paymentType", "DB");
  params.append("merchantTransactionId", reference);

  const response = await axios.post(baseURL, params, {
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  return response.data;
}

/**
 * ✅ Verify Peach Payment (requires checkoutId)
 */
async function verifyPayment(checkoutId) {
  const config = await getPeachConfig();
  const baseURL = config.mode === "LIVE"
    ? `https://oppwa.com/v1/checkouts/${checkoutId}/payment`
    : `https://test.oppwa.com/v1/checkouts/${checkoutId}/payment`;

  const response = await axios.get(`${baseURL}?entityId=${config.entityId}`, {
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
    },
  });

  return response.data;
}

export default {
  provider: "PEACH_PAYMENTS",
  createPayment,
  verifyPayment,
};