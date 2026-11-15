'use strict';
// Codificador Sixel: convierte una imagen RGB en la secuencia que dibuja una imagen real (con todos sus píxeles) en terminales
// que la admiten (Windows Terminal 1.22+, iTerm2, WezTerm, foot, mlterm, Konsole…). Sin dependencias.
//
// Formato: DCS "P0;0;0q" + atributos del ráster ("1;1;ancho;alto) + paleta (#n;2;r;g;b, en 0-100) + datos por bandas de
// 6 píxeles de alto (un carácter por columna y color: 63 + máscara de bits), con "!n" para repeticiones, "$" para volver al
// principio de la banda, "-" para la banda siguiente, y ST (ESC \) para terminar.

/**
 * Reduce la imagen a como mucho `maxColors` colores. Si ya tiene pocos colores (capturas de pantalla, interfaces) se conservan
 * exactos; si no, se aplica "median cut" sobre un histograma de 5 bits por canal.
 * Devuelve { palette: [[r,g,b]…], index: Uint8Array(w*h) }.
 */
function quantize(rgb, w, h, maxColors = 256) {
  const n = w * h, index = new Uint8Array(n);
  // 1) ¿hay pocos colores distintos? entonces la paleta es exacta
  const exact = new Map();
  for (let i = 0; i < n && exact.size <= maxColors; i++) {
    const k = (rgb[i * 3] << 16) | (rgb[i * 3 + 1] << 8) | rgb[i * 3 + 2];
    if (!exact.has(k)) exact.set(k, exact.size);
  }
  if (exact.size <= maxColors) {
    for (let i = 0; i < n; i++) index[i] = exact.get((rgb[i * 3] << 16) | (rgb[i * 3 + 1] << 8) | rgb[i * 3 + 2]);
    const palette = []; for (const [k] of exact) palette.push([(k >> 16) & 255, (k >> 8) & 255, k & 255]);
    return { palette, index };
  }
  // 2) histograma de 5 bits por canal + median cut
  const hist = new Uint32Array(32768);
  for (let i = 0; i < n; i++) hist[((rgb[i * 3] >> 3) << 10) | ((rgb[i * 3 + 1] >> 3) << 5) | (rgb[i * 3 + 2] >> 3)]++;
  const bins = [];
  for (let b = 0; b < 32768; b++) if (hist[b]) bins.push({ r: ((b >> 10) << 3) + 4, g: (((b >> 5) & 31) << 3) + 4, b: ((b & 31) << 3) + 4, c: hist[b], id: b });
  let boxes = [bins];
  while (boxes.length < maxColors) {
    // se parte la caja con más rango (ponderado por su número de píxeles) por su canal más largo, en la mediana
    let bi = -1, best = -1, bch = 'r';
    boxes.forEach((bx, i) => {
      if (bx.length < 2) return;
      let lo = { r: 255, g: 255, b: 255 }, hi = { r: 0, g: 0, b: 0 }, cnt = 0;
      for (const p of bx) { cnt += p.c; for (const ch of ['r', 'g', 'b']) { if (p[ch] < lo[ch]) lo[ch] = p[ch]; if (p[ch] > hi[ch]) hi[ch] = p[ch]; } }
      for (const ch of ['r', 'g', 'b']) { const score = (hi[ch] - lo[ch]) * Math.sqrt(cnt); if (score > best) { best = score; bi = i; bch = ch; } }
    });
    if (bi < 0) break;
    const bx = boxes[bi].slice().sort((p, q) => p[bch] - q[bch]);
    const half = bx.reduce((s, p) => s + p.c, 0) / 2; let acc = 0, cut = 1;
    for (let i = 0; i < bx.length - 1; i++) { acc += bx[i].c; cut = i + 1; if (acc >= half) break; }
    boxes.splice(bi, 1, bx.slice(0, cut), bx.slice(cut));
  }
  const palette = boxes.map((bx) => { let r = 0, g = 0, b = 0, c = 0; for (const p of bx) { r += p.r * p.c; g += p.g * p.c; b += p.b * p.c; c += p.c; } return [Math.round(r / c), Math.round(g / c), Math.round(b / c)]; });
  const map = new Int16Array(32768).fill(-1); // cada color de 5 bits → su caja
  boxes.forEach((bx, i) => { for (const p of bx) map[p.id] = i; });
  for (let i = 0; i < n; i++) index[i] = map[((rgb[i * 3] >> 3) << 10) | ((rgb[i * 3 + 1] >> 3) << 5) | (rgb[i * 3 + 2] >> 3)];
  return { palette, index };
}

/** Una fila de máscaras de una banda como cadena sixel, con repeticiones "!n" y sin el relleno vacío del final. */
function rle(masks) {
  let end = masks.length; while (end > 0 && masks[end - 1] === 0) end--; // los "?" finales no hacen falta
  let out = '';
  for (let x = 0; x < end;) {
    let run = 1; while (x + run < end && masks[x + run] === masks[x]) run++;
    const ch = String.fromCharCode(63 + masks[x]);
    out += run > 3 ? `!${run}${ch}` : ch.repeat(run);
    x += run;
  }
  return out;
}

/** Imagen RGB (3 bytes por píxel) → secuencia Sixel completa lista para escribir en el terminal. */
function encodeSixel(rgb, w, h, { maxColors = 256 } = {}) {
  const { palette, index } = quantize(rgb, w, h, maxColors);
  let out = `\x1bP0;0;0q"1;1;${w};${h}`;
  palette.forEach(([r, g, b], i) => { out += `#${i};2;${Math.round((r * 100) / 255)};${Math.round((g * 100) / 255)};${Math.round((b * 100) / 255)}`; });
  for (let y0 = 0; y0 < h; y0 += 6) {
    const bandH = Math.min(6, h - y0), cols = new Map();
    for (let dy = 0; dy < bandH; dy++) {
      const row = (y0 + dy) * w;
      for (let x = 0; x < w; x++) {
        const c = index[row + x]; let a = cols.get(c);
        if (!a) { a = new Uint8Array(w); cols.set(c, a); }
        a[x] |= 1 << dy;
      }
    }
    let first = true;
    for (const [c, a] of cols) { out += (first ? '' : '$') + '#' + c + rle(a); first = false; }
    if (y0 + 6 < h) out += '-';
  }
  return out + '\x1b\\';
}

module.exports = { encodeSixel, quantize };
