import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const out = join(root, 'public', 'og-image.png');

const W = 1200;
const H = 630;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="100%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#1a1625"/>
      <stop offset="45%" stop-color="#241a30"/>
      <stop offset="100%" stop-color="#7a2048"/>
    </linearGradient>
    <radialGradient id="glow" cx="12%" cy="88%" r="55%">
      <stop offset="0%" stop-color="#9b2d5c" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#1a1625" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  <text x="56" y="84"
    font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="40"
    fill="#fff" letter-spacing="-0.5">eclipse</text>

  <g transform="translate(${W / 2}, 255)" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="-54" y="-78" width="108" height="148" rx="14"/>
    <rect x="-42" y="-64" width="84" height="30" rx="5"/>
    <circle cx="-30" cy="-8" r="9"/>
    <circle cx="0" cy="-8" r="9"/>
    <circle cx="30" cy="-8" r="9"/>
    <circle cx="-30" cy="22" r="9"/>
    <circle cx="0" cy="22" r="9"/>
    <circle cx="30" cy="22" r="9"/>
    <circle cx="-30" cy="52" r="9"/>
    <circle cx="0" cy="52" r="9"/>
    <circle cx="30" cy="52" r="9"/>
  </g>

  <text x="${W / 2}" y="518" text-anchor="middle"
    font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="64"
    fill="#fff" letter-spacing="-1.2">AB test Calculator</text>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(out);

console.log(`Wrote ${out} (${W}x${H})`);
