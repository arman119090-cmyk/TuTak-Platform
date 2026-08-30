/**
 * A marker for the non-production Sentry verification endpoints/scripts,
 * embedded directly in the `Error` message sent to Sentry — which goes
 * through the same privacy sanitizer (`sentrySanitize.ts`) as every other
 * event. Letters only, deliberately: a digit run of 9+ (an ISO timestamp,
 * `Date.now()`) is exactly what `scrubString` treats as a phone/card/account
 * number and redacts, so a timestamp-based marker would occasionally vanish
 * from the very event meant to prove delivery. A short run of random letters
 * carries no such pattern and always survives.
 */
export function randomMarkerSuffix(length = 10): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
