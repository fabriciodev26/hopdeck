'use strict';
// La mascota de Hopdeck: un sapo naranja con auriculares. Son 64×64 píxeles con transparencia que se dibujan con medios bloques
// (▀ ▄) al tamaño que quepa. Los píxeles van comprimidos (zlib + base64) para no depender de ningún archivo de imagen.
const zlib = require('zlib');
const { TRUE, R } = require('./style');

const SIZE = 64;
const PIXELS = zlib.inflateSync(Buffer.from(
  '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', 'base64')); // RGBA, 4 bytes por píxel

/** La misma mascota sin colores, para NO_COLOR o --plain. */
const ASCII = "           .-============-.\n        .-'   _        _   '-.\n       /     (o)      (o)     \\\\\n  .---|---.      ..      .---|---.\n  |  >_   |    \\____/    |       |\n  '---|---'              '---|---'\n       \\     .------.      /\n        '._  \\____/   _.-'\n           '----------'\n             /_||_\\\\";

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
