// PNG-версии из SVG, сгенерированных scripts/make-brand.py.
import sharp from 'sharp';
const b = (p) => new URL(`./.brand/${p}`, import.meta.url).pathname;
const pub = (p) => new URL(`../public/${p}`, import.meta.url).pathname;
await sharp(b('og.svg')).png().toFile(pub('og.png'));
await sharp(b('apple-touch-icon.svg')).png().toFile(pub('apple-touch-icon.png'));
await sharp(pub('favicon.svg'), { density: 300 }).resize(32, 32).png().toFile(pub('favicon-32.png'));
await sharp(b('logo-square.svg')).png().toFile(pub('logo.png'));
console.log('ok');
