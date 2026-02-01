// src/services/payments/paymentRouter.js

/**
 * TowMech Global Payment Router
 * - Selects the correct payment provider implementation based on:
 *   1) countryCode
 *   2) method requested (optional)
 *   3) what is enabled in CountryServiceConfig.payments
 *
 * This file is SAFE to add now even if you only have one provider live.
 * If a provider is not configured, it throws a clean error message.
 */

import CountryServiceConfig from "../../models/CountryServiceConfig.js";

// ✅ Providers (create these later; router will still work if you keep them off)
import { paystackCreatePayment, paystackVerifyPayment } from "./providers/paystack.js";
import { ikhokhaCreatePayment, ikhokhaVerifyPayment } from "./providers/ikhokha.js";
import { payfastCreatePayment, payfastVerifyPayment } from "./providers/payfast.js";
import { mpesaCreatePayment, mpesaVerifyPayment } from "./providers/mpesa.js";
import { flutterwaveCreatePayment, flutterwaveVerifyPayment } from "./providers/flutterwave.js";
import { stripeCreatePayment, stripeVerifyPayment } from "./providers/stripe.js";

/**
 * ✅ Helper: normalize incoming method string
 * Accepts:
 *  - "PAYSTACK", "paystack"
 *  - "iKhokha", "ikhokha"
 */
export function normalizePaymentMethod(method) {
  if (!method) return null;
  const m = String(method).trim().toLowerCase();

  if (m === "paystack") return "paystack";
  if (m === "ikhokha" || m === "i-khokha" || m === "i_khokha") return "ikhokha";
  if (m === "payfast") return "payfast";
  if (m === "mpesa" || m === "m-pesa" || m === "m_pesa") return "mpesa";
  if (m === "flutterwave") return "flutterwave";
  if (m === "stripe") return "stripe";

  return m; // allow custom values for future providers
}

/**
 * ✅ Helper: loads payment config for a country
 */
async function getCountryPaymentConfig(countryCode) {
  const code = String(countryCode || "ZA")
    .trim()
    .toUpperCase();

  const cfg = await CountryServiceConfig.findOne({ countryCode: code }).lean();

  // Safe defaults: everything off (you enable per country in dashboard)
  const payments = cfg?.payments || {};

  return {
    countryCode: code,
    payments: {
      paystackEnabled: !!payments.paystackEnabled,
      ikhokhaEnabled: !!payments.ikhokhaEnabled,
      payfastEnabled: !!payments.payfastEnabled,
      mpesaEnabled: !!payments.mpesaEnabled,
      flutterwaveEnabled: !!payments.flutterwaveEnabled,
      stripeEnabled: !!payments.stripeEnabled,

      bookingFeeRequired:
        typeof payments.bookingFeeRequired === "boolean"
          ? payments.bookingFeeRequired
          : true,

      bookingFeePercent:
        typeof payments.bookingFeePercent === "number" ? payments.bookingFeePercent : 0,

      bookingFeeFlat:
        typeof payments.bookingFeeFlat === "number" ? payments.bookingFeeFlat : 0,
    },
  };
}

/**
 * ✅ Decide provider when method not supplied.
 * You can customize priority later per country.
 */
function pickDefaultMethod(payments) {
  if (payments.paystackEnabled) return "paystack";
  if (payments.ikhokhaEnabled) return "ikhokha";
  if (payments.payfastEnabled) return "payfast";
  if (payments.mpesaEnabled) return "mpesa";
  if (payments.flutterwaveEnabled) return "flutterwave";
  if (payments.stripeEnabled) return "stripe";
  return null;
}

/**
 * ✅ Main Router: create payment
 *
 * expected payload example:
 * {
 *   countryCode: "ZA",
 *   method: "paystack",
 *   amount: 100,
 *   currency: "ZAR",
 *   email: "customer@email.com",
 *   reference: "optional",
 *   metadata: {...}
 * }
 */
export async function createPayment(payload = {}) {
  const countryCode = payload.countryCode || payload.country || "ZA";
  const requested = normalizePaymentMethod(payload.method);

  const { payments } = await getCountryPaymentConfig(countryCode);

  const method = requested || pickDefaultMethod(payments);

  if (!method) {
    throw new Error(
      "No payment method is enabled for this country. Please contact support."
    );
  }

  // ✅ Ensure the requested method is enabled
  const enabledMap = {
    paystack: payments.paystackEnabled,
    ikhokha: payments.ikhokhaEnabled,
    payfast: payments.payfastEnabled,
    mpesa: payments.mpesaEnabled,
    flutterwave: payments.flutterwaveEnabled,
    stripe: payments.stripeEnabled,
  };

  if (enabledMap[method] !== true) {
    throw new Error(`Payment method "${method}" is not available in this country.`);
  }

  // ✅ Route to provider implementation
  switch (method) {
    case "paystack":
      return paystackCreatePayment(payload);

    case "ikhokha":
      return ikhokhaCreatePayment(payload);

    case "payfast":
      return payfastCreatePayment(payload);

    case "mpesa":
      return mpesaCreatePayment(payload);

    case "flutterwave":
      return flutterwaveCreatePayment(payload);

    case "stripe":
      return stripeCreatePayment(payload);

    default:
      throw new Error(`Unsupported payment method: ${method}`);
  }
}

/**
 * ✅ Main Router: verify payment
 *
 * expected payload example:
 * {
 *   countryCode: "ZA",
 *   method: "paystack",
 *   reference: "abc123"
 * }
 */
export async function verifyPayment(payload = {}) {
  const countryCode = payload.countryCode || payload.country || "ZA";
  const requested = normalizePaymentMethod(payload.method);

  const { payments } = await getCountryPaymentConfig(countryCode);

  const method = requested || pickDefaultMethod(payments);

  if (!method) {
    throw new Error(
      "No payment method is enabled for this country. Please contact support."
    );
  }

  const enabledMap = {
    paystack: payments.paystackEnabled,
    ikhokha: payments.ikhokhaEnabled,
    payfast: payments.payfastEnabled,
    mpesa: payments.mpesaEnabled,
    flutterwave: payments.flutterwaveEnabled,
    stripe: payments.stripeEnabled,
  };

  if (enabledMap[method] !== true) {
    throw new Error(`Payment method "${method}" is not available in this country.`);
  }

  switch (method) {
    case "paystack":
      return paystackVerifyPayment(payload);

    case "ikhokha":
      return ikhokhaVerifyPayment(payload);

    case "payfast":
      return payfastVerifyPayment(payload);

    case "mpesa":
      return mpesaVerifyPayment(payload);

    case "flutterwave":
      return flutterwaveVerifyPayment(payload);

    case "stripe":
      return stripeVerifyPayment(payload);

    default:
      throw new Error(`Unsupported payment method: ${method}`);
  }
}

/**
 * ✅ Expose what is enabled for a country (useful for /api/config/all)
 */
export async function getEnabledPaymentMethods(countryCode) {
  const { payments } = await getCountryPaymentConfig(countryCode);

  const methods = [];
  if (payments.paystackEnabled) methods.push("paystack");
  if (payments.ikhokhaEnabled) methods.push("ikhokha");
  if (payments.payfastEnabled) methods.push("payfast");
  if (payments.mpesaEnabled) methods.push("mpesa");
  if (payments.flutterwaveEnabled) methods.push("flutterwave");
  if (payments.stripeEnabled) methods.push("stripe");

  return methods;
}