// Генерирует ВРЕМЕННЫЕ изображения-заглушки (плоские тона + тонкие линии)
// в src/assets/photos/placeholder-*.jpg. Это не фото и не сток: на них нет
// чужих прав. Каждую заглушку заменить реальным фото заказчика — см. README.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const OUT = new URL('../src/assets/photos/', import.meta.url);
await mkdir(OUT, { recursive: true });

// Абстрактный фасад: сетка проёмов тонкими линиями.
function facade({ w, h, bg, line, cols, rows, inset, seed }) {
  let rnd = seed;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const bx = w * inset, by = h * (inset + 0.12), bw = w * (1 - inset * 2), bh = h * (1 - inset - 0.12);
  const cw = bw / cols, rh = bh / rows;
  let rects = '';
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const pad = Math.min(cw, rh) * (0.18 + rand() * 0.06);
      rects += `<rect x="${bx + c * cw + pad}" y="${by + r * rh + pad}" width="${cw - pad * 2}" height="${rh - pad * 2}" fill="none" stroke="${line}" stroke-width="2"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="100%" height="100%" fill="${bg}"/>
  <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="none" stroke="${line}" stroke-width="3"/>
  <line x1="0" y1="${h - 2}" x2="${w}" y2="${h - 2}" stroke="${line}" stroke-width="3"/>
  ${rects}
</svg>`;
}

const items = [
  { name: 'hero', w: 2400, h: 1500, bg: '#2A2926', line: '#3D3B36', cols: 9, rows: 5, inset: 0.12 },
  { name: 'dir-residential', w: 1200, h: 1500, bg: '#CFC7BA', line: '#B8AF9F', cols: 3, rows: 5, inset: 0.14 },
  { name: 'dir-commercial', w: 1200, h: 1500, bg: '#BDB4A6', line: '#A79E8F', cols: 5, rows: 3, inset: 0.1 },
  { name: 'dir-renovation', w: 1200, h: 1500, bg: '#D9D2C6', line: '#C3BAAB', cols: 2, rows: 3, inset: 0.18 },
  { name: 'dir-infrastructure', w: 1200, h: 1500, bg: '#A8A195', line: '#948D80', cols: 6, rows: 1, inset: 0.08 },
  { name: 'about', w: 2000, h: 1400, bg: '#3A3833', line: '#4D4A43', cols: 6, rows: 4, inset: 0.12 },
  { name: 'project-1', w: 2400, h: 1600, bg: '#C9C1B3', line: '#B3AA9A', cols: 8, rows: 6, inset: 0.1 },
  { name: 'project-2', w: 1600, h: 1200, bg: '#B5AC9E', line: '#A09788', cols: 5, rows: 3, inset: 0.12 },
  { name: 'project-3', w: 1600, h: 1200, bg: '#D4CDC1', line: '#BEB5A6', cols: 3, rows: 2, inset: 0.16 },
];

let seed = 7;
for (const it of items) {
  const svg = facade({ ...it, seed: (seed += 101) });
  await sharp(Buffer.from(svg)).jpeg({ quality: 80, mozjpeg: true }).toFile(new URL(`placeholder-${it.name}.jpg`, OUT).pathname);
  console.log('ok', it.name);
}
