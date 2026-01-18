/**
 * Rule:
 * - Do NOT allow exchanging contact numbers.
 * - We keep the message readable but "wrong".
 * - We "change two digits" inside any long digit sequence.
 *
 * Example:
 * "Call me 0831234567" -> "Call me 0831234569" (and another digit changed)
 */

function changeDigit(d) {
  const n = Number(d);
  if (Number.isNaN(n)) return d;
  // rotate by +3 (0->3, 7->0 etc.)
  return String((n + 3) % 10);
}

function maskDigitRun(run) {
  // run is only digits, length >= 7
  const arr = run.split("");
  // change 2 digits: choose positions (safe: 2nd and 2nd-last)
  const i1 = Math.min(1, arr.length - 1);
  const i2 = Math.max(arr.length - 2, 0);

  arr[i1] = changeDigit(arr[i1]);
  arr[i2] = changeDigit(arr[i2]);

  return arr.join("");
}

export function maskDigitsInText(text = "") {
  const s = String(text || "");

  // Replace long digit sequences (7+ digits) only
  return s.replace(/\d{7,}/g, (match) => maskDigitRun(match));
}

export default maskDigitsInText;