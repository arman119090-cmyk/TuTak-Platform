import { markdownToHtml } from './legal-html';

/**
 * The renderer is small enough to read, which is the point: it turns a legal
 * text into markup and must not be able to turn anything into a script. Both
 * halves are pinned here — the structures the documents actually use, and the
 * fact that text arriving from the Markdown is escaped, not trusted.
 */
describe('rendering a legal document', () => {
  it('renders headings, paragraphs and bullet lists', () => {
    const html = markdownToHtml('# Условия\n\nПервый абзац.\n\n## 1 Раздел\n\n- один\n- два\n');

    expect(html).toContain('<h1>Условия</h1>');
    expect(html).toContain('<p>Первый абзац.</p>');
    expect(html).toContain('<h2>1 Раздел</h2>');
    expect(html).toContain('<ul><li>один</li><li>два</li></ul>');
  });

  it('renders the tables the privacy policy is built from', () => {
    const html = markdownToHtml(
      ['| Получатель | Страна |', '| --- | --- |', '| Railway Corp. | США |', '| Viva | Армения |', ''].join('\n'),
    );

    expect(html).toContain('<th>Получатель</th>');
    expect(html).toContain('<td>Railway Corp.</td>');
    expect(html).toContain('<td>Армения</td>');
    // The separator row is structure, never a row of its own.
    expect(html).not.toContain('<td>---</td>');
  });

  it('keeps a table separate from the paragraph that follows it', () => {
    const html = markdownToHtml(['| A |', '| --- |', '| 1 |', '', 'После таблицы.'].join('\n'));

    expect(html).toContain('</table>');
    expect(html).toContain('<p>После таблицы.</p>');
  });

  it('escapes the text instead of trusting it', () => {
    const html = markdownToHtml('Условие <script>alert(1)</script> и знак & в тексте.\n');

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('escapes inside a table cell too, where a reader would not look', () => {
    const html = markdownToHtml(['| Поле |', '| --- |', '| <img src=x onerror=1> |'].join('\n'));

    expect(html).not.toMatch(/<img/);
    expect(html).toContain('&lt;img');
  });

  it('marks bold and leaves the asterisks out of the text', () => {
    expect(markdownToHtml('Это **важно**.\n')).toContain('<strong>важно</strong>');
  });
});
