/**
 * Post-build step for the static export (out/):
 * replaces Next's generic English 404.html with a branded page that answers
 * in the language of the requested path (/fr/… → French), falling back to
 * the browser language, then English. The static host serves it for any
 * unknown URL. Copy comes from src/i18n/not-found-strings.json.
 */
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const strings = JSON.parse(await readFile(new URL('src/i18n/not-found-strings.json', root), 'utf8'));
const locales = ['hy', 'ru', 'it', 'de', 'fr', 'en'];
const names = { hy: 'Հայերեն', ru: 'Русский', it: 'Italiano', de: 'Deutsch', fr: 'Français', en: 'English' };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0b0a09">
<title>404 — LEVANI ART</title>
<link rel="icon" href="/icon.svg">
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;flex-direction:column;background:#0b0a09;color:#f2ece2;
    font:16px/1.7 system-ui,-apple-system,'Segoe UI',sans-serif}
  header{padding:24px clamp(16px,4vw,64px);border-bottom:1px solid rgb(242 236 226/.12)}
  header a{font:500 20px Georgia,'Times New Roman',serif;letter-spacing:.24em;color:#f2ece2;text-decoration:none}
  main{flex:1;padding:clamp(64px,12vw,160px) clamp(16px,4vw,64px);max-width:1100px}
  .eyebrow{font-size:11px;letter-spacing:.22em;color:#b08d57}
  h1{margin:18px 0 0;font:400 clamp(38px,6vw,84px)/1.05 Georgia,'Times New Roman',serif}
  p.text{max-width:34em;color:#d8d0c3;margin-top:22px}
  a.button{display:inline-flex;align-items:center;min-height:50px;margin-top:36px;padding:0 30px;
    border:1px solid rgb(242 236 226/.24);color:#f2ece2;text-decoration:none;font-size:11.5px;letter-spacing:.2em;text-transform:uppercase}
  a.button:hover{border-color:#b08d57;color:#d6bf93}
  nav{padding:22px clamp(16px,4vw,64px);border-top:1px solid rgb(242 236 226/.12);display:flex;flex-wrap:wrap;gap:10px 28px}
  nav a{color:#a89e90;text-decoration:none;font-size:13px}
</style>
</head>
<body>
<header><a href="/" id="home">LEVANI ART</a></header>
<main>
  <p class="eyebrow">404</p>
  <h1 id="t">${esc(strings.en.title)}</h1>
  <p class="text" id="x">${esc(strings.en.text)}</p>
  <a class="button" id="b" href="/en/collection/">${esc(strings.en.back)}</a>
</main>
<nav>${locales.map((l) => `<a href="/${l}/" lang="${l}">${names[l]}</a>`).join('')}</nav>
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
})();
</script>
</body>
</html>
`;
await writeFile(new URL('out/404.html', root), html);
console.log('export: branded 404.html written');
