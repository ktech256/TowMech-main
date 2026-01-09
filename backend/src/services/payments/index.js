import SystemSettings from "../../models/SystemSettings.js";

import ikhokaGateway from "./ikhokha.js";
import payfastGateway from "./payfast.js";
import peachGateway from "./peachPayments.js";

/**
 * ✅ Get active gateway from DB settings
 */
export async function getActivePaymentGateway() {
  const settings = await SystemSettings.findOne();
  const gateway = settings?.integrations?.paymentGateway || "IKHOKHA";

  return gateway.toUpperCase();
}

/**
 * ✅ Return gateway adapter (Ikhokha, PayFast, Peach)
 */
export async function getGatewayAdapter() {
  const activeGateway = await getActivePaymentGateway();

  switch (activeGateway) {
    case "PAYFAST":
      return payfastGateway;

    case "PEACH_PAYMENTS":
      return peachGateway;

    case "IKHOKHA":
    default:
      return ikhokaGateway;
  }
}