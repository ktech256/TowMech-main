import express from "express";
import crypto from "crypto";

import Payment, { PAYMENT_STATUSES } from "../models/Payment.js";
import Job, { JOB_STATUSES } from "../models/Job.js";

import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";

import { broadcastJobToProviders } from "../utils/broadcastJob.js";
import {
  getGatewayAdapter,
  getActivePaymentGateway,
} from "../services/payments/index.js";

const router = express.Router();

console.log("✅ payments.js loaded ✅");

/**
 * ✅ PayFast ITN signature rules (IMPORTANT):
 * - Best: verify from RAW body (prevents +/%20 normalization issues)
 * - Fallback: verify from req.body if raw was consumed by a global parser
 * - Remove signature field
 * - Append passphrase (urlencoded, spaces as +) if present
 * - MD5 hash
 */
function encodePayfast(value) {
  return encodeURIComponent(String(value)).replace(/%20/g, "+");
}

function md5Hex(str) {
  return crypto.createHash("md5").update(str).digest("hex").toLowerCase();
}

/**
 * ✅ Generate signature from req.body (fallback mode)
 * IMPORTANT: include empty strings too (PayFast often sends custom_* as "")
 */
function generatePayfastSignatureFromBody(body, passphrase = "") {
  const data = { ...(body || {}) };
  delete data.signature;

  const keys = Object.keys(data).sort();

  const queryString = keys
    .map((k) => {
      const v = data[k] ?? ""; // include empty strings
      return `${k}=${encodePayfast(v)}`;
    })
    .join("&");

  const finalString =
    passphrase && passphrase.trim() !== ""
      ? `${queryString}&passphrase=${encodePayfast(passphrase.trim())}`
      : queryString;

  return md5Hex(finalString);
}

/**
 * ✅ Verify signature from RAW body (preferred)
 * Returns { ok, generatedSignature, receivedSignature, mode, raw }
 */
function verifyPayfastSignature({ rawBody, body, passphrase }) {
  const raw = (rawBody || "").trim();
  const pp = (passphrase || "").trim();

  // ✅ signature from parsed body (always present if PayFast included it)
  const receivedFromBody = (body?.signature || "").toLowerCase();

  // ✅ 1) Preferred: RAW verification
  if (raw) {
    const receivedFromRaw =
      (raw.match(/(?:^|&)signature=([^&]+)/)?.[1] || "").toLowerCase();

    if (!receivedFromRaw) {
      return {
        ok: false,
        generatedSignature: "",
        receivedSignature: "",
        mode: "raw",
        raw,
        reason: "missing_signature_in_raw",
      };
    }

    const rawWithoutSignature = raw
      .split("&")
      .filter((pair) => !pair.startsWith("signature="))
      .join("&");

    const finalString =
      pp !== ""
        ? `${rawWithoutSignature}&passphrase=${encodePayfast(pp)}`
        : rawWithoutSignature;

    const generatedSignature = md5Hex(finalString);

    return {
      ok: generatedSignature === receivedFromRaw,
      generatedSignature,
      receivedSignature: receivedFromRaw,
      mode: "raw",
      raw,
    };
  }

  // ✅ 2) Fallback: BODY verification (when raw stream was already consumed globally)
  if (!receivedFromBody) {
    return {
      ok: false,
      generatedSignature: "",
      receivedSignature: "",
      mode: "body",
      raw: "",
      reason: "missing_signature_in_body",
    };
  }

  const generatedSignature = generatePayfastSignatureFromBody(body, pp);

  return {
    ok: generatedSignature === receivedFromBody,
    generatedSignature,
    receivedSignature: receivedFromBody,
    mode: "body",
    raw: "",
  };
}

/**
 * ✅ PayFast ITN Webhook (FIXED + FALLBACK)
 * POST /api/payments/notify/payfast
 *
 * IMPORTANT:
 * - Must be urlencoded parser (PayFast sends x-www-form-urlencoded)
 * - Try RAW verification; if raw is empty, fall back to req.body verification
 * - Return 200 quickly (PayFast retries aggressively)
 */
router.post(
  "/notify/payfast",
  express.urlencoded({
    extended: false,
    verify: (req, res, buf) => {
      // ✅ Save RAW payload as PayFast sent it (may be empty if global parser already ran)
      req.rawBody = buf.toString("utf8");
    },
  }),
  async (req, res) => {
    try {
      console.log("✅ PAYFAST ITN RECEIVED ✅", req.body);

      const data = req.body || {};
      const reference = data.m_payment_id; // TM-<paymentId>
      const paymentStatus = (data.payment_status || "").toUpperCase();

      if (!reference) {
        console.log("❌ ITN missing m_payment_id");
        return res.status(200).send("Missing reference");
      }

      // ✅ Passphrase must match PayFast dashboard exactly
      const passphrase = (process.env.PAYFAST_PASSPHRASE || "").trim();

      const verification = verifyPayfastSignature({
        rawBody: req.rawBody,
        body: data,
        passphrase,
      });

      if (verification.mode === "raw") {
        console.log("✅ ITN RAW BODY:", verification.raw);
      } else {
        console.log("⚠️ RAW BODY EMPTY → using body-based signature rebuild");
      }

      console.log("✅ ITN generatedSignature:", verification.generatedSignature);
      console.log("✅ ITN receivedSignature :", verification.receivedSignature);

      if (!verification.receivedSignature) {
        console.log("❌ ITN missing signature");
        return res.status(200).send("Missing signature");
      }

      if (!verification.ok) {
        console.log("❌ PAYFAST ITN SIGNATURE MISMATCH ❌");
        // Return 200 to avoid endless retries while you debug
        return res.status(200).send("Signature mismatch");
      }

      console.log("✅ PAYFAST ITN SIGNATURE VERIFIED ✅");

      // ✅ Only mark PAID if payment COMPLETE
      if (paymentStatus !== "COMPLETE") {
        console.log("⚠️ PayFast payment not COMPLETE:", paymentStatus);
        return res.status(200).send("Payment not complete");
      }

      // ✅ Find payment in DB (providerReference = TM-<paymentId>)
      const payment = await Payment.findOne({ providerReference: reference });

      if (!payment) {
        console.log("❌ Payment not found for providerReference:", reference);
        return res.status(200).send("Payment not found");
      }

      if (payment.status === PAYMENT_STATUSES.PAID) {
        console.log("✅ Payment already marked PAID ✅", payment._id.toString());
        return res.status(200).send("Already paid");
      }

      // ✅ Mark Payment as PAID
      payment.status = PAYMENT_STATUSES.PAID;
      payment.paidAt = new Date();
      payment.providerPayload = data;

      await payment.save();
      console.log("✅ Payment marked PAID ✅", payment._id.toString());

      // ✅ Update Job booking fee status
      const job = await Job.findById(payment.job);

      if (!job) {
        console.log("⚠️ Job not found for payment.job:", payment.job?.toString());
        return res.status(200).send("Job not found");
      }

      if (!job.pricing) job.pricing = {};
      job.pricing.bookingFeeStatus = "PAID";
      job.pricing.bookingFeePaidAt = new Date();
      await job.save();

      console.log("✅ Job bookingFee marked PAID ✅", job._id.toString());

      // ✅ Broadcast job now that booking fee is PAID
      const broadcastResult = await broadcastJobToProviders(job._id);
      console.log("✅ Job broadcast result ✅", {
        message: broadcastResult?.message,
        providers: broadcastResult?.providers?.length || 0,
      });

      return res.status(200).send("ITN Processed ✅");
    } catch (err) {
      console.error("❌ PAYFAST ITN ERROR:", err);
      // Return 200 to prevent PayFast retry spam
      return res.status(200).send("ITN error handled");
    }
  }
);

/**
 * ✅ Customer creates booking fee payment for a Job
 * POST /api/payments/create
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
        return res
          .status(403)
          .json({ message: "Not authorized to pay for this job" });
      }

      // ✅ Cannot pay cancelled/completed jobs
      if (
        [JOB_STATUSES.CANCELLED, JOB_STATUSES.COMPLETED].includes(job.status)
      ) {
        return res
          .status(400)
          .json({ message: `Cannot pay for job in status ${job.status}` });
      }

      const bookingFee = job.pricing?.bookingFee || 0;
      if (bookingFee <= 0) {
        return res.status(400).json({
          message: "Booking fee is not set for this job. Cannot create payment.",
        });
      }

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
      const successUrl = `${
        process.env.FRONTEND_URL || "https://towmech.com"
      }/payment-success`;
      const cancelUrl = `${
        process.env.FRONTEND_URL || "https://towmech.com"
      }/payment-cancel`;

      // ✅ Create gateway payment session
      const initResponse = await gatewayAdapter.createPayment({
        amount: bookingFee,
        currency: payment.currency,
        reference,
        successUrl,
        cancelUrl,
        notifyUrl: `${
          process.env.BACKEND_URL || "https://towmech-main.onrender.com"
        }/api/payments/notify/payfast`,
        customerEmail: req.user.email,
      });

      // ✅ Save gateway response
      payment.providerReference = reference;
      payment.providerPayload = initResponse;
      await payment.save();

      const paymentUrl =
        initResponse.paymentUrl ||
        initResponse.url ||
        initResponse.payment_url ||
        null;

      console.log("✅ PAYMENT URL GENERATED:", paymentUrl);

      return res.status(201).json({
        message: `${activeGateway} payment initialized ✅`,
        gateway: activeGateway,
        payment,
        paymentUrl,
        url: paymentUrl,
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
 * ✅ MANUAL FALLBACK
 * PATCH /api/payments/job/:jobId/mark-paid
 */
router.patch("/job/:jobId/mark-paid", auth, async (req, res) => {
  try {
    const payment = await Payment.findOne({ job: req.params.jobId });

    if (!payment) {
      return res.status(404).json({ message: "Payment not found for job" });
    }

    if (
      ![USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.CUSTOMER].includes(
        req.user.role
      )
    ) {
      return res.status(403).json({
        message: "Only Admin, SuperAdmin or Customer can mark payment as paid",
      });
    }

    if (
      req.user.role === USER_ROLES.CUSTOMER &&
      payment.customer.toString() !== req.user._id.toString()
    ) {
      return res
        .status(403)
        .json({ message: "Not authorized to mark this payment" });
    }

    if (payment.status === PAYMENT_STATUSES.PAID) {
      return res
        .status(200)
        .json({ message: "Payment already PAID ✅", payment });
    }

    payment.status = PAYMENT_STATUSES.PAID;
    payment.paidAt = new Date();
    payment.providerReference = `MANUAL-${Date.now()}`;

    // ✅ Audit
    payment.manualMarkedBy = req.user._id;
    payment.manualMarkedAt = new Date();

    await payment.save();

    const job = await Job.findById(payment.job);
    if (!job) return res.status(404).json({ message: "Job not found" });

    if (!job.pricing) job.pricing = {};
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
    return res
      .status(500)
      .json({ message: "Could not mark payment", error: err.message });
  }
});

export default router;