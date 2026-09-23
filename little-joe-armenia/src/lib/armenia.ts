// Armenia's first-level administrative divisions: the city of Yerevan and
// ten provinces (marzer). Codes follow ISO 3166-2:AM. Delivery methods list
// the codes they serve; prices live in the database, not here.
export const REGION_CODES = ["ER", "AG", "AR", "AV", "GR", "KT", "LO", "SH", "SU", "TV", "VD"] as const;
export type RegionCode = (typeof REGION_CODES)[number];

export function isRegionCode(v: unknown): v is RegionCode {
  return typeof v === "string" && (REGION_CODES as readonly string[]).includes(v);
}

/**
 * Normalises an Armenian phone number to E.164 (+374XXXXXXXX).
 * Accepts +374…, 00374…, 374… and national 0XX XXXXXX forms.
 * Returns null when the input is not an 8-digit Armenian subscriber number.
 */
export function normalizeArmenianPhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  let national: string;
  if (digits.startsWith("+374")) national = digits.slice(4);
  else if (digits.startsWith("00374")) national = digits.slice(5);
  else if (digits.startsWith("374") && digits.length === 11) national = digits.slice(3);
  else if (digits.startsWith("0")) national = digits.slice(1);
  else national = digits;
  if (!/^\d{8}$/.test(national)) return null;
  // Area/operator codes never start with 0.
  if (national.startsWith("0")) return null;
  return `+374${national}`;
}
