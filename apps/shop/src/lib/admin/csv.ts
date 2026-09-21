/**
 * Minimal RFC-4180 CSV reader for the bulk product import.
 *
 * Handles quoted fields, escaped quotes ("") and newlines inside quotes, which
 * is exactly what a spreadsheet export produces. Anything more exotic than that
 * belongs in a real ETL, not in an import form.
 */
export const parseCsv = (input: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const text = input.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',' || char === ';') {
      row.push(field.trim());
      field = '';
    } else if (char === '\n') {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((cell) => cell.length > 0));
};

/** Turns a CSV table with a header row into objects keyed by column name. */
export const csvToObjects = (input: string): Record<string, string>[] => {
  const rows = parseCsv(input);
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((row) =>
    Object.fromEntries(header.map((column, index) => [column.trim(), row[index] ?? ''])),
  );
};
