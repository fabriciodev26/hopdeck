'use strict';
// Colores ANSI, tema claro/oscuro y utilidades de ancho visual (emoji / CJK = 2 columnas).
const TRUE = /truecolor|24bit/i.test(process.env.COLORTERM || '') || !!process.env.WT_SESSION;
const NOCOL = !!process.env.NO_COLOR; // https://no-color.org
// tema, por orden de prioridad: HOPDECK_THEME=light|dark → la elección guardada con "hopdeck theme" → COLORFGBG (fondo claro
// termina en ;7 o ;15) → oscuro
const savedTheme = () => { try { const t = JSON.parse(require('fs').readFileSync(process.env.HOPDECK_CONFIG || require('path').join(require('os').homedir(), '.hopdeck.json'), 'utf8')).theme; return t === 'light' || t === 'dark' ? t : ''; } catch { return ''; } };
const THEME_FROM = process.env.HOPDECK_THEME ? 'env' : savedTheme() ? 'config' : 'auto';
const LIGHT = THEME_FROM === 'env' ? process.env.HOPDECK_THEME === 'light' : THEME_FROM === 'config' ? savedTheme() === 'light' : /;(7|15)$/.test(process.env.COLORFGBG || '');
const fg = (r, g, b, n) => (NOCOL ? '' : TRUE ? `\x1b[38;2;${r};${g};${b}m` : `\x1b[38;5;${n}m`);
const bg = (r, g, b, n) => (NOCOL ? '' : TRUE ? `\x1b[48;2;${r};${g};${b}m` : `\x1b[48;5;${n}m`);
const R = '\x1b[0m';
const C = LIGHT ? {
  brand: fg(190, 85, 50, 166), accent: fg(79, 70, 229, 62), text: fg(38, 38, 44, 235), dim: fg(105, 105, 114, 242),
  faint: fg(190, 190, 196, 250), ok: fg(28, 128, 68, 29), warn: fg(168, 104, 16, 130),
  selOn: bg(232, 234, 252, 189), selOff: bg(234, 234, 238, 255), bold: NOCOL ? '' : '\x1b[1m', ital: NOCOL ? '' : '\x1b[3m',
} : {
  brand: fg(217, 119, 87, 173), accent: fg(129, 140, 248, 105), text: fg(232, 230, 227, 253), dim: fg(128, 128, 134, 244),
  faint: fg(78, 78, 84, 239), ok: fg(126, 196, 143, 114), warn: fg(224, 175, 104, 179),
  selOn: bg(38, 40, 64, 236), selOff: bg(34, 34, 36, 235), bold: NOCOL ? '' : '\x1b[1m', ital: NOCOL ? '' : '\x1b[3m',
};

// ancho visual (emoji / CJK = 2 columnas)
function cw(c) {
  if (c < 0x300) return 1;
  if ((c >= 0x300 && c <= 0x36f) || (c >= 0x200b && c <= 0x200f) || c === 0xfe0f) return 0;
  if ((c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff)) return 2;
  return 1;
}
const strW = (s) => { let w = 0; for (const ch of s) w += cw(ch.codePointAt(0)); return w; };

/**
 * Quita de un texto externo (títulos, mensajes, rutas del historial) todo lo que el terminal interpretaría:
 * caracteres de control y secuencias de escape (cambiar el título, escribir en el portapapeles con OSC 52…)
 * y los controles de dirección Unicode que sirven para disfrazar texto.
 */
// eslint-disable-next-line no-control-regex
const clean = (t) => String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '');

/** Ajusta segmentos [[texto, estilo]] a un ancho exacto (si no cabe, corta y termina en …; si sobra, rellena). */
function fit(segs, width, base = '') {
  if (width <= 0) return '';
  segs = segs.map(([t, st]) => [clean(t), st]); // el texto externo nunca llega al terminal con caracteres de control
  let total = 0;
  for (const [t] of segs) total += strW(t);
  const limit = total > width ? width - 1 : width; // se reserva una celda para la …
  let out = '', used = 0, cut = false, lastSt = '';
  for (const [text, st = ''] of segs) {
    let piece = '';
    for (const ch of text) {
      const w = cw(ch.codePointAt(0));
      if (used + w > limit) { cut = true; break; }
      piece += ch; used += w;
    }
    out += base + st + piece + R; lastSt = st;
    if (cut) break;
  }
  if (total > width) { out += base + lastSt + '…' + R; used += 1; }
  if (used < width) out += base + ' '.repeat(width - used) + R;
  return out;
}

module.exports = { TRUE, NOCOL, LIGHT, THEME_FROM, fg, bg, R, C, cw, strW, fit, clean };
