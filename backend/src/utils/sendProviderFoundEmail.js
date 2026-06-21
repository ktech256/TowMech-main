import { EmailService } from "../services/EmailService.js";

/**
 * ✅ Sends Providers Found Email (SendGrid Migration)
 */
export const sendProvidersFoundEmail = async ({ to, name, preview, providerCount }) => {
  try {
    const currency = preview?.currency || "ZAR";
    const bookingFee = preview?.bookingFee || 0;
    const estimatedTotal = preview?.estimatedTotal || 0;

    const subject = "✅ Providers Found Near You — Pay Booking Fee to Proceed";

    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #FF8C00;">TowMech Providers Found ✅</h2>
        <p>Hello <strong>${name}</strong>,</p>
        <p>Good news! We found <strong>${providerCount}</strong> providers near your location.</p>
        <p>Please pay the booking fee to confirm your request and allow matching.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <div style="background: #f9f9f9; padding: 15px; border-radius: 8px;">
          <p style="margin: 5px 0;"><strong>Estimated Total:</strong> ${currency} ${estimatedTotal}</p>
          <p style="margin: 5px 0;"><strong>Booking Fee Required:</strong> ${currency} ${bookingFee}</p>
        </div>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #999; text-align: center;">&copy; ${new Date().getFullYear()} TowMech. All rights reserved.</p>
      </div>
    `;

    return await EmailService.send(null, {
      to,
      subject,
      html,
      category: "provider_found"
    });

  } catch (err) {
    console.error("❌ Providers Found Email failed:", err.message);
    return false;
  }
};