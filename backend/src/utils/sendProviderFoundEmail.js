import nodemailer from "nodemailer";

/**
 * ✅ Sends Providers Found Email
 * @param {Object} args
 * args.to = recipient email
 * args.name = recipient name
 * args.preview = { currency, bookingFee, estimatedTotal }
 * args.providerCount = number of providers found
 */
export const sendProvidersFoundEmail = async ({ to, name, preview, providerCount }) => {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const currency = preview?.currency || "ZAR";
    const bookingFee = preview?.bookingFee || 0;
    const estimatedTotal = preview?.estimatedTotal || 0;

    const subject = "✅ Providers Found Near You — Pay Booking Fee to Proceed";

    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2 style="color: #1E2A5E;">TowMech Providers Found ✅</h2>

        <p>Hello <b>${name}</b>,</p>

        <p>Good news! We found <b>${providerCount}</b> providers near your location.</p>

        <p>Please pay the booking fee to confirm your request and allow matching.</p>

        <hr />

        <h3>💰 Booking Summary</h3>
        <p><b>Estimated Total:</b> ${currency} ${estimatedTotal}</p>
        <p><b>Booking Fee Required:</b> ${currency} ${bookingFee}</p>

        <hr />

        <p style="font-size: 13px; color: gray;">
          Thank you for using TowMech.<br/>
          Killian Digital Solutions © ${new Date().getFullYear()}
        </p>
      </div>
    `;

    const info = await transporter.sendMail({
      from: `"TowMech" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html
    });

    console.log("✅ Providers Found Email sent:", info.messageId);
    return true;
  } catch (err) {
    console.error("❌ Providers Found Email failed:", err.message);
    return false;
  }
};