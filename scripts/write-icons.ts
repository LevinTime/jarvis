import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { deflateSync, crc32 } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "public");

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

function png(size: number, pixels: Uint8Array): Buffer {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * size * 4, size * 4).copy(raw, y * stride + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function rounded(x: number, y: number, size: number, radius: number): boolean {
  const inset = radius;
  const left = x < inset ? inset - x : x > size - inset ? x - (size - inset) : 0;
  const top = y < inset ? inset - y : y > size - inset ? y - (size - inset) : 0;
  return left * left + top * top <= radius * radius;
}

function paint(size: number, maskable: boolean): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const pad = maskable ? size * 0.18 : 0;
  const radius = maskable ? 0 : size * 0.22;
  const cx = size / 2;
  const cy = size * 0.46;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inside = maskable || rounded(x, y, size, radius);
      if (!inside) {
        continue;
      }
      const dx = (x - cx) / size;
      const dy = (y - cy) / size;
      const glow = Math.exp(-(dx * dx + dy * dy) * 18);
      const bulb = dx * dx + (dy + 0.02) * (dy + 0.02) < 0.012;
      const shade = Math.abs(dx) < 0.09 - dy * 0.15 && dy > -0.08 && dy < 0.06;
      const stand = Math.abs(dx) < 0.012 && dy > 0.08 && dy < 0.22;
      const base = Math.abs(dx) < 0.07 && dy > 0.2 && dy < 0.24;
      const inIcon = x > pad && x < size - pad && y > pad && y < size - pad;
      let r = 22;
      let g = 18;
      let b = 14;
      if (inIcon && glow > 0.05) {
        r = Math.min(255, r + glow * 180);
        g = Math.min(255, g + glow * 90);
        b = Math.min(255, b + glow * 30);
      }
      if (inIcon && (bulb || shade)) {
        r = 255;
        g = 214;
        b = 160;
      }
      if (inIcon && (stand || base)) {
        r = 240;
        g = 163;
        b = 90;
      }
      const index = (y * size + x) * 4;
      pixels[index] = r;
      pixels[index + 1] = g;
      pixels[index + 2] = b;
      pixels[index + 3] = 255;
    }
  }
  return pixels;
}

await mkdir(root, { recursive: true });
await writeFile(path.join(root, "icon-192.png"), png(192, paint(192, false)));
await writeFile(path.join(root, "icon-512.png"), png(512, paint(512, false)));
await writeFile(path.join(root, "icon-maskable-512.png"), png(512, paint(512, true)));
await writeFile(path.join(root, "apple-touch-icon.png"), png(180, paint(180, true)));
console.log("icons written");
