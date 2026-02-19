// backend/src/services/payments/paymentRouter.js
/**
 * ✅ Phase-1 Compatibility Router
 * TowMech Global Payment Router
 *
 * - CountryServiceConfig.payments is the only decider per country
 * - Uses services/payments/index.js adapter registry
 *
 * If legacy code imports this file, it will still work.
 */

import {
  resolvePaymentRoutingForCountry,
  getActivePaymentGateway,
  getGatewayAdapter,
} from "./index.js";

/**
 * ✅ createPayment(payload)
 * payload should include at least:
 * { countryCode, amount, currency, reference, successUrl, cancelUrl, notifyUrl, email }
 */
export async function createPayment(payload = {}) {
  const countryCode = (payload.countryCode || payload.country || "ZA").toString().trim().toUpperCase();
  const routing = await resolvePaymentRoutingForCountry(countryCode);

  // gateway enum like PAYFAST
  const gatewayEnum = await getActivePaymentGateway(countryCode);

  const adapter = await getGatewayAdapter(countryCode);

  const res = await adapter.createPayment({
    amount: payload.amount,
    currency: payload.currency,
    reference: payload.reference,
    successUrl: payload.successUrl,
    cancelUrl: payload.cancelUrl,
    notifyUrl: payload.notifyUrl,
    customerEmail: payload.email,
    countryCode,
    routing,
  });

  return { gateway: gatewayEnum, routing, ...res };
}

export async function verifyPayment(payload = {}) {
  // Not fully implemented in Phase 1 for all providers.
  // PayFast verification happens via ITN notify URL.
  return { message: "Verification is provider-specific. Use webhook/verify endpoint per provider." };
}

/**
 * Useful for debugging
 */
export async function getEnabledPaymentMethods(countryCode) {
  const routing = await resolvePaymentRoutingForCountry(countryCode);
  return (routing.providers || []).filter((p) => p.enabled).map((p) => p.gateway);
}