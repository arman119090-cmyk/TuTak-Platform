/**
 * The two derived numbers on the charging screen.
 *
 * They live here rather than inside the component because they are the only
 * part of that screen that can be wrong in a way a user would notice, and a
 * pure function can be tested without a renderer.
 */

/** mm:ss under an hour, h:mm:ss beyond it. */
export function formatElapsed(fromIso: string, now: number): string {
  const started = new Date(fromIso).getTime();
  if (!Number.isFinite(started)) return '—';
  // Clamped at zero: a phone whose clock is behind the server's would
  // otherwise count backwards from a negative number.
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * What the session looks likely to cost, from the energy the charge point
 * has reported so far.
 *
 * Deliberately an estimate. The bill is computed server-side at stop time
 * from the same two numbers, but a meter value can land between this render
 * and that request, so showing this as final would be a promise the client
 * cannot keep. Returns null when there is no price to multiply by, which is
 * the case for a session whose connector was not joined into the response.
 */
export function estimateSessionCost(
  energyKwh: string | number | null | undefined,
  pricePerKwh: string | number | null | undefined,
): number | null {
  if (pricePerKwh === null || pricePerKwh === undefined || pricePerKwh === '') return null;
  const price = Number(pricePerKwh);
  const energy = Number(energyKwh ?? 0);
  if (!Number.isFinite(price) || !Number.isFinite(energy)) return null;
  return energy * price;
}
