// Erzeugt die PNG-Icons (Bierkrug auf dunklem Grund) ohne Abhängigkeiten.
// Ausführen mit: node tools/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = buf => { let c = ~0; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return ~c >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function png(size, rgb) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Szene in Einheitskoordinaten (0..1), Farbe pro Punkt
const BG = [15, 17, 21], BEER = [245, 165, 36], FOAM = [250, 246, 235], GLASS = [210, 214, 222];
const roundRect = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.max(x0 + r, Math.min(x, x1 - r)), cy = Math.max(y0 + r, Math.min(y, y1 - r));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
function color(x, y) {
  // Henkel: Ring rechts
  const hx = x - 0.66, hy = y - 0.56, hd = Math.hypot(hx / 0.9, hy);
  if (x > 0.64 && hd > 0.1 && hd < 0.16) return GLASS;
  // Schaum: drei Kreise oben
  if ([[0.36, 0.33, 0.09], [0.47, 0.3, 0.1], [0.58, 0.33, 0.09]].some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 < r * r)) return FOAM;
  if (roundRect(x, y, 0.28, 0.33, 0.66, 0.4, 0.02)) return FOAM;
  // Krug
  if (roundRect(x, y, 0.28, 0.33, 0.66, 0.78, 0.05)) {
    if (x > 0.35 && x < 0.39 && y > 0.45 && y < 0.7) return [255, 205, 120]; // Glanz
    return BEER;
  }
  return BG;
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
for (const size of [180, 192, 512]) {
  const ss = 4, rgb = Buffer.alloc(size * size * 3);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const acc = [0, 0, 0];
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const c = color((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
      acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
    }
    const i = (py * size + px) * 3;
    for (let k = 0; k < 3; k++) rgb[i + k] = Math.round(acc[k] / (ss * ss));
  }
  writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), png(size, rgb));
}
console.log('Icons erzeugt');
