'use strict';
// Imágenes del historial: extracción de bloques base64, decodificación PNG/JPEG y dibujo con medios bloques (▀).
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const readline = require('readline');
const { TRUE, R } = require('./style');

function collectImages(content, out, depth = 0) {
  if (!Array.isArray(content) || depth > 3) return;
  for (const b of content) {
    if (!b) continue;
    if (b.type === 'image' && b.source && b.source.type === 'base64' && typeof b.source.data === 'string' && b.source.data.length < 24e6) {
      out.push({ media: b.source.media_type || 'image/png', data: b.source.data });
    } else if (Array.isArray(b.content)) collectImages(b.content, out, depth + 1); // imágenes dentro de resultados de herramientas
  }
}


async function extractImages(file, max = 200) {
  const out = []; let bytes = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!/"type"\s*:\s*"image"/.test(line)) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j.type !== 'user' && j.type !== 'assistant') continue; // Claude Code guarda cada imagen otra vez en líneas internas (api-request-blob): se ignoran
      const c = j.message && j.message.content, local = [];
      collectImages(c, local);
      // "[Image #N]" del texto del mensaje ↔ imágenes del mismo mensaje (en orden)
      const nums = [];
      if (j.type === 'user' && Array.isArray(c)) for (const b of c) if (b && b.type === 'text' && typeof b.text === 'string') for (const m of b.text.matchAll(/\[Image #(\d+)\]/g)) nums.push(+m[1]);
      local.forEach((im, i) => { if (nums.length === local.length) im.n = nums[i]; out.push(im); });
      for (const im of local) bytes += im.data.length;
      if (out.length >= max || bytes > 400e6) break;
    }
  } finally { rl.close(); }
  return out;
}


/**
 * Busca en el historial la imagen "[Image #n]" recorriendo todo el archivo (sin el límite de `extractImages`).
 * Solo conserva la que coincide, así que no gasta memoria en el resto. Devuelve null si no existe.
 */
async function findImageByNumber(file, n) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let seen = 0, numbered = false, byNum = null, byIdx = null;
  try {
    for await (const line of rl) {
      if (!/"type"\s*:\s*"image"/.test(line)) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j.type !== 'user' && j.type !== 'assistant') continue; // Claude Code guarda cada imagen otra vez en líneas internas (api-request-blob): se ignoran
      const c = j.message && j.message.content, local = [];
      collectImages(c, local);
      const nums = [];
      if (j.type === 'user' && Array.isArray(c)) for (const b of c) if (b && b.type === 'text' && typeof b.text === 'string') for (const m of b.text.matchAll(/\[Image #(\d+)\]/g)) nums.push(+m[1]);
      local.forEach((im, i) => {
        seen++;
        if (nums.length === local.length) { numbered = true; if (nums[i] === n) byNum = im; }
        if (seen === n) byIdx = im;
      });
      if (byNum) break;
    }
  } finally { rl.close(); }
  return byNum || (numbered ? null : byIdx);
}

/** Decodificador PNG mínimo (sin dependencias): 8/16 bits, paleta, gris, RGB(A); sin entrelazado. */
function decodePNG(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let pos = 8, w = 0, h = 0, depth = 0, ctype = 0, inter = 0, plte = null, trns = null; const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; inter = data[12]; }
    else if (type === 'PLTE') plte = data; else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data); else if (type === 'IEND') break;
  }
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!w || !h || inter !== 0 || !ch || w * h > 40e6 || (ctype === 3 && !plte)) return null;
  const raw = require('zlib').inflateSync(Buffer.concat(idat));
  const bpp = Math.max(1, (ch * depth) >> 3), stride = Math.ceil((w * ch * depth) / 8);
  if (raw.length < (stride + 1) * h) return null;
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride, prev = dst - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0, b = y > 0 ? px[prev + x] : 0, c = x >= bpp && y > 0 ? px[prev + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + x] = v & 255;
    }
  }
  const rgba = new Uint8Array(w * h * 4), max = (1 << Math.min(depth, 8)) - 1;
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    const get = (i) => {
      if (depth === 8) return px[row + i];
      if (depth === 16) return px[row + i * 2];
      const per = 8 / depth; return (px[row + ((i / per) | 0)] >> (8 - depth - (i % per) * depth)) & max;
    };
    for (let x = 0; x < w; x++) {
      let r, g, b, a = 255;
      if (ctype === 2) { r = get(x * 3); g = get(x * 3 + 1); b = get(x * 3 + 2); }
      else if (ctype === 6) { r = get(x * 4); g = get(x * 4 + 1); b = get(x * 4 + 2); a = get(x * 4 + 3); }
      else if (ctype === 3) { const k = get(x); r = plte[k * 3]; g = plte[k * 3 + 1]; b = plte[k * 3 + 2]; if (trns && k < trns.length) a = trns[k]; }
      else { const v = depth < 8 ? Math.round((get(x * (ctype === 4 ? 2 : 1)) * 255) / max) : get(x * (ctype === 4 ? 2 : 1)); r = g = b = v; if (ctype === 4) a = get(x * 2 + 1); }
      const o = (y * w + x) * 4; rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
    }
  }
  return { w, h, rgba };
}

/** Extensión según los primeros bytes (sips la usa para saber qué formato lee). */
function sniffExt(b) {
  if (b.length > 12) {
    if (b.readUInt32BE(0) === 0x89504e47) return 'png';
    if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
    if (b.toString('latin1', 0, 4) === 'GIF8') return 'gif';
    if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
    if (b.toString('latin1', 4, 8) === 'ftyp') return 'heic';
    if (b.readUInt32BE(0) === 0x49492a00 || b.readUInt32BE(0) === 0x4d4d002a) return 'tiff';
  }
  return 'img';
}

/**
 * macOS: `sips` (viene con el sistema) convierte a PNG, y reduce, lo que el decodificador propio no entiende: WebP, GIF, HEIC, TIFF,
 * PNG entrelazado o imágenes enormes. `run` se puede sustituir (pruebas). Devuelve { w, h, rgba } o null.
 */
function decodeViaSips(buf, run = cp.spawnSync) {
  let dir;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hopdeck-sips-'));
    const src = path.join(dir, 'in.' + sniffExt(buf)), dst = path.join(dir, 'out.png');
    fs.writeFileSync(src, buf);
    const r = run('sips', ['-s', 'format', 'png', '-Z', '1600', src, '--out', dst], { stdio: 'ignore', timeout: 8000 });
    return r && r.status === 0 ? decodePNG(fs.readFileSync(dst)) : null;
  } catch { return null; } finally { if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } } }
}

/** PNG (propio) o JPEG (si está jpeg-js); en macOS, lo demás con sips. Devuelve { w, h, rgba } o null. */
function decodeImage(img) {
  const buf = Buffer.from(img.data, 'base64');
  let d = null;
  try {
    if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) d = decodePNG(buf);
    else if (buf[0] === 0xff && buf[1] === 0xd8) {
      let jpeg; try { jpeg = require('jpeg-js'); } catch { jpeg = null; }
      if (jpeg) { const j = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 512 }); d = { w: j.width, h: j.height, rgba: j.data }; }
    }
  } catch { /* formato corrupto o demasiado grande */ }
  return d || (process.platform === 'darwin' ? decodeViaSips(buf) : null);
}

/** Reduce con filtro de caja y compone sobre un fondo oscuro. Devuelve RGB (3 bytes por píxel). */
function scaleBox(src, w, h, tw, th) {
  const out = new Uint8Array(tw * th * 3);
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor((ty * h) / th), y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * h) / th));
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor((tx * w) / tw), x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * w) / tw));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        let i = (y * w + x0) * 4;
        for (let x = x0; x < x1; x++, i += 4) { const a = src[i + 3] / 255; r += src[i] * a + 28 * (1 - a); g += src[i + 1] * a + 28 * (1 - a); b += src[i + 2] * a + 30 * (1 - a); n++; }
      }
      const o = (ty * tw + tx) * 3; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return out;
}

function fitSize(w, h, maxW, maxH2) {
  const k = Math.min(maxW / w, maxH2 / h, 2);
  return { tw: Math.max(1, Math.floor(w * k)), th: Math.max(2, Math.floor(h * k) & ~1) };
}

const c256 = (rgb, o) => { const q = (v) => Math.round((v / 255) * 5); return 16 + 36 * q(rgb[o]) + 6 * q(rgb[o + 1]) + q(rgb[o + 2]); };
/** Cada fila de texto = 2 filas de píxeles: ▀ con color de letra = píxel de arriba y de fondo = píxel de abajo. */
function halfBlocks(rgb, tw, th2) {
  const rows = [];
  for (let y = 0; y < th2; y += 2) {
    let line = '';
    for (let x = 0; x < tw; x++) {
      const t = (y * tw + x) * 3, hasB = y + 1 < th2, b = ((y + 1) * tw + x) * 3;
      line += (TRUE
        ? `\x1b[38;2;${rgb[t]};${rgb[t + 1]};${rgb[t + 2]}` + (hasB ? `;48;2;${rgb[b]};${rgb[b + 1]};${rgb[b + 2]}` : '') + 'm'
        : `\x1b[38;5;${c256(rgb, t)}` + (hasB ? `;48;5;${c256(rgb, b)}` : '') + 'm') + '▀';
    }
    rows.push(line + R);
  }
  return rows;
}

module.exports = { collectImages, extractImages, findImageByNumber, decodePNG, decodeImage, decodeViaSips, sniffExt, scaleBox, fitSize, halfBlocks };
