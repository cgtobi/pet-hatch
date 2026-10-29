// Renders the PNG app icons from public/app-icons/icon.svg. Run: npm run icons
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dir = new URL('../public/app-icons/', import.meta.url);
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

// Home Assistant app store: a square icon and a wide logo.
const app = (file) => fileURLToPath(new URL(`../pet_hatch/${file}`, import.meta.url));
await sharp(svg, { density: 300 }).resize(128, 128).png().toFile(app('icon.png'));
const mark = await sharp(svg, { density: 300 }).resize(100, 100).png().toBuffer();
await sharp({ create: { width: 250, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: mark, left: 75, top: 0 }])
  .png()
  .toFile(app('logo.png'));

console.log('icons written');
