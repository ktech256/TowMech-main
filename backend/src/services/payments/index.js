import SystemSettings from "../../models/SystemSettings.js";

import ikhokaGateway from "./ikhokha.js";
import payfastGateway from "./payfast.js";
import peachGateway from "./peachPayments.js";

/**
 * ✅ Get settings doc for a specific countryCode (dashboard decides per country)
 * Fallback order:
 *  1) exact countryCode
 *  2) ZA (common default if you use ZA as “base”)
 *  3) any settings doc (last resort)
 */
async function getSettingsForCountry(countryCode) {
  const cc = (countryCode || "").toUpperCase().trim();

  if (cc) {
    const byCountry = await SystemSettings.findOne({ countryCode: cc });
    if (byCountry) return byCountry;
  }

  const za = await SystemSettings.findOne({ countryCode: "ZA" });
  if (za) return za;

  return await SystemSettings.findOne();
}

/**
 * ✅ Get active gateway from DB settings (country-aware)
 */
export async function getActivePaymentGateway(countryCode) {
  const settings = await getSettingsForCountry(countryCode);

  const gateway = settings?.integrations?.paymentGateway || "IKHOKHA";
  return String(gateway).toUpperCase();
}

/**
 * ✅ Return gateway adapter (Ikhokha, PayFast, Peach) (country-aware selection)
 * NOTE: The adapter modules remain unchanged; this just ensures the selected gateway
 * comes from the dashboard settings for the same country.
 */
export async function getGatewayAdapter(countryCode) {
  const activeGateway = await getActivePaymentGateway(countryCode);

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