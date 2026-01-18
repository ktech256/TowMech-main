// /backend/src/utils/maskDigits.js

/**
 * ✅ maskDigits(text)
 * Rule: "Exchanging contacts not allowed"
 * - We do NOT fully redact the message (keeps conversation readable)
 * - We simply change 2 digits in any long digit sequence (e.g. phone number)
 *
 * Example:
 * "Call me 0821234567" => "Call me 0821234 8 6 7" (digits adjusted)
 */
export function maskDigits(input) {
  const text = String(input || "");

  // Replace any long digit sequence (7+ digits) because it's likely a phone number
  // and also handle cases with spaces/dashes between digits.
  return text.replace(/(\d[\d\s-]{6,}\d)/g, (match) => {
    const digits = match.replace(/[^\d]/g, "");
    if (digits.length < 7) return match;

    // Change exactly 2 digits safely (not first digit to keep message readable)
    const arr = digits.split("");

    // Pick 2 positions near the end
    const i1 = Math.max(1, arr.length - 3);
    const i2 = Math.max(2, arr.length - 2);

    // Change them
    arr[i1] = arr[i1] === "9" ? "8" : String(Number(arr[i1]) + 1);
    arr[i2] = arr[i2] === "0" ? "1" : String(Number(arr[i2]) - 1);

    // Rebuild keeping original separators
    let rebuilt = "";
    let di = 0;
    for (let i = 0; i < match.length; i++) {
      const ch = match[i];
      if (/\d/.test(ch)) {
        rebuilt += arr[di++] ?? ch;
      } else {
        rebuilt += ch;
      }
    }

    return rebuilt;
  });
}