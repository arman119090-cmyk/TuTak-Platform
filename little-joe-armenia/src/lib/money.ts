import type { Locale } from "@/i18n/config";

// AMD formatting is implemented by hand instead of Intl so the server and
// every browser produce byte-identical output (ICU data differs between
// platforms, which would cause hydration mismatches).
//   hy / ru: 12 500 ֏   it: 12.500 ֏   en: ֏12,500
const NBSP = " ";

function group(n: number, sep: string): string {
  const digits = Math.trunc(Math.abs(n)).toString();
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    const fromEnd = digits.length - i;
    out += digits[i];
    if (fromEnd > 1 && fromEnd % 3 === 1) out += sep;
  }
  return out;
}

export function formatAmd(amount: number, locale: Locale): string {
  const sign = amount < 0 ? "−" : "";
  switch (locale) {
    case "en":
      return `${sign}֏${group(amount, ",")}`;
    case "it":
      return `${sign}${group(amount, ".")}${NBSP}֏`;
    default:
      return `${sign}${group(amount, NBSP)}${NBSP}֏`;
  }
}
