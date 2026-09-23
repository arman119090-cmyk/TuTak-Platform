/**
 * An Armenian mobile number in the one form the API accepts, `+374XXXXXXXX`,
 * from however an owner typed it — or `null` when it is not one.
 *
 * The invitation form used to test the raw text against `^\+374\d{8}$`, so
 * "+374 91 23 45 67", "091 234567" (how the number is written on paper in
 * Armenia) or a pasted "374-91-234567" left the Send button disabled with
 * nothing on the screen saying why. Same rule as the mobile app's
 * `localPhoneDigits`: separators are dropped, a leading 0, 374, 00374 or
 * +374 is the country prefix, and exactly eight digits must remain.
 */
export function normalizeArmenianPhone(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('00374')) digits = digits.slice(5);
  else if (digits.startsWith('374') && digits.length === 11) digits = digits.slice(3);
  else if (digits.startsWith('0') && digits.length === 9) digits = digits.slice(1);
  return /^\d{8}$/.test(digits) ? `+374${digits}` : null;
}
