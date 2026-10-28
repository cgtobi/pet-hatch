// Renders the PNG app icons from public/icons/icon.svg. Run: npm run icons
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dir = new URL('../public/icons/', import.meta.url);
const svg = await readFile(new URL('icon.svg', dir));

const png = (size, file) => sharp(svg, { density: 300 }).resize(size, size).png().toFile(fileURLToPath(new URL(file, dir)));

await png(192, 'icon-192.png');
await png(512, 'icon-512.png');
await png(180, 'apple-touch-icon.png');

// Maskable: shrink the artwork into the 80% safe zone on a full-bleed sky background.
const inner = await sharp(svg, { density: 300 }).resize(410, 410).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#a9daf5' } })
  .composite([{ input: inner, left: 51, top: 51 }])
  .png()
  .toFile(fileURLToPath(new URL('icon-maskable-512.png', dir)));

console.log('icons written');
