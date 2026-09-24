/**
 * Serves out/ the way a static CDN host does, for local preview and e2e:
 *   /x/        → out/x/index.html
 *   /x         → 301 to /x/ when out/x/ is a directory
 *   /file.ext  → the file
 *   anything else → out/404.html with status 404
 * Usage: node scripts/serve-static.mjs [-p 3100]   (or PORT=…)
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../out/', import.meta.url).pathname;
const argPort = process.argv.indexOf('-p');
const PORT = Number(argPort > 0 ? process.argv[argPort + 1] : process.env.PORT || 3000);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

const isFile = (p) => stat(p).then((s) => s.isFile(), () => false);
const isDir = (p) => stat(p).then((s) => s.isDirectory(), () => false);

function send(res, status, file) {
  res.writeHead(status, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    path = '/';
  }
  const abs = join(ROOT, normalize(path));
  if (!abs.startsWith(ROOT.slice(0, -1))) return send(res, 404, join(ROOT, '404.html'));
  if (await isFile(abs)) return send(res, 200, abs);
  if (await isDir(abs)) {
    if (!path.endsWith('/')) {
      res.writeHead(301, { location: `${path}/${url.search}` });
      return res.end();
    }
    if (await isFile(join(abs, 'index.html'))) return send(res, 200, join(abs, 'index.html'));
  }
  send(res, 404, join(ROOT, '404.html'));
}).listen(PORT, () => console.log(`static: http://localhost:${PORT} (out/)`));
