/**
 * What may be written about a phone number when something goes wrong.
 *
 * A delivery failure has to be diagnosable — an operator needs to tell "the
 * provider is down" from "this one number is unroutable" — but the log line
 * that carries that answer must not carry the customer's number. Logs are
 * shipped, retained and read by people who have no business knowing who
 * signed in; on a platform where the phone number *is* the account
 * identifier, a log of failed OTP deliveries is a list of customers.
 *
 * Keeping the last two digits is deliberate: enough to correlate two entries
 * about the same number inside one incident, far too little to recover it.
 *
 * @example maskPhone('+37493600600') // '+374*******00'
 */
export const maskPhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) {
    // Too short to mask usefully; nothing here is worth logging either.
    return '***';
  }
  const country = phone.startsWith('+') ? `+${digits.slice(0, 3)}` : '';
  const tail = digits.slice(-2);
  const hidden = '*'.repeat(Math.max(1, digits.length - (country ? 3 : 0) - 2));
  return `${country}${hidden}${tail}`;
};
