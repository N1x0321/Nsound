// Genera los recursos PWA del modo experimental (iconos, pantallas de arranque y manifest) sin dependencias: PNG con zlib de Node.
import { inflateSync, deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BG = [18, 18, 20];                       // #121214, igual que el fondo de la app

const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** Lee un PNG RGBA de 8 bits sin entrelazar (el logo de la app). */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('No es un PNG');
  let w = 0, h = 0; const idat = [];
  for (let p = 8; p < buf.length;) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error('Solo PNG RGBA de 8 bits sin entrelazar'); }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), bpp = 4, stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), dst = out.subarray(y * stride, (y + 1) * stride), prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? dst[i - bpp] : 0, b = prev ? prev[i] : 0, c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      dst[i] = v & 255;
    }
  }
  return { w, h, data: out };
}

export function encodePng(w, h, rgba) {
  const stride = w * 4, raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Escala con interpolación bilineal (el logo es de 96 px y los iconos de iOS piden 180 o más). */
export function scale(img, nw, nh) {
  const out = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const fy = Math.min(img.h - 1, Math.max(0, ((y + 0.5) * img.h) / nh - 0.5)), y0 = Math.floor(fy), y1 = Math.min(img.h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < nw; x++) {
      const fx = Math.min(img.w - 1, Math.max(0, ((x + 0.5) * img.w) / nw - 0.5)), x0 = Math.floor(fx), x1 = Math.min(img.w - 1, x0 + 1), tx = fx - x0;
      for (let c = 0; c < 4; c++) {
        const g = (xx, yy) => img.data[(yy * img.w + xx) * 4 + c];
        const v = (g(x0, y0) * (1 - tx) + g(x1, y0) * tx) * (1 - ty) + (g(x0, y1) * (1 - tx) + g(x1, y1) * tx) * ty;
        out[(y * nw + x) * 4 + c] = Math.round(v);
      }
    }
  }
  return { w: nw, h: nh, data: out };
}

/** Pone el logo (con transparencia) sobre el fondo. Los iconos de iOS no admiten transparencia: se rellenan con el color de la app. */
export function onBackground(img, w, h, logo, lx, ly) {
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { out[i * 4] = BG[0]; out[i * 4 + 1] = BG[1]; out[i * 4 + 2] = BG[2]; out[i * 4 + 3] = 255; }
  for (let y = 0; y < logo.h; y++) for (let x = 0; x < logo.w; x++) {
    const px = lx + x, py = ly + y; if (px < 0 || py < 0 || px >= w || py >= h) continue;
    const s = (y * logo.w + x) * 4, d = (py * w + px) * 4, a = logo.data[s + 3] / 255;
    for (let c = 0; c < 3; c++) out[d + c] = Math.round(logo.data[s + c] * a + out[d + c] * (1 - a));
  }
  return out;
}

export const SPLASH_SIZES = [[430, 932, 3], [393, 852, 3], [390, 844, 3], [375, 812, 3], [414, 896, 3], [414, 896, 2], [414, 736, 3], [375, 667, 2],
  [768, 1024, 2], [820, 1180, 2], [834, 1194, 2], [1024, 1366, 2]];

/** Escribe dist/experimental/{icons,splash,manifest.webmanifest}. Devuelve la lista de archivos. */
export function generateExperimentalAssets(dist, logoBuf) {
  const logo = decodePng(logoBuf), files = [];
  const put = (rel, data) => { const p = join(dist, 'experimental', rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, data); files.push('experimental/' + rel); };
  for (const s of [180, 192, 512]) {
    const inner = scale(logo, Math.round(s * 0.78), Math.round(s * 0.78)), off = Math.round((s - inner.w) / 2);
    put(`icons/icon-${s}.png`, encodePng(s, s, onBackground(null, s, s, inner, off, off)));
  }
  for (const [cw, ch, r] of SPLASH_SIZES) {
    const w = cw * r, h = ch * r, size = Math.round(Math.min(w, h) * 0.28), inner = scale(logo, size, size);
    put(`splash/splash-${w}x${h}.png`, encodePng(w, h, onBackground(null, w, h, inner, Math.round((w - size) / 2), Math.round((h - size) / 2))));
  }
  put('manifest.webmanifest', JSON.stringify({
    name: 'Nsound', short_name: 'Nsound', start_url: './', scope: './', display: 'standalone', orientation: 'any',
    background_color: '#121214', theme_color: '#121214', lang: 'es',
    icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }],
  }, null, 2) + '\n');
  return files;
}
