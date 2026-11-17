'use strict';
// Texto: nombres de carpeta, rutas cortas, búsqueda difusa y ajuste de línea.
const os = require('os');
const { strW } = require('./style');

const baseName = (p) => p.split(/[\\/]/).filter(Boolean).pop() || p;
const tidy = (s) => s.replace(/\s+/g, ' ').trim();
const home = os.homedir();
const shortPath = (p) => (p.startsWith(home) ? '~' + p.slice(home.length) : p);

/**
 * Minúsculas y sin acentos («Visión» → «vision», «ñ» → «n»). Cada letra se pliega por separado, así el resultado mide lo mismo
 * que el original y una posición encontrada en uno vale para el otro (hace falta para resaltar las coincidencias).
 */
function fold(s) {
  let o = '';
  for (const ch of String(s)) {
    const b = Array.from(ch.normalize('NFD'))[0] || ch, l = b.toLowerCase();
    o += l.length === b.length ? l : b;
  }
  return o;
}
/** Palabras de una búsqueda, ya plegadas. */
const queryWords = (q) => fold(q).split(/\s+/).filter(Boolean);
/** ¿Aparecen todas las palabras (en cualquier orden) en el texto ya plegado? */
const matchWords = (ws, folded) => ws.every((w) => folded.includes(w));

/** Coincidencia difusa: cada palabra de la consulta debe aparecer como subsecuencia. -1 si no coincide. */
function fuzzy(q, text) {
  const t = fold(text); let total = 0;
  for (const term of queryWords(q)) {
    let pos = -1, run = 0, score = 0;
    const sub = t.indexOf(term);
    if (sub >= 0) { total += 10 + term.length * 3 - Math.min(sub, 30) / 3; continue; }
    for (const ch of term) {
      const i = t.indexOf(ch, pos + 1);
      if (i < 0) return -1;
      run = i === pos + 1 ? run + 1 : 0; score += 1 + run; pos = i;
    }
    total += score;
  }
  return total;
}

function wrapText(text, width) {
  const out = []; let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word;
    while (strW(w) > width) { // palabra más larga que la línea
      if (line) { out.push(line); line = ''; }
      let piece = ''; for (const ch of w) { if (strW(piece + ch) > width) break; piece += ch; }
      out.push(piece); w = w.slice(piece.length);
    }
    if (!line) line = w; else if (strW(line + ' ' + w) <= width) line += ' ' + w; else { out.push(line); line = w; }
  }
  if (line) out.push(line);
  return out;
}

module.exports = { baseName, tidy, home, shortPath, fold, queryWords, matchWords, fuzzy, wrapText };
