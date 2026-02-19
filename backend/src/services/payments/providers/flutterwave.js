// backend/src/services/payments/providers/flutterwave.js
import axios from "axios";
import crypto from "crypto";

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}

function getProviderConfig(payload) {
  const routing = payload?.routing;
  const providers = Array.isArray(routing?.providers) ? routing.providers : [];
  const def = providers.find((p) => String(p?.gateway || "").toUpperCase() === "FLUTTERWAVE");
  return safeObj(def?.config);
}

function pickFirst(...vals) {
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

function requireValue(name, v) {
  if (!v) throw new Error(`Missing required value: ${name}`);
  return v;
}

function baseUrl(payload) {
  const cfg = getProviderConfig(payload);
  return pickFirst(cfg.baseUrl, process.env.FLUTTERWAVE_BASE_URL, "https://api.flutterwave.com").replace(
    /\/$/,
    ""
  );
}

function authHeaders(payload) {
  const cfg = getProviderConfig(payload);
  const secret = pickFirst(cfg.secretKey, process.env.FLUTTERWAVE_SECRET_KEY);
  requireValue("FLUTTERWAVE_SECRET_KEY", secret);

  return {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  };
}

function buildTxRef(prefix = "towmech") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

export async function flutterwaveCreatePayment(payload = {}) {
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid amount");

  const currency = String(payload.currency || "").trim().toUpperCase();
  if (!currency) throw new Error("currency is required");

  const email = String(payload.email || "").trim();
  if (!email) throw new Error("email is required");

  const name = String(payload.name || "TowMech User").trim();
  const phone = payload.phone ? String(payload.phone).trim() : "";

  const tx_ref = String(payload.tx_ref || buildTxRef("towmech")).trim();

  const redirect_url = String(
    payload.redirect_url || process.env.FLW_REDIRECT_URL || process.env.APP_URL || ""
  ).trim();

  const body = {
    tx_ref,
    amount: amount.toFixed(2),
    currency,
    redirect_url: redirect_url || undefined,
    payment_options: "card,banktransfer,ussd,mobilemoney",
    customer: {
      email,
      name,
      phone_number: phone || undefined,
    },
    customizations: {
      title: String(payload.title || "TowMech Payment"),
      description: String(payload.description || "TowMech service payment"),
    },
    meta: payload.meta && typeof payload.meta === "object" ? payload.meta : undefined,
  };

  try {
    const res = await axios.post(`${baseUrl(payload)}/v3/payments`, body, {
      headers: authHeaders(payload),
      timeout: 30000,
    });

    const data = res?.data;
    const link = data?.data?.link;

    if (!data || data?.status !== "success" || !link) {
      throw new Error(data?.message || "Flutterwave payment creation failed");
    }

    return {
      provider: "flutterwave",
      method: "flutterwave",
      tx_ref,
      link,
      redirectUrl: link,
      raw: data,
    };
  } catch (err) {
    const msg =
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.message ||
      "Flutterwave payment creation failed";
    throw new Error(msg);
  }
}

export async function flutterwaveVerifyPayment(payload = {}) {
  const transactionId = payload.transactionId ? String(payload.transactionId).trim() : "";
  const tx_ref = payload.tx_ref ? String(payload.tx_ref).trim() : "";

  if (!transactionId && !tx_ref) {
    throw new Error("transactionId or tx_ref is required");
  }

  if (transactionId) {
    try {
      const res = await axios.get(`${baseUrl(payload)}/v3/transactions/${transactionId}/verify`, {
        headers: authHeaders(payload),
        timeout: 30000,
      });

      const data = res?.data;
      const d = data?.data;

      if (!data || data?.status !== "success" || !d) {
        throw new Error(data?.message || "Flutterwave verify failed");
      }

      const flwStatus = String(d?.status || "").toLowerCase();
      let status = "pending";
      if (flwStatus === "successful") status = "success";
      else if (flwStatus === "failed" || flwStatus === "cancelled") status = "failed";

      return {
        provider: "flutterwave",
        method: "flutterwave",
        status,
        transactionId: String(d?.id ?? transactionId),
        tx_ref: String(d?.tx_ref ?? tx_ref),
        amount: d?.amount,
        currency: d?.currency,
        raw: data,
      };
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Flutterwave verify failed";
      throw new Error(msg);
    }
  }

  try {
    const res = await axios.get(`${baseUrl(payload)}/v3/transactions`, {
      headers: authHeaders(payload),
      params: { tx_ref },
      timeout: 30000,
    });

    const data = res?.data;
    const list = data?.data;

    if (!data || data?.status !== "success" || !Array.isArray(list)) {
      throw new Error(data?.message || "Flutterwave verify by tx_ref failed");
    }

    const matches = list
      .filter((t) => String(t?.tx_ref || "") === tx_ref)
      .sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0));

    const d = matches[0];
    if (!d) {
      return {
        provider: "flutterwave",
        method: "flutterwave",
        status: "pending",
        transactionId: null,
        tx_ref,
        amount: null,
        currency: null,
        raw: data,
      };
    }

    const flwStatus = String(d?.status || "").toLowerCase();
    let status = "pending";
    if (flwStatus === "successful") status = "success";
    else if (flwStatus === "failed" || flwStatus === "cancelled") status = "failed";

    return {
      provider: "flutterwave",
      method: "flutterwave",
      status,
      transactionId: String(d?.id ?? ""),
      tx_ref: String(d?.tx_ref ?? tx_ref),
      amount: d?.amount,
      currency: d?.currency,
      raw: data,
    };
  } catch (err) {
    const msg =
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.message ||
      "Flutterwave verify by tx_ref failed";
    throw new Error(msg);
  }
}