import { describe, expect, it } from 'vitest';
import { csvToObjects, parseCsv } from '@/lib/admin/csv';

describe('parseCsv', () => {
  it('parses a simple table', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    const rows = parseCsv('sku,name\nA1,"Диван прямой, серый"');
    expect(rows[1]).toEqual(['A1', 'Диван прямой, серый']);
  });

  it('understands escaped quotes', () => {
    const rows = parseCsv('name\n"Кресло ""LOFT"""');
    expect(rows[1]![0]).toBe('Кресло "LOFT"');
  });

  it('accepts semicolons as separators (Excel exports)', () => {
    expect(parseCsv('a;b\n1;2')[1]).toEqual(['1', '2']);
  });

  it('strips a UTF-8 BOM and normalises CRLF', () => {
    const rows = parseCsv('﻿a,b\r\n1,2\r\n');
    expect(rows[0]).toEqual(['a', 'b']);
    expect(rows).toHaveLength(2);
  });

  it('skips blank lines', () => {
    expect(parseCsv('a,b\n\n1,2\n\n')).toHaveLength(2);
  });
});

describe('csvToObjects', () => {
  it('keys the rows by the header', () => {
    const objects = csvToObjects('sku,priceMinor\nSF-1,1000\nSF-2,2000');
    expect(objects).toEqual([
      { sku: 'SF-1', priceMinor: '1000' },
      { sku: 'SF-2', priceMinor: '2000' },
    ]);
  });

  it('returns nothing for an empty file', () => {
    expect(csvToObjects('')).toEqual([]);
  });

  it('fills missing trailing columns with empty strings', () => {
    const objects = csvToObjects('a,b,c\n1,2');
    expect(objects[0]).toEqual({ a: '1', b: '2', c: '' });
  });
});
