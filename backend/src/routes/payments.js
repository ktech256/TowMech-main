import express from "express";
import Payment, { PAYMENT_STATUSES } from "../models/Payment.js";
import Job, { JOB_STATUSES } from "../models/Job.js";
import auth from "../middleware/auth.js";
import authorizeRoles from "../middleware/role.js";
import { USER_ROLES } from "../models/User.js";

import { broadcastJobToProviders } from "../utils/broadcastJob.js";

// ✅ PAYSTACK HELPERS
import {
  initializePaystackTransaction,
  verifyPaystackTransaction
} from "../utils/paystack.js";

// ✅ IKHOKHA HELPERS
import {
  initializeIKhokhaPayment,
  verifyIKhokhaPayment
} from "../utils/ikhokha.js";

const router = express.Router();

// ✅ CONFIRM ROUTE IS LOADED
console.log("✅ payments.js loaded ✅");

/**
 * ✅ Customer creates booking fee payment for a Job
 * POST /api/payments/create
 * ✅ Creates payment record + initializes IKhokha OR Paystack
 * ✅ FIXED: If payment exists & is still PENDING, re-init gateway and return url
 */
router.post("/create", auth, authorizeRoles(USER_ROLES.CUSTOMER), async (req, res) => {
  console.log("✅ /api/payments/create HIT ✅", req.body);

  try {
    const { jobId, gateway } = req.body;
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
        message: "Booking fee is not set for this job. Cannot create payment."
      });
    }

    // ✅ Choose gateway (default = IKHOKHA)
    const chosenGateway = (gateway || "IKHOKHA").toUpperCase();

    // ✅ Check if payment already exists
    let payment = await Payment.findOne({ job: job._id });

    // ✅ If payment exists and already PAID, stop here
    if (payment && payment.status === PAYMENT_STATUSES.PAID) {
      return res.status(200).json({
        message: "Payment already PAID ✅",
        payment
      });
    }

    // ✅ If payment does NOT exist, create new pending record
    if (!payment) {
      payment = await Payment.create({
        job: job._id,
        customer: req.user._id,
        amount: bookingFee,
        currency: job.pricing?.currency || "ZAR",
        status: PAYMENT_STATUSES.PENDING,
        provider: chosenGateway
      });
    } else {
      // ✅ payment exists but PENDING → allow re-init
      payment.provider = chosenGateway;
      await payment.save();
    }

    /**
     * ✅ PAYSTACK INIT
     */
    if (chosenGateway === "PAYSTACK") {
      const paystackInit = await initializePaystackTransaction({
        email: req.user.email,
        amount: Math.round(bookingFee * 100),
        currency: payment.currency,
        metadata: {
          jobId: job._id,
          paymentId: payment._id,
          customerId: req.user._id
        }
      });

      if (!paystackInit.status) {
        return res.status(500).json({
          message: "Failed to initialize Paystack transaction",
          paystackInit
        });
      }

      payment.providerReference = paystackInit.data.reference;
      payment.providerPayload = paystackInit;
      await payment.save();

      return res.status(201).json({
        message: "Paystack payment initialized ✅",
        payment,
        paystack: {
          authorization_url: paystackInit.data.authorization_url,
          access_code: paystackInit.data.access_code,
          reference: paystackInit.data.reference
        }
      });
    }

    /**
     * ✅ IKHOKHA PAYLINK INIT (DEFAULT)
     */
    const generatedReference = `TM-${payment._id}`;

    const ikhInit = await initializeIKhokhaPayment({
      amount: bookingFee,
      currency: payment.currency,
      reference: generatedReference
    });

    console.log("✅ iKhokha INIT RESPONSE (FULL):", JSON.stringify(ikhInit, null, 2));

    if (!ikhInit) {
      return res.status(500).json({
        message: "Failed to initialize iKhokha transaction",
        ikhInit
      });
    }

    const paymentUrl =
      ikhInit.paylinkUrl ||
      ikhInit.paylinkUrlUrl ||
      ikhInit.url ||
      null;

    const externalTransactionID =
      ikhInit.externalTransactionID || generatedReference;

    if (!paymentUrl) {
      return res.status(500).json({
        message: "iKhokha init succeeded but paylinkUrl missing ❌",
        ikhInit
      });
    }

    payment.providerReference = externalTransactionID;
    payment.providerPayload = ikhInit;
    await payment.save();

    return res.status(201).json({
      message: "iKhokha payment initialized ✅",
      payment,
      ikhokha: {
        reference: externalTransactionID,
        paymentUrl
      }
    });

  } catch (err) {
    console.error("❌ PAYMENT CREATE ERROR:", err);
    return res.status(500).json({
      message: "Could not create payment",
      error: err.message
    });
  }
});

/**
 * ✅ VERIFY PAYSTACK TRANSACTION
 * GET /api/payments/verify/paystack/:reference
 */
router.get("/verify/paystack/:reference", auth, async (req, res) => {
  try {
    const { reference } = req.params;

    const verifyRes = await verifyPaystackTransaction(reference);

    if (!verifyRes.status) {
      return res.status(400).json({ message: "Paystack verification failed", verifyRes });
    }

    const trx = verifyRes.data;

    if (trx.status !== "success") {
      return res.status(400).json({
        message: "Payment not successful",
        trxStatus: trx.status
      });
    }

    const payment = await Payment.findOne({ providerReference: reference });
    if (!payment) return res.status(404).json({ message: "Payment record not found" });

    if (payment.customer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized to verify this payment" });
    }

    if (payment.status === PAYMENT_STATUSES.PAID) {
      return res.status(200).json({ message: "Payment already verified ✅", payment });
    }

    payment.status = PAYMENT_STATUSES.PAID;
    payment.paidAt = new Date();
    await payment.save();

    const job = await Job.findById(payment.job);
    if (!job) return res.status(404).json({ message: "Job not found" });

    job.pricing.bookingFeeStatus = "PAID";
    job.pricing.bookingFeePaidAt = new Date();
    await job.save();

    const broadcastResult = await broadcastJobToProviders(job._id);

    return res.status(200).json({
      message: "Paystack payment verified ✅ Job broadcasted ✅",
      payment,
      broadcastResult
    });
  } catch (err) {
    console.error("❌ PAYSTACK VERIFY ERROR:", err);
    return res.status(500).json({ message: "Could not verify payment", error: err.message });
  }
});

/**
 * ✅ VERIFY IKHOKHA TRANSACTION
 * GET /api/payments/verify/ikhokha/:reference
 */
router.get("/verify/ikhokha/:reference", auth, async (req, res) => {
  try {
    const { reference } = req.params;

    const verifyRes = await verifyIKhokhaPayment(reference);

    console.log("✅ iKhokha VERIFY RESPONSE:", verifyRes);

    return res.status(200).json({
      message: "iKhokha Paylink API does not support direct verify yet",
      reference,
      verifyRes
    });

  } catch (err) {
    console.error("❌ IKHOKHA VERIFY ERROR:", err);
    return res.status(500).json({ message: "Could not verify payment", error: err.message });
  }
});

/**
 * ✅ Fetch payment for a job
 * GET /api/payments/job/:jobId
 */
router.get("/job/:jobId", auth, async (req, res) => {
  try {
    const payment = await Payment.findOne({ job: req.params.jobId }).populate("job");
    if (!payment) return res.status(404).json({ message: "Payment not found for job" });

    if (
      req.user.role === USER_ROLES.CUSTOMER &&
      payment.customer.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: "Not authorized to view this payment" });
    }

    return res.status(200).json({ payment });
  } catch (err) {
    console.error("❌ PAYMENT FETCH ERROR:", err);
    return res.status(500).json({ message: "Could not fetch payment", error: err.message });
  }
});

/**
 * ✅ MANUAL FALLBACK
 * PATCH /api/payments/job/:jobId/mark-paid
 * ✅ Admin + SuperAdmin + Customer can mark payment as paid
 * ✅ Records audit trail
 */
router.patch("/job/:jobId/mark-paid", auth, async (req, res) => {
  try {
    const payment = await Payment.findOne({ job: req.params.jobId });

    if (!payment) {
      return res.status(404).json({ message: "Payment not found for job" });
    }

    // ✅ Allow Admin, SuperAdmin, Customer
    if (
      ![USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.CUSTOMER].includes(req.user.role)
    ) {
      return res.status(403).json({
        message: "Only Admin, SuperAdmin or Customer can mark payment as paid"
      });
    }

    // ✅ Customer can only mark their own payment
    if (
      req.user.role === USER_ROLES.CUSTOMER &&
      payment.customer.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: "Not authorized to mark this payment" });
    }

    // ✅ If already paid
    if (payment.status === PAYMENT_STATUSES.PAID) {
      return res.status(200).json({ message: "Payment already PAID ✅", payment });
    }

    // ✅ Mark paid
    payment.status = PAYMENT_STATUSES.PAID;
    payment.paidAt = new Date();
    payment.providerReference = `MANUAL-${Date.now()}`;

    // ✅ AUDIT TRAIL (Admin or SuperAdmin OR even customer)
    payment.manualMarkedBy = req.user._id;
    payment.manualMarkedAt = new Date();

    await payment.save();

    // ✅ Update job pricing status
    const job = await Job.findById(payment.job);
    if (!job) return res.status(404).json({ message: "Job not found" });

    job.pricing.bookingFeeStatus = "PAID";
    job.pricing.bookingFeePaidAt = new Date();
    await job.save();

    // ✅ Broadcast job to providers
    const broadcastResult = await broadcastJobToProviders(job._id);

    return res.status(200).json({
      message: "Payment manually marked PAID ✅ Job broadcasted ✅",
      payment,
      broadcastResult
    });
  } catch (err) {
    console.error("❌ MANUAL MARK-PAID ERROR:", err);
    return res.status(500).json({ message: "Could not mark payment", error: err.message });
  }
});

export default router;
