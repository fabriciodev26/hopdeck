'use strict';
const cp = require('child_process');
const fs = require('fs');

function webUrl(text) {
  if (typeof text !== 'string' || text.length > 8192 || !/^https?:\/\//i.test(text) || /[\s\x00-\x1f\x7f]/u.test(text)) return null;
  try { const url = new URL(text); return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null; } catch { return null; }
}

// Map terminal cells to text offsets, including wide Unicode characters and soft wraps.
function urlAt(term, y, col) {
  const buffer = term.buffer.active, row = buffer.viewportY + y, line = buffer.getLine(row);
  if (!line || col < 0 || col >= term.cols) return null;
  const maxRows = Math.max(1, Math.ceil(16384 / term.cols)); let start = row, end = row;
  while (start > 0 && row - start < maxRows && buffer.getLine(start)?.isWrapped) start--;
  while (end + 1 < buffer.length && end - start < maxRows && buffer.getLine(end + 1)?.isWrapped) end++;
  let text = '', offset = -1;
  for (let r = start; r <= end; r++) {
    const current = buffer.getLine(r);
    for (let c = 0; c < term.cols; c++) {
      const cell = current.getCell(c); if (!cell || cell.getWidth() === 0) continue;
      if (r === row && col >= c && col < c + cell.getWidth()) offset = text.length;
      text += cell.getChars() || ' ';
    }
  }
  if (offset < 0) return null;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"`\x00-\x1f\x7f]+/gi)) {
    let raw = match[0];
    // Sentence punctuation and Markdown delimiters are outside the URL. Keep balanced URL parentheses.
    while (true) {
      const previous = raw;
      raw = raw.replace(/[.,;:!?'…。，；：！？]+$/u, '');
      for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
        if (raw.endsWith(close) && raw.split(close).length > raw.split(open).length) raw = raw.slice(0, -1);
      }
      if (raw === previous) break;
    }
    if (offset >= match.index && offset < match.index + raw.length) return webUrl(raw);
  }
  return null;
}

function openUrl(text, { platform = process.platform, env = process.env, spawn = cp.spawn } = {}) {
  const url = webUrl(text); if (!url) return false;
  if (env.HOPDECK_OPEN_LOG) {
    try { fs.appendFileSync(env.HOPDECK_OPEN_LOG, url + '\n'); return true; } catch { return false; }
  }
  // URLs never enter cmd.exe or a shell: &, %, quotes and other URL characters stay data.
  const command = platform === 'win32' || env.WSL_DISTRO_NAME ? 'explorer.exe' : platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    const child = spawn(command, [url], { stdio: 'ignore', detached: true, windowsHide: true, shell: false });
    child.on('error', () => {}); child.unref(); return true;
  } catch { return false; }
}

module.exports = { webUrl, urlAt, openUrl };
