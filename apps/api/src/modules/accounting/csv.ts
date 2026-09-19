/**
 * CSV writing for exports somebody opens in a spreadsheet.
 *
 * ## The escaping that is not about CSV
 *
 * A field beginning with `=`, `+`, `-`, `@`, tab or carriage return is
 * treated by Excel, LibreOffice and Google Sheets as a **formula**, not text.
 * A partner's display name of `=HYPERLINK("http://evil","Click")`, or a
 * settlement note beginning with `=cmd|...`, becomes something the
 * accountant's machine evaluates when they open the file. It is a real class
 * of attack (CSV injection / formula injection) and the victim is the person
 * least equipped to notice: the finance person who was handed "just a
 * spreadsheet".
 *
 * Prefixing with a single quote is the conventional defence, and it is what
 * spreadsheets themselves use to mean "this is text". The exported value is
 * unchanged for every field that does not start with one of those characters,
 * which is all of them in normal data.
 *
 * Quoting is RFC 4180: wrap when the value contains a comma, quote, newline
 * or leading/trailing space, and double any embedded quote.
 */
const FORMULA_LEADERS = ['=', '+', '-', '@', '\t', '\r'];

export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);

  /*
   * Decided on the original value, before the prefix below is added.
   *
   * Otherwise the prefix hides what it should have preserved: `\tTabbed`
   * becomes `'\tTabbed`, whose first character is no longer whitespace, so a
   * check made afterwards would conclude the value needs no quoting and the
   * leading tab would survive only by luck of the parser. Quoting is about
   * what was stored; the prefix is about how a spreadsheet will treat it.
   */
  const mustQuote =
    text.includes(',') ||
    text.includes('"') ||
    text.includes('\n') ||
    text.includes('\r') ||
    text !== text.trim();

  if (text.length > 0 && FORMULA_LEADERS.includes(text[0]!)) {
    // Neutralised, not stripped: the accountant still sees what was stored,
    // and a negative amount — which legitimately starts with `-` — keeps its
    // sign and its meaning.
    text = `'${text}`;
  }

  return mustQuote ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(values: Array<string | number | null | undefined>): string {
  return values.map(csvField).join(',');
}

/**
 * A whole document, CRLF-terminated.
 *
 * CRLF because RFC 4180 says so and because Excel on Windows — where these
 * files are actually opened — mis-renders a lone LF in some locales.
 */
export function csvDocument(header: string[], rows: Array<Array<string | number | null>>): string {
  return [csvRow(header), ...rows.map(csvRow)].join('\r\n') + '\r\n';
}
