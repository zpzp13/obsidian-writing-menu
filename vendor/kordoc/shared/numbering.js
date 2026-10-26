// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/shared/numbering.ts. MIT; see LICENSE.
const HANGUL_INITIALS = [0, 2, 3, 5, 6, 7, 9, 11, 12, 14, 15, 16, 17, 18];
const HANGUL_MEDIALS = [0, 4, 8, 13, 18, 20];
function hangulOrdinal(n) {
  const cols = HANGUL_INITIALS.length;
  const vowel = HANGUL_MEDIALS[Math.min(Math.floor(n / cols), HANGUL_MEDIALS.length - 1)];
  const init = HANGUL_INITIALS[n % cols];
  return String.fromCodePoint(44032 + init * 588 + vowel * 28);
}
function circledNumber(n) {
  if (n < 20)
    return String.fromCodePoint(9312 + n);
  if (n < 35)
    return String.fromCodePoint(12881 + (n - 20));
  if (n < 50)
    return String.fromCodePoint(12977 + (n - 35));
  return `(${n + 1})`;
}
function circledHangul(n) {
  return n < 14 ? String.fromCodePoint(12910 + n) : hangulOrdinal(n);
}
const AMOUNT_DIGITS = "\uC601\uC77C\uC774\uC0BC\uC0AC\uC624\uC721\uCE60\uD314\uAD6C";
const AMOUNT_SMALL = ["", "\uC2ED", "\uBC31", "\uCC9C"];
const AMOUNT_BIG = ["", "\uB9CC", "\uC5B5", "\uC870", "\uACBD", "\uD574"];
function hangulAmount(n) {
  const digits = String(n).replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!digits || digits === "0")
    return "\uC601";
  const groups = [];
  for (let end = digits.length; end > 0; end -= 4)
    groups.unshift(digits.slice(Math.max(0, end - 4), end));
  let out = "";
  groups.forEach((g, i) => {
    let part = "";
    const padded = g.padStart(4, "0");
    for (let k = 0; k < 4; k++) {
      const d = Number(padded[k]);
      if (d)
        part += AMOUNT_DIGITS[d] + AMOUNT_SMALL[3 - k];
    }
    if (part)
      out += part + (AMOUNT_BIG[groups.length - 1 - i] ?? "");
  });
  return out;
}
function romanNumeral(n, upper) {
  if (n <= 0 || n > 3999)
    return String(n);
  const values = [1e3, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const symbols = upper ? ["M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"] : ["m", "cm", "d", "cd", "c", "xc", "l", "xl", "x", "ix", "v", "iv", "i"];
  let result = "";
  let num = n;
  for (let i = 0; i < values.length; i++) {
    while (num >= values[i]) {
      result += symbols[i];
      num -= values[i];
    }
  }
  return result;
}
export {
  circledHangul,
  circledNumber,
  hangulAmount,
  hangulOrdinal,
  romanNumeral
};
