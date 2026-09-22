/**
 * The eight local digits of an Armenian mobile number, from whatever was
 * typed or pasted.
 *
 * Every phone field in the app shows a fixed "+374" prefix and asks for
 * the rest. People paste whole numbers anyway — from a contact card, an
 * SMS, a business card photo — and a paste of "+374 91 234567" used to
 * become "37491234", the first eight digits of the whole string, which the
 * screen then sent as +37437491234. The number looked filled in and was
 * wrong.
 *
 * Accepts: the local part alone, a leading 0 (how the number is written
 * on paper in Armenia), a leading 374 or +374, and any spaces, dashes or
 * brackets. Returns at most eight digits; the field's own `maxLength`
 * still applies to typing.
 */
export function localPhoneDigits(input: string): string {
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('374') && digits.length > 8) digits = digits.slice(3);
  else if (digits.startsWith('0') && digits.length > 8) digits = digits.slice(1);
  return digits.slice(0, 8);
}
