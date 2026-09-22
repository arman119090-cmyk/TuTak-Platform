/**
 * The published Markdown, rendered as a page a browser and an app-store
 * reviewer can read.
 *
 * Deliberately tiny and deliberately not a Markdown library: these documents
 * use headings, paragraphs, bullet lists and tables, and nothing else. A
 * general renderer would bring raw-HTML passthrough with it, and raw HTML in
 * a legal text served under a narrow CSP is a way to smuggle a script into
 * the one page that must never run one. Everything here is escaped first and
 * marked up afterwards, so the only tags in the output are the ones this file
 * writes.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]!);
}

/** `**bold**` is the only inline mark these texts use. */
function inline(value: string): string {
  return escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function tableRow(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

const SEPARATOR = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

export function markdownToHtml(source: string): string {
  const lines = source.split('\n');
  const out: string[] = [];
  let list: string[] | null = null;

  const closeList = () => {
    if (list) {
      out.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`);
      list = null;
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();

    if (line.length === 0) {
      closeList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1]!.length;
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      continue;
    }

    if (line.startsWith('- ')) {
      list ??= [];
      list.push(line.slice(2));
      continue;
    }

    // A table: a header row, a separator, then body rows until the block ends.
    if (line.startsWith('|') && SEPARATOR.test(lines[i + 1]?.trim() ?? '')) {
      closeList();
      const header = tableRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        rows.push(tableRow(lines[i]!.trim()));
        i += 1;
      }
      i -= 1;
      out.push(
        `<table><thead><tr>${header.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead>` +
          `<tbody>${rows
            .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`,
      );
      continue;
    }

    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }

  closeList();
  return out.join('\n');
}

export interface LegalPageParams {
  title: string;
  language: string;
  /** `[{ code, href, current }]` — the languages the text really exists in. */
  languages: Array<{ code: string; label: string; href: string; current: boolean }>;
  bodyHtml: string;
  revision: string;
  contentHash: string;
  isDraft: boolean;
  /** Where the same edition can be downloaded byte for byte. */
  fileHref: string;
  /** Shown under the draft banner and in the footer, already localised. */
  strings: {
    draft: string;
    revision: string;
    checksum: string;
    download: string;
    index: string;
    indexHref: string;
  };
}

/**
 * One self-contained page: no fonts, no scripts, no images, nothing that can
 * be blocked or disappear. That is what lets the response carry
 * `default-src 'none'` and still render.
 */
export function legalPage(params: LegalPageParams): string {
  const switcher = params.languages
    .map((language) =>
      language.current
        ? `<span class="lang current">${escapeHtml(language.label)}</span>`
        : `<a class="lang" href="${escapeHtml(language.href)}">${escapeHtml(language.label)}</a>`,
    )
    .join('');

  return `<!doctype html>
<html lang="${escapeHtml(params.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(params.title)} — TuTak</title>
<style>
:root { color-scheme: light dark; --bg:#ffffff; --fg:#14161c; --muted:#5b6070; --line:#e3e5ec; --accent:#2f5bd8; }
@media (prefers-color-scheme: dark) { :root { --bg:#0e1015; --fg:#eef0f6; --muted:#a2a6b8; --line:#272b36; --accent:#8aa8ff; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
main { max-width: 46rem; margin: 0 auto; padding: 2.5rem 1.15rem 4rem; }
h1 { font-size: clamp(1.5rem, 4.5vw, 2.1rem); line-height:1.2; margin:0 0 1rem; }
h2 { font-size: 1.2rem; margin: 2rem 0 .6rem; }
h3 { font-size: 1.05rem; margin: 1.5rem 0 .5rem; }
p, li { margin: .6rem 0; }
ul { padding-left: 1.2rem; }
a { color: var(--accent); }
nav { display:flex; flex-wrap:wrap; gap:.75rem; align-items:center; margin-bottom:1.5rem; font-size:.9rem; }
.lang { text-decoration:none; border:1px solid var(--line); border-radius:999px; padding:.2rem .7rem; color:var(--accent); }
.lang.current { color:var(--muted); border-color:transparent; background:var(--line); }
.draft { border:1px solid var(--line); border-left:4px solid var(--accent); border-radius:.5rem; padding:.8rem 1rem; margin-bottom:1.5rem; color:var(--muted); }
table { width:100%; border-collapse:collapse; margin:1rem 0; font-size:.93rem; display:block; overflow-x:auto; }
th, td { border:1px solid var(--line); padding:.5rem .6rem; text-align:left; vertical-align:top; }
th { background:var(--line); font-weight:600; }
footer { margin-top:3rem; padding-top:1.2rem; border-top:1px solid var(--line); color:var(--muted); font-size:.85rem; }
footer code { word-break:break-all; }
</style>
</head>
<body>
<main>
<nav><a class="lang" href="${escapeHtml(params.strings.indexHref)}">${escapeHtml(params.strings.index)}</a>${switcher}</nav>
${params.isDraft ? `<div class="draft">${escapeHtml(params.strings.draft)}</div>` : ''}
${params.bodyHtml}
<footer>
<p>${escapeHtml(params.strings.revision.replace('{{revision}}', params.revision))}</p>
<p>${escapeHtml(params.strings.checksum.replace('{{hash}}', ''))}<code>${escapeHtml(params.contentHash)}</code></p>
<p><a href="${escapeHtml(params.fileHref)}">${escapeHtml(params.strings.download)}</a></p>
</footer>
</main>
</body>
</html>
`;
}
