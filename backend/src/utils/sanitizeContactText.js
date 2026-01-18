// src/utils/sanitizeContactText.js

/**
 * ✅ Mask phone-like digit sequences:
 * - If 7+ digits (with optional spaces/dashes), we alter TWO digits
 * - Keep same length, just wrong digits
 */
function maskDigitsTwo(text) {
  // match digit runs including separators, but we sanitize only the digits
  return text.replace(/(\+?\d[\d\s-]{6,}\d)/g, (match) => {
    const digitsOnly = match.replace(/[^\d]/g, "");
    if (digitsOnly.length < 7) return match;

    // change two digits roughly in the middle
    const arr = digitsOnly.split("");
    const mid = Math.floor(arr.length / 2);

    const i1 = Math.max(1, mid - 1);
    const i2 = Math.min(arr.length - 2, mid + 1);

    // flip digits deterministically
    arr[i1] = arr[i1] === "9" ? "7" : "9";
    arr[i2] = arr[i2] === "8" ? "6" : "8";

    const maskedDigits = arr.join("");

    // re-insert into original match shape (simple replacement: replace all digits sequentially)
    let di = 0;
    const rebuilt = match.replace(/\d/g, () => maskedDigits[di++]);
    return rebuilt;
  });
}

/**
 * ✅ Mask emails: keep shape but hide details
 */
function maskEmails(text) {
  return text.replace(
    /([A-Z0-9._%+-]{2})[A-Z0-9._%+-]*@([A-Z0-9.-]{1})[A-Z0-9.-]*\.[A-Z]{2,}/gi,
    (m, p1, p2) => `${p1}***@${p2}***.***`
  );
}

/**
 * ✅ Main sanitizer
 */
export function sanitizeContactText(input) {
  const original = String(input || "");
  if (!original.trim()) return { text: "", changed: false, note: "" };

  let out = original;

  const before = out;
  out = maskEmails(out);
  out = maskDigitsTwo(out);

  const changed = out !== before;

  return {
    text: out,
    changed,
    note: changed ? "Contact details were masked for safety" : "",
  };
}