'use strict';
// Convierte el contenido de un terminal de @xterm/headless en una imagen SVG (para las capturas del README).
// Los bloques y líneas de dibujo se pintan como figuras, así que se ven nítidos con cualquier fuente.

const BASE16 = ['#1e1e1e', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
  '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff'];
function palette(n) {
  if (n < 16) return BASE16[n];
  if (n < 232) { const k = n - 16, q = [0, 95, 135, 175, 215, 255]; return rgb(q[Math.floor(k / 36)], q[Math.floor(k / 6) % 6], q[k % 6]); }
  const g = 8 + (n - 232) * 10; return rgb(g, g, g);
}
const rgb = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// segmentos de las líneas de dibujo: arriba, abajo, izquierda, derecha
const LINES = { '│': 'ud', '─': 'lr', '╭': 'dr', '╮': 'dl', '╰': 'ur', '╯': 'ul', '├': 'udr', '┤': 'udl', '┬': 'lrd', '┴': 'lru', '┼': 'udlr' };

function termToSvg(term, opts = {}) {
  const { cellW = 9, cellH = 19, font = 15, pad = 16, bar = 36, title = '', bg = '#1c1c1e', fg = '#e8e6e3' } = opts;
  const cols = term.cols, rows = term.rows, buf = term.buffer.active, cell = buf.getNullCell();
  const W = cols * cellW + pad * 2, H = rows * cellH + pad + bar;
  const colorOf = (c, isFg) => {
    const rgbM = isFg ? c.isFgRGB() : c.isBgRGB(), palM = isFg ? c.isFgPalette() : c.isBgPalette(), v = isFg ? c.getFgColor() : c.getBgColor();
    if (rgbM) return rgb((v >> 16) & 255, (v >> 8) & 255, v & 255);
    if (palM) return palette(v);
    return null;
  };
  const rects = [], shapes = [], texts = [];
  for (let y = 0; y < rows; y++) {
    const line = buf.getLine(buf.viewportY + y); if (!line) continue;
    const yy = bar + y * cellH;
    let run = null;
    const flush = () => { if (run) { texts.push(`<text x="${run.xs.join(' ')}" y="${yy + cellH - 5}" fill="${run.fill}"${run.bold ? ' font-weight="bold"' : ''}${run.dim ? ' opacity=".6"' : ''}${run.ital ? ' font-style="italic"' : ''} xml:space="preserve">${esc(run.chars)}</text>`); run = null; } };
    for (let x = 0; x < cols; x++) {
      const c = line.getCell(x, cell); if (!c) break;
      const w = c.getWidth(); if (w === 0) continue;
      const ch = c.getChars() || ' ';
      let f = colorOf(c, true), b = colorOf(c, false);
      if (c.isInverse()) { const t = f; f = b || bg; b = t || fg; }
      const xx = pad + x * cellW;
      if (b && b !== bg) rects.push(`<rect x="${xx}" y="${yy}" width="${cellW * w}" height="${cellH}" fill="${b}"/>`);
      const fill = f || fg;
      if (ch === ' ' || c.isInvisible()) { flush(); continue; }
      if (ch === '▀') { flush(); shapes.push(`<rect x="${xx}" y="${yy}" width="${cellW}" height="${cellH / 2}" fill="${fill}"/>`); continue; }
      if (ch === '▌') { flush(); shapes.push(`<rect x="${xx}" y="${yy}" width="${cellW / 2}" height="${cellH}" fill="${fill}"/>`); continue; }
      if (ch === '▏') { flush(); shapes.push(`<rect x="${xx}" y="${yy + 2}" width="1.6" height="${cellH - 4}" fill="${fill}"/>`); continue; }
      if (LINES[ch]) {
        flush(); const s = LINES[ch], cx = xx + cellW / 2, cy = yy + cellH / 2, t = 1.2;
        if (s.includes('u')) shapes.push(`<rect x="${cx - t / 2}" y="${yy}" width="${t}" height="${cellH / 2 + t / 2}" fill="${fill}"/>`);
        if (s.includes('d')) shapes.push(`<rect x="${cx - t / 2}" y="${cy - t / 2}" width="${t}" height="${cellH / 2 + t / 2}" fill="${fill}"/>`);
        if (s.includes('l')) shapes.push(`<rect x="${xx}" y="${cy - t / 2}" width="${cellW / 2 + t / 2}" height="${t}" fill="${fill}"/>`);
        if (s.includes('r')) shapes.push(`<rect x="${cx - t / 2}" y="${cy - t / 2}" width="${cellW / 2 + t / 2}" height="${t}" fill="${fill}"/>`);
        continue;
      }
      const bold = c.isBold(), dim = c.isDim(), ital = c.isItalic();
      if (run && run.fill === fill && run.bold === bold && run.dim === dim && run.ital === ital) { run.xs.push(xx); run.chars += ch; }
      else { flush(); run = { xs: [xx], chars: ch, fill, bold, dim, ital }; }
    }
    flush();
  }
  const dots = [['#ff5f57', 20], ['#febc2e', 40], ['#28c840', 60]].map(([f, x]) => `<circle cx="${x}" cy="${bar / 2}" r="6" fill="${f}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<rect width="${W}" height="${H}" rx="10" fill="${bg}"/>
<rect width="${W}" height="${bar}" rx="10" fill="#2a2a2d"/><rect y="${bar - 10}" width="${W}" height="10" fill="#2a2a2d"/>
${dots}
<text x="${W / 2}" y="${bar / 2 + 5}" fill="#8a8a8f" font-size="13" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">${esc(title)}</text>
<g font-family="'Cascadia Mono', 'SFMono-Regular', Consolas, 'DejaVu Sans Mono', 'Liberation Mono', Menlo, monospace" font-size="${font}">
${rects.join('\n')}
${shapes.join('\n')}
${texts.join('\n')}
</g>
</svg>
`;
}

module.exports = { termToSvg };
