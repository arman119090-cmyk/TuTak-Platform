import { csvDocument, csvField } from './csv';

/**
 * The export an accountant opens in Excel.
 *
 * Most of these are ordinary CSV quoting. The ones that matter are the
 * formula cases: a value beginning `=`, `+`, `-`, `@`, tab or carriage return
 * is *executed* by every mainstream spreadsheet, so a partner who names their
 * business `=HYPERLINK(...)` is writing code that runs on the finance
 * person's machine. The finance person is the one least placed to notice.
 */
describe('csvField', () => {
  it('leaves ordinary text alone', () => {
    expect(csvField('Coffee House')).toBe('Coffee House');
    expect(csvField('15000.0000')).toBe('15000.0000');
  });

  it('quotes a value containing a comma', () => {
    expect(csvField('Petrosyan, Ani')).toBe('"Petrosyan, Ani"');
  });

  it('doubles an embedded quote', () => {
    expect(csvField('He said "yes"')).toBe('"He said ""yes"""');
  });

  it('quotes a value with a newline rather than breaking the row', () => {
    expect(csvField('line one\nline two')).toBe('"line one\nline two"');
  });

  it.each([
    ['=1+1', "'=1+1"],
    ['=HYPERLINK("http://evil","Click")', '"\'=HYPERLINK(""http://evil"",""Click"")"'],
    ['+41', "'+41"],
    ['@SUM(A1:A9)', "'@SUM(A1:A9)"],
    ['\tTabbed', '"\'\tTabbed"'],
  ])('neutralises the formula leader in %s', (input, expected) => {
    expect(csvField(input)).toBe(expected);
  });

  /**
   * A negative amount legitimately starts with `-`. It is still prefixed,
   * because a spreadsheet would evaluate it either way — and the accountant
   * sees the same characters they would have seen, with the sign intact.
   */
  it('keeps a negative amount readable while still neutralising it', () => {
    expect(csvField('-525.0000')).toBe("'-525.0000");
  });

  it('writes an empty cell for a missing value rather than the word null', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });

  it('quotes a value whose spacing would otherwise be lost', () => {
    expect(csvField(' leading')).toBe('" leading"');
  });
});

describe('csvDocument', () => {
  it('writes CRLF rows, as RFC 4180 and Excel both expect', () => {
    const doc = csvDocument(['a', 'b'], [['1', '2']]);
    expect(doc).toBe('a,b\r\n1,2\r\n');
  });

  it('writes a header even when there are no rows', () => {
    // An empty period must produce a file with columns, not an empty file:
    // the accountant needs to see that the export ran and found nothing.
    expect(csvDocument(['a', 'b'], [])).toBe('a,b\r\n');
  });
});
