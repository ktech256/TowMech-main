// backend/src/utils/pdf/providerStatementPdf.js
import PDFDocument from "pdfkit";

function money(n) {
  const v = Number(n || 0) || 0;
  return v.toFixed(2);
}

function safe(s) {
  return s === null || s === undefined ? "" : String(s);
}

function ymd(d) {
  if (!d) return "";
  try {
    const dt = new Date(d);
    return dt.toISOString().slice(0, 10);
  } catch { return ""; }
}

function createDoc() {
  return new PDFDocument({ size: "A4", margin: 40 });
}

function drawRoundedRect(doc, x, y, w, h, r = 8) {
  return doc.roundedRect(x, y, w, h, r);
}

export async function renderProviderStatementPdfBuffer(payout) {
  const doc = createDoc();
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // Header
  doc.font("Helvetica-Bold").fontSize(20).fillColor("#111827").text("TowMech", left, 40);
  doc.font("Helvetica").fontSize(10).fillColor("#6B7280").text("Service Provider Weekly Statement", left, 65);

  doc.moveDown(2);

  // Meta Box
  const boxY = doc.y;
  doc.save();
  doc.fillColor("#F9FAFB");
  drawRoundedRect(doc, left, boxY, width, 90, 10).fill();
  doc.restore();

  doc.fillColor("#111827").fontSize(10);
  doc.font("Helvetica-Bold").text("Provider Details", left + 15, boxY + 15);
  doc.font("Helvetica").text(`Name: ${safe(payout.provider?.name)}`, left + 15, boxY + 30);
  doc.text(`Provider ID: ${safe(payout.provider?._id)}`, left + 15, boxY + 42);
  doc.text(`Email: ${safe(payout.provider?.email)}`, left + 15, boxY + 54);

  const rightX = left + width - 180;
  doc.font("Helvetica-Bold").text("Statement Period", rightX, boxY + 15);
  doc.font("Helvetica").text(`From: ${ymd(payout.weekStartDate)}`, rightX, boxY + 30);
  doc.text(`To: ${ymd(payout.weekEndDate)}`, rightX, boxY + 42);
  doc.text(`Status: ${safe(payout.status)}`, rightX, boxY + 54);
  if (payout.paidAt) doc.text(`Paid At: ${ymd(payout.paidAt)}`, rightX, boxY + 66);

  doc.y = boxY + 110;

  // Summary
  doc.font("Helvetica-Bold").fontSize(14).text("Earnings Summary", left);
  doc.moveDown(0.5);

  const insuranceJobs = payout.jobs.filter(j => j.isInsurance);
  const cashJobs = payout.jobs.filter(j => !j.isInsurance);

  const insuranceTotal = insuranceJobs.reduce((s, j) => s + (j.amount || 0), 0);
  const cashTotal = cashJobs.reduce((s, j) => s + (j.amount || 0), 0);

  const summaryData = [
    { label: "Insurance Jobs", count: insuranceJobs.length, total: insuranceTotal },
    { label: "Cash Jobs (Direct)", count: cashJobs.length, total: cashTotal },
  ];

  let currentY = doc.y;
  summaryData.forEach(row => {
    doc.font("Helvetica").fontSize(10).text(row.label, left + 10, currentY);
    doc.text(String(row.count), left + 150, currentY);
    doc.text(`${money(row.total)} ${payout.currency}`, left + 300, currentY, { align: "right", width: width - 310 });
    currentY += 18;
  });

  doc.save().moveTo(left, currentY).lineTo(left + width, currentY).stroke("#E5E7EB").restore();
  currentY += 8;
  doc.font("Helvetica-Bold").text("Total Earnings", left + 10, currentY);
  doc.text(`${money(insuranceTotal + cashTotal)} ${payout.currency}`, left + 300, currentY, { align: "right", width: width - 310 });

  doc.y = currentY + 40;

  // Job List
  doc.font("Helvetica-Bold").fontSize(14).text("Job Breakdown", left);
  doc.moveDown(0.5);

  const tableTop = doc.y;
  doc.fontSize(10).font("Helvetica-Bold");
  doc.text("Date", left, tableTop);
  doc.text("Job ID", left + 80, tableTop);
  doc.text("Type", left + 180, tableTop);
  doc.text("Status", left + 260, tableTop);
  doc.text("Earnings", left + 350, tableTop, { align: "right", width: width - 350 });

  doc.moveDown(0.5);
  doc.save().moveTo(left, doc.y).lineTo(left + width, doc.y).stroke("#111827").restore();
  doc.moveDown(0.3);

  doc.font("Helvetica").fontSize(9);
  payout.jobs.forEach(item => {
    const y = doc.y;
    if (y > 750) { doc.addPage(); doc.y = 40; }

    doc.text(ymd(item.completedAt), left, doc.y);
    doc.text(safe(item.job?._id || item.job).slice(-8).toUpperCase(), left + 80, y);
    doc.text(item.isInsurance ? "Insurance" : "Cash", left + 180, y);
    doc.text("Completed", left + 260, y);
    doc.text(`${money(item.amount)} ${payout.currency}`, left + 350, y, { align: "right", width: width - 350 });
    doc.moveDown(1);
  });

  // Final Callout
  doc.moveDown(2);
  const footerY = doc.y;
  doc.save();
  doc.fillColor("#111827");
  drawRoundedRect(doc, left + width - 200, footerY, 200, 50, 10).fill();
  doc.restore();

  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(10);
  doc.text("PAYABLE BY TOWMECH", left + width - 185, footerY + 12);
  doc.fontSize(16).text(`${money(payout.totalAmount)} ${payout.currency}`, left + width - 185, footerY + 28);

  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}
