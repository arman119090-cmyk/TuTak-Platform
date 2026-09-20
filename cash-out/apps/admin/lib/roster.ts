export interface RosterInputRow {
  phone: string;
  externalProfileId: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Parses the roster textarea: one driver per line, `phone, profileId[, first[, last]]`.
 * Commas, semicolons and tabs all separate; blank lines and a header line are
 * skipped; a phone typed with spaces or dashes is kept as typed — the API
 * normalises it and reports what it could not read, row by row.
 */
export function parseRoster(text: string): RosterInputRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^phone\b/i.test(line))
    .map((line) => {
      const [phone = '', externalProfileId = '', firstName, lastName] = line
        .split(/[,;\t]/)
        .map((cell) => cell.trim());
      return {
        phone,
        externalProfileId,
        ...(firstName ? { firstName } : {}),
        ...(lastName ? { lastName } : {}),
      };
    });
}
