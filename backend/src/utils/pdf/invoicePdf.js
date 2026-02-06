// backend/src/utils/pdf/invoicePdf.js
import PDFDocument from "pdfkit";

function money(n) {
  const v = Number(n || 0) || 0;
  return v.toFixed(2);
}

function safe(s) {
  if (s === null || s === undefined) return "";
  return String(s);
}

function ymd(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function titlePeriod(period) {
  if (period?.month) return `Month: ${period.month}`;
  return `From ${ymd(period?.from)} to ${ymd(period?.to)}`;
}

function addHeader(doc, heading, invoice) {
  doc.fontSize(16).text("TowMech", { continued: true }).fontSize(10).text("  |  Insurance Billing", { align: "left" });
  doc.moveDown(0.2);
  doc.fontSize(14).text(heading);
  doc.moveDown(0.5);

  doc.fontSize(10).text(`Partner: ${safe(invoice?.partner?.name)} (${safe(invoice?.partner?.partnerCode)})`);
  doc.text(`Country: ${safe(invoice?.countryCode)}   Currency: ${safe(invoice?.currency)}`);
  doc.text(titlePeriod(invoice?.period));
  doc.moveDown(0.8);

  doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
  doc.moveDown(0.6);
}

function drawTable(doc, columns, rows) {
  // columns: [{key, label, width}]
  const startX = 40;
  const usableW = 515;
  const totalW = columns.reduce((s, c) => s + c.width, 0);
  const scale = totalW > usableW ? usableW / totalW : 1;

  const cols = columns.map((c) => ({ ...c, w: c.width * scale }));
  const rowH = 16;

  const headerY = doc.y;
  let x = startX;
  doc.fontSize(9).font("Helvetica-Bold");
  for (const c of cols) {
    doc.text(c.label, x, headerY, { width: c.w, align: "left" });
    x += c.w;
  }
  doc.font("Helvetica");
  doc.moveDown(0.6);

  let y = doc.y;
  for (const r of rows) {
    if (y > 760) {
      doc.addPage();
      y = 50;
    }

    x = startX;
    for (const c of cols) {
      const text = safe(r[c.key]);
      doc.fontSize(9).text(text, x, y, { width: c.w, align: "left" });
      x += c.w;
    }
    y += rowH;
  }
  doc.y = y + 4;
}

function bufferFromDoc(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

/**
 * 1) ✅ Partner invoice (insurance company owes you)
 * Total = totals.totalPartnerAmountDue (gross)
 */
export async function renderPartnerInvoicePdfBuffer(invoice) {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  addHeader(doc, "Insurance Partner Invoice (Amount Due)", invoice);

  doc.fontSize(11).font("Helvetica-Bold").text("Totals");
  doc.font("Helvetica").moveDown(0.4);

  const t = invoice?.totals || {};
  doc.fontSize(10).text(`Total jobs: ${safe(t.totalJobs)}`);
  doc.text(`Gross total (partner owes): ${money(t.totalPartnerAmountDue)} ${safe(invoice?.currency)}`);
  doc.moveDown(0.2);
  doc.fontSize(9).text(`(Info) Booking fee waived: ${money(t.totalBookingFeeWaived)} ${safe(invoice?.currency)}`);
  doc.fontSize(9).text(`(Info) Commission total: ${money(t.totalCommission)} ${safe(invoice?.currency)}`);
  doc.moveDown(0.8);

  doc.fontSize(11).font("Helvetica-Bold").text("Jobs Included");
  doc.font("Helvetica").moveDown(0.4);

  const rows = (invoice?.items || []).map((it) => ({
    shortId: it.shortId,
    createdAt: ymd(it.createdAt),
    provider: it?.provider?.name || "-",
    pickup: (it.pickupAddressText || "-").slice(0, 30),
    dropoff: (it.dropoffAddressText || "-").slice(0, 30),
    gross: money(it?.pricing?.estimatedTotal),
    code: it?.insurance?.code || "-",
  }));

  drawTable(
    doc,
    [
      { key: "shortId", label: "Job", width: 55 },
      { key: "createdAt", label: "Date", width: 70 },
      { key: "provider", label: "Provider", width: 110 },
      { key: "pickup", label: "Pickup", width: 110 },
      { key: "dropoff", label: "Dropoff", width: 110 },
      { key: "gross", label: "Gross", width: 55 },
      { key: "code", label: "Ins Code", width: 60 },
    ],
    rows
  );

  doc.moveDown(0.6);
  doc.fontSize(12).font("Helvetica-Bold").text(
    `TOTAL AMOUNT DUE: ${money(t.totalPartnerAmountDue)} ${safe(invoice?.currency)}`,
    { align: "right" }
  );

  return bufferFromDoc(doc);
}

/**
 * 2) ✅ Providers owed summary (tabulated by driver)
 * Must show:
 * - total owed (net)
 * - gross
 * - commission (booking fee)
 */
export async function renderProvidersSummaryPdfBuffer(invoice) {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  addHeader(doc, "Providers Owed Summary (Tabulated)", invoice);

  const t = invoice?.totals || {};
  doc.fontSize(11).font("Helvetica-Bold").text("Totals");
  doc.font("Helvetica").moveDown(0.4);

  doc.fontSize(10).text(`Total jobs: ${safe(t.totalJobs)}`);
  doc.text(`Total provider amount due (NET): ${money(t.totalProviderAmountDue)} ${safe(invoice?.currency)}`);
  doc.fontSize(9).text(`(Info) Total commission/booking fee: ${money(t.totalCommission)} ${safe(invoice?.currency)}`);
  doc.moveDown(0.8);

  doc.fontSize(11).font("Helvetica-Bold").text("Providers");
  doc.font("Helvetica").moveDown(0.4);

  const rows = (invoice?.groupedByProvider || []).map((p) => ({
    name: p?.name || "Unknown",
    providerId: safe(p?.providerId).slice(0, 8) + "…",
    jobs: String(p?.jobCount || 0),
    gross: money(p?.grossTotal),
    commission: money(p?.commissionTotal),
    net: money(p?.netTotalDue),
  }));

  drawTable(
    doc,
    [
      { key: "name", label: "Provider", width: 170 },
      { key: "providerId", label: "ProviderId", width: 80 },
      { key: "jobs", label: "Jobs", width: 40 },
      { key: "gross", label: "Gross", width: 70 },
      { key: "commission", label: "Commission", width: 80 },
      { key: "net", label: "Net Due", width: 70 },
    ],
    rows
  );

  doc.moveDown(0.6);
  doc.fontSize(12).font("Helvetica-Bold").text(
    `TOTAL NET DUE (ALL PROVIDERS): ${money(t.totalProviderAmountDue)} ${safe(invoice?.currency)}`,
    { align: "right" }
  );

  return bufferFromDoc(doc);
}

/**
 * 3) ✅ Per-driver detailed statement
 * Include:
 * - provider info
 * - partner who requested service
 * - trip details + timestamps
 * - per-job gross / commission / net
 */
export async function renderProviderDetailPdfBuffer(invoice, providerId) {
  const doc = new PDFDocument({ size: "A4", margin: 40 });

  const pid = String(providerId || "").trim();
  if (!pid) {
    doc.fontSize(12).text("providerId is required for detailed provider statement.");
    return bufferFromDoc(doc);
  }

  const providerBlock = (invoice?.groupedByProvider || []).find((p) => String(p?.providerId) === pid) || null;

  addHeader(doc, "Provider Detailed Statement", invoice);

  doc.fontSize(11).font("Helvetica-Bold").text("Provider");
  doc.font("Helvetica").moveDown(0.3);
  doc.fontSize(10).text(`Name: ${safe(providerBlock?.name || "Unknown Provider")}`);
  doc.text(`ProviderId: ${safe(pid)}`);
  if (providerBlock?.email) doc.text(`Email: ${safe(providerBlock.email)}`);
  if (providerBlock?.phone) doc.text(`Phone: ${safe(providerBlock.phone)}`);
  doc.moveDown(0.6);

  doc.fontSize(11).font("Helvetica-Bold").text("Insurance Partner (Requester)");
  doc.font("Helvetica").moveDown(0.3);
  doc.fontSize(10).text(`Partner: ${safe(invoice?.partner?.name)} (${safe(invoice?.partner?.partnerCode)})`);
  doc.moveDown(0.8);

  doc.fontSize(11).font("Helvetica-Bold").text("Summary");
  doc.font("Helvetica").moveDown(0.3);

  doc.fontSize(10).text(`Jobs: ${safe(providerBlock?.jobCount || 0)}`);
  doc.text(`Gross total: ${money(providerBlock?.grossTotal)} ${safe(invoice?.currency)}`);
  doc.text(`Commission (booking fee): ${money(providerBlock?.commissionTotal)} ${safe(invoice?.currency)}`);
  doc.fontSize(11).font("Helvetica-Bold").text(
    `NET AMOUNT DUE: ${money(providerBlock?.netTotalDue)} ${safe(invoice?.currency)}`,
    { align: "left" }
  );

  doc.moveDown(0.8);
  doc.fontSize(11).font("Helvetica-Bold").text("Job Breakdown");
  doc.font("Helvetica").moveDown(0.4);

  const jobs = (providerBlock?.jobs || []).map((j) => ({
    shortId: j.shortId,
    createdAt: ymd(j.createdAt),
    status: j.status,
    pickup: (j.pickupAddressText || "-").slice(0, 28),
    dropoff: (j.dropoffAddressText || "-").slice(0, 28),
    gross: money(j.estimatedTotal),
    comm: money(j.commissionAmount),
    net: money(j.providerAmountDue),
    code: j.insuranceCode || "-",
  }));

  drawTable(
    doc,
    [
      { key: "shortId", label: "Job", width: 55 },
      { key: "createdAt", label: "Date", width: 60 },
      { key: "status", label: "Status", width: 70 },
      { key: "pickup", label: "Pickup", width: 105 },
      { key: "dropoff", label: "Dropoff", width: 105 },
      { key: "gross", label: "Gross", width: 50 },
      { key: "comm", label: "Comm", width: 45 },
      { key: "net", label: "Net", width: 45 },
      { key: "code", label: "Ins Code", width: 60 },
    ],
    jobs
  );

  doc.moveDown(0.7);
  doc.fontSize(12).font("Helvetica-Bold").text(
    `NET AMOUNT DUE: ${money(providerBlock?.netTotalDue)} ${safe(invoice?.currency)}`,
    { align: "right" }
  );

  return bufferFromDoc(doc);
}