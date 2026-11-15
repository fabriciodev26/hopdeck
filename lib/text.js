'use strict';
// Texto: nombres de carpeta, rutas cortas, búsqueda difusa y ajuste de línea.
const os = require('os');
const { strW } = require('./style');

const baseName = (p) => p.split(/[\\/]/).filter(Boolean).pop() || p;
const tidy = (s) => s.replace(/\s+/g, ' ').trim();
const home = os.homedir();
const shortPath = (p) => (p.startsWith(home) ? '~' + p.slice(home.length) : p);

/** Coincidencia difusa: cada palabra de la consulta debe aparecer como subsecuencia. -1 si no coincide. */
function fuzzy(q, text) {
  const t = text.toLowerCase(); let total = 0;
  for (const term of q.toLowerCase().split(/\s+/).filter(Boolean)) {
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

module.exports = { baseName, tidy, home, shortPath, fuzzy, wrapText };
