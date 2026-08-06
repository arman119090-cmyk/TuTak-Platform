const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Parses simple durations like "15m", "30d", "1h" into milliseconds. */
export function parseDurationMs(input: string): number {
  const match = /^(\d+)([smhd])$/.exec(input.trim());
  if (!match) {
    throw new Error(`Invalid duration string: ${input}`);
  }
  const [, amount, unit] = match as unknown as [string, string, keyof typeof UNIT_MS];
  return parseInt(amount, 10) * UNIT_MS[unit]!;
}
