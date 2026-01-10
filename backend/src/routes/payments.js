import express from "express";
import crypto from "crypto";

import Payment, { PAYMENT_STATUSES } from "../models/Payment.js";
import Job, { JOB_STATUSES } from "../models/Job.js";

import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";

import { broadcastJobToProviders } from "../utils/broadcastJob.js";
import { getGatewayAdapter, getActivePaymentGateway } from "../services/payments/index.js";

const router = express.Router();

console.log("✅ payments.js loaded ✅");

/**
 * ✅ PayFast Signature Verification
 */
function generatePayfastSignature(params, passphrase) {
  const sortedKeys = Object.keys(params).sort();
  const queryString = sortedKeys
    .map((k) => `${k}=${encodeURIComponent(params[k]).replace(/%20/g, "+")}`)
    .join("&");

  const finalString = passphrase
    ? `${queryString}&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, "+")}`
    : queryString;

  return crypto.createHash("md5").update(finalString).digest("hex");
}

/**
 * ✅ Customer creates booking fee payment for a Job
 * POST /api/payments/create
 * ✅ Gateway auto-selected from SystemSettings ✅
 */
router.post(
  "/create",
  auth,
  authorizeRoles(USER_ROLES.CUSTOMER),
  async (req, res) => {
    console.log("✅ /api/payments/create HIT ✅", req.body);

    try {
      const { jobId } = req.body;
      if (!jobId) return res.status(400).json({ message: "jobId is required" });

      const job = await Job.findById(jobId);
      if (!job) return res.status(404).json({ message: "Job not found" });

      // ✅ Customer must own job
      if (job.customer.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: "Not authorized to pay for this job" });
      }

      // ✅ Cannot pay cancelled/completed jobs
      if ([JOB_STATUSES.CANCELLED, JOB_STATUSES.COMPLETED].includes(job.status)) {
        return res.status(400).json({ message: `Cannot pay for job in status ${job.status}` });
      }

      const bookingFee = job.pricing?.bookingFee || 0;
      if (bookingFee <= 0) {
        return res.status(400).json({
          message: "Booking fee is not set for this job. Cannot create payment.",
        });
      }

      // ✅ Determine gateway from dashboard settings
      const activeGateway = await getActivePaymentGateway();
      const gatewayAdapter = await getGatewayAdapter();

      // ✅ Check if payment already exists
      let payment = await Payment.findOne({ job: job._id });

      // ✅ If already paid
      if (payment && payment.status === PAYMENT_STATUSES.PAID) {
        return res.status(200).json({
          message: "Payment already PAID ✅",
          payment,
        });
      }

      // ✅ Create payment if missing
      if (!payment) {
        payment = await Payment.create({
          job: job._id,
          customer: req.user._id,
          amount: bookingFee,
          currency: job.pricing?.currency || "ZAR",
          status: PAYMENT_STATUSES.PENDING,
          provider: activeGateway,
        });
      } else {
        payment.provider = activeGateway;
        await payment.save();
      }

      const reference = `TM-${payment._id}`;

      // ✅ Success + Cancel URLs (mobile/web)
      const successUrl = `${process.env.FRONTEND_URL || "https://towmech.com"}/payment-success`;
      const cancelUrl = `${process.env.FRONTEND_URL || "https://towmech.com"}/payment-cancel`;

      /**
       * ✅ Create gateway payment session
       */
      const initResponse = await gatewayAdapter.createPayment({
        amount: bookingFee,
        currency: payment.currency,
        reference,
        successUrl,
        cancelUrl,
        notifyUrl: `${process.env.BACKEND_URL || "https://towmech-main.onrender.com"}/api/payments/notify/payfast`,
        customerEmail: req.user.email,
      });

      payment.providerReference = reference;
      payment.providerPayload = initResponse;
      await payment.save();

      return res.status(201).json({
        message: `${activeGateway} payment initialized ✅`,
        payment,
        gateway: activeGateway,
        initResponse,
      });
    } catch (err) {
      console.error("❌ PAYMENT CREATE ERROR:", err);
      return res.status(500).json({
        message: "Could not create payment",
        error: err.message,
      });
    }
  }
);

/**
 * ✅ PayFast ITN Notify Route
 * POST /api/payments/notify/payfast
 * ✅ Called by PayFast after payment
 */
router.post(
  "/notify/payfast",
  express.urlencoded({ extended: false }), // ✅ PayFast sends form-urlencoded
  async (req, res) => {
    console.log("✅ PAYFAST ITN HIT ✅");
    console.log("✅ BODY:", req.body);

    try {
      const pfData = { ...req.body };

      const signatureFromPayFast = pfData.signature;
      delete pfData.signature;

      // ✅ Generate signature again
      const passphrase = process.env.PAYFAST_PASSPHRASE || "";
      const generatedSignature = generatePayfastSignature(pfData, passphrase);

      if (generatedSignature !== signatureFromPayFast) {
        console.log("❌ PAYFAST SIGNATURE MISMATCH ❌");
        return res.status(400).send("Invalid signature");
      }

      console.log("✅ PAYFAST SIGNATURE VERIFIED ✅");

      const reference = pfData.m_payment_id; // TM-xxxx
      if (!reference) return res.status(400).send("Missing reference");

      // ✅ Find payment by providerReference
      const payment = await Payment.findOne({ providerReference: reference });
      if (!payment) return res.status(404).send("Payment not found");

      // ✅ Already PAID
      if (payment.status === PAYMENT_STATUSES.PAID) {
        console.log("✅ Payment already PAID");
        return res.status(200).send("OK");
      }

      // ✅ Update Payment
      payment.status = PAYMENT_STATUSES.PAID;
      payment.paidAt = new Date();
      payment.providerPayload = pfData;
      await payment.save();

      // ✅ Update Job
      const job = await Job.findById(payment.job);
      if (!job) return res.status(404).send("Job not found");

      job.pricing.bookingFeeStatus = "PAID";
      job.pricing.bookingFeePaidAt = new Date();
      await job.save();

      console.log("✅ Payment marked PAID ✅ Broadcasting job...");

      // ✅ Broadcast to providers
      await broadcastJobToProviders(job._id);

      return res.status(200).send("OK ✅");
    } catch (err) {
      console.log("❌ PAYFAST ITN ERROR:", err.message);
      return res.status(500).send("ERROR");
    }
  }
);

/**
 * ✅ MANUAL FALLBACK
 * PATCH /api/payments/job/:jobId/mark-paid
 */
router.patch("/job/:jobId/mark-paid", auth, async (req, res) => {
  try {
    const payment = await Payment.findOne({ job: req.params.jobId });

    if (!payment) {
      return res.status(404).json({ message: "Payment not found for job" });
    }

    if (![USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.CUSTOMER].includes(req.user.role)) {
      return res.status(403).json({
        message: "Only Admin, SuperAdmin or Customer can mark payment as paid",
      });
    }

    if (
      req.user.role === USER_ROLES.CUSTOMER &&
      payment.customer.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: "Not authorized to mark this payment" });
    }

    if (payment.status === PAYMENT_STATUSES.PAID) {
      return res.status(200).json({ message: "Payment already PAID ✅", payment });
    }

    payment.status = PAYMENT_STATUSES.PAID;
    payment.paidAt = new Date();
    payment.providerReference = `MANUAL-${Date.now()}`;
    await payment.save();

    const job = await Job.findById(payment.job);
    if (!job) return res.status(404).json({ message: "Job not found" });

    job.pricing.bookingFeeStatus = "PAID";
    job.pricing.bookingFeePaidAt = new Date();
    await job.save();

    const broadcastResult = await broadcastJobToProviders(job._id);

    return res.status(200).json({
      message: "Payment manually marked PAID ✅ Job broadcasted ✅",
      payment,
      broadcastResult,
    });
  } catch (err) {
    console.error("❌ MANUAL MARK-PAID ERROR:", err);
    return res.status(500).json({ message: "Could not mark payment", error: err.message });
  }
});

export default router;