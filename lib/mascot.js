'use strict';
// La mascota de Hopdeck: un mono naranja con auriculares. Son 64×64 píxeles con transparencia que se dibujan con medios bloques
// (▀ ▄) al tamaño que quepa. Los píxeles van comprimidos (zlib + base64) para no depender de ningún archivo de imagen.
const zlib = require('zlib');
const { TRUE, R } = require('./style');

const SIZE = 64;
const PIXELS = zlib.inflateSync(Buffer.from(
  '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' +
  'AE0HbYs=', 'base64')); // RGBA, 4 bytes por pixel

/** La misma mascota sin colores, para NO_COLOR o --plain. */
const ASCII = "           .-===========-.\n         .'     /\\/\\      '.\n        /     .------.      \\\n   .-. ||    (o)    (o)     || .-.\n  (   )||       .--.        ||(   )\n   '-' ||      ( .. )       || '-'\n        \\      \\____/      /\n         '._    \\__/    _.'\n            '----------'\n             /|_||_|\\";

/** Color del píxel (r, g, b) de la celda (x, y) de una versión de n×n: promedio de los píxeles que cubre, o null si es transparente. */
function sample(x, y, n) {
  const x0 = Math.floor((x * SIZE) / n), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * SIZE) / n));
  const y0 = Math.floor((y * SIZE) / n), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * SIZE) / n));
  let a = 0, r = 0, g = 0, b = 0, cnt = 0;
  for (let yy = y0; yy < y1 && yy < SIZE; yy++) {
    for (let xx = x0; xx < x1 && xx < SIZE; xx++) {
      const i = (yy * SIZE + xx) * 4, al = PIXELS[i + 3];
      cnt++; a += al; r += PIXELS[i] * al; g += PIXELS[i + 1] * al; b += PIXELS[i + 2] * al;
    }
  }
  if (!cnt || !a || a / cnt < 100) return null; // casi transparente
  return [Math.round(r / a), Math.round(g / a), Math.round(b / a)];
}

const c256 = ([r, g, b]) => { const q = (v) => Math.round((v / 255) * 5); return 16 + 36 * q(r) + 6 * q(g) + q(b); };
const col = (c, bg) => (TRUE ? `\x1b[${bg ? 48 : 38};2;${c[0]};${c[1]};${c[2]}m` : `\x1b[${bg ? 48 : 38};5;${c256(c)}m`);
/** Cada celda son dos píxeles: ▀ con el de arriba de color de letra y el de abajo de fondo. Lo transparente deja ver el fondo del terminal. */
function cell(top, bottom) {
  if (!top && !bottom) return ' ';
  if (top && !bottom) return col(top) + '▀' + R;
  if (!top && bottom) return col(bottom) + '▄' + R;
  return col(top) + col(bottom, true) + '▀' + R;
}

const CACHE = new Map();
/** Filas de texto (n celdas de ancho, n/2 de alto) con la mascota a n×n píxeles. */
function render(n) {
  n = Math.max(2, Math.min(SIZE, n & ~1));
  if (CACHE.has(n)) return CACHE.get(n);
  const rows = [];
  for (let y = 0; y < n; y += 2) {
    let line = '';
    for (let x = 0; x < n; x++) line += cell(sample(x, y, n), sample(x, y + 1, n));
    rows.push(line);
  }
  CACHE.set(n, rows);
  return rows;
}

/** El mayor tamaño que cabe en `maxCols` columnas y `maxRows` filas, o 0 si ni el más pequeño. */
const sizeFor = (maxCols, maxRows) => [48, 40, 32, 24, 16].find((n) => n <= maxCols && n / 2 <= maxRows) || 0;

module.exports = { SIZE, ASCII, render, sizeFor };
