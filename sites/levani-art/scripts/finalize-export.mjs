/**
 * Post-build step for the static export (out/):
 * replaces Next's generic English 404.html with a page in the site's own
 * stylesheet and components that answers in the language of the requested path (/fr/… → French), falling back to
 * the browser language, then English. The static host serves it for any
 * unknown URL. Copy comes from src/i18n/not-found-strings.json.
 */
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const strings = JSON.parse(await readFile(new URL('src/i18n/not-found-strings.json', root), 'utf8'));
const locales = ['hy', 'ru', 'it', 'de', 'fr', 'en'];
const flags = { hy: 'am', ru: 'ru', it: 'it', de: 'de', fr: 'fr', en: 'gb' };
const names = { hy: 'Հայերեն', ru: 'Русский', it: 'Italiano', de: 'Deutsch', fr: 'Français', en: 'English' };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// Reuse the site's own stylesheet (fonts, buttons, header, footer), so the
// 404 page is set in the same type and components as every other page.
const home = await readFile(new URL('out/en/index.html', root), 'utf8');
const styles = [...home.matchAll(/<link rel="stylesheet"[^>]*>/g)].map((m) => m[0]).join('\n');
if (!styles) throw new Error('finalize-export: no stylesheet link found in out/en/index.html');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0b0a09">
<title>404 — LEVANI ART</title>
<link rel="icon" href="/icon.svg">
${styles}
</head>
<body>
<header class="site-header">
  <div class="site-header__inner">
    <a href="/" id="home" class="site-header__brand"><span class="wordmark wordmark--md"><span class="wordmark__name">LEVANI ART</span></span></a>
  </div>
</header>
<main>
  <div class="not-found">
    <p class="eyebrow">404</p>
    <h1 class="page-intro__title" id="t">${esc(strings.en.title)}</h1>
    <p class="section-text" id="x">${esc(strings.en.text)}</p>
    <a class="button button--ghost" id="b" href="/en/collection/">${esc(strings.en.back)}</a>
  </div>
</main>
<footer class="site-footer">
  <div class="site-footer__langs">
    <ul>${locales
      .map(
        (l) =>
          `<li><a href="/${l}/" lang="${l}"><img class="flag" src="/flags/${flags[l]}.svg" width="16" height="12" alt="">${names[l]}</a></li>`,
      )
      .join('')}</ul>
  </div>
</footer>
<script>
(function () {
  var S = ${JSON.stringify(strings)};
  var L = ${JSON.stringify(locales)};
  var loc = location.pathname.split('/')[1];
  if (L.indexOf(loc) < 0) {
    loc = 'en';
    var langs = navigator.languages || [navigator.language || ''];
    for (var i = 0; i < langs.length; i++) {
      var c = String(langs[i]).toLowerCase().split('-')[0];
      if (L.indexOf(c) >= 0) { loc = c; break; }
    }
  }
  var s = S[loc];
  document.documentElement.lang = loc;
  document.getElementById('t').textContent = s.title;
  document.getElementById('x').textContent = s.text;
  var b = document.getElementById('b');
  b.textContent = s.back;
  b.href = '/' + loc + '/collection/';
  document.getElementById('home').href = '/' + loc + '/';
  var cur = document.querySelector('.site-footer__langs a[lang="' + loc + '"]');
  if (cur) cur.setAttribute('aria-current', 'true');
})();
</script>
</body>
</html>
`;
await writeFile(new URL('out/404.html', root), html);
console.log('export: branded 404.html written');
