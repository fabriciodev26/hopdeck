'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Quita secuencias ANSI para comparar texto plano. */
const strip = (s) => s.replace(/\x1b\[[0-9;?<]*[A-Za-z~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');

// Se resuelve la ruta real: en macOS /var es un enlace a /private/var, y el programa trabaja con la ruta real del proceso.
const tmp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

/**
 * Crea un historial de Claude Code falso:  <root>/claude/projects/<proyecto>/<id>.jsonl
 * spec: [{ name, sessions: [{ id, first, ai, custom, ageH, assistant, meta }] }]
 * Devuelve { cfg, cwds } (cada proyecto tiene una carpeta de trabajo real).
 */
function makeFixture(root, spec) {
  const cfg = path.join(root, 'claude');
  const cwds = {};
  for (const proj of spec) {
    const cwd = path.join(root, 'work', proj.name);
    fs.mkdirSync(cwd, { recursive: true });
    cwds[proj.name] = cwd;
    const dir = path.join(cfg, 'projects', proj.name);
    fs.mkdirSync(dir, { recursive: true });
    for (const s of proj.sessions) {
      const lines = [];
      if (s.meta) lines.push({ type: 'user', isMeta: true, message: { role: 'user', content: '<local-command-caveat>x</local-command-caveat>' }, cwd });
      if (s.first) lines.push({ type: 'user', message: { role: 'user', content: s.image ? [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: s.image } }, { type: 'text', text: s.first }] : s.first }, cwd, sessionId: s.id });
      if (s.toolImage) lines.push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: s.toolImage } }] }] }, sessionId: s.id });
      if (s.assistant) lines.push({ type: 'assistant', message: { id: 'msg_' + s.id, role: 'assistant', model: s.model, usage: s.usage, content: [{ type: 'text', text: s.assistant }, ...Array.from({ length: s.tools || 0 }, (_, i) => ({ type: 'tool_use', id: 'tu_' + s.id + i, name: 'Bash', input: {} }))] }, sessionId: s.id });
      if (s.ai) lines.push({ type: 'ai-title', aiTitle: s.ai, sessionId: s.id });
      if (s.custom) lines.push({ type: 'custom-title', customTitle: s.custom, sessionId: s.id });
      const f = path.join(dir, s.id + '.jsonl');
      fs.writeFileSync(f, lines.map((l) => JSON.stringify(l.type === 'user' || l.type === 'assistant' ? { parentUuid: null, isSidechain: false, ...l } : l)).join('\n') + (lines.length ? '\n' : ''));
      const t = (Date.now() - (s.ageH || 1) * 3600 * 1000) / 1000;
      fs.utimesSync(f, t, t);
    }
  }
  return { cfg, cwds };
}

const zlib = require('zlib');
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

/** Codifica un PNG de verdad (colorType 6 = RGBA, 2 = RGB) usando los 5 filtros por fila. px(x,y) → [r,g,b,a]. */
function makePNG(w, h, px, ctype = 6) {
  const ch = ctype === 6 ? 4 : 3, stride = w * ch, rows = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < w; x++) { const v = px(x, y); for (let k = 0; k < ch; k++) cur[x * ch + k] = v[k]; }
    const f = y % 5, out = Buffer.alloc(stride + 1); out[0] = f;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let pred = 0;
      if (f === 1) pred = a; else if (f === 2) pred = b; else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[x + 1] = (cur[x] - pred) & 255;
    }
    rows.push(out); prev = cur;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = ctype;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Abre el hub en un PTY real con un "claude" falso en el PATH y devuelve utilidades para manejarlo.
 * Devuelve null si node-pty / xterm no están disponibles.
 */
function launchHub({ root, fx, env: extra = {}, home = null, cwd = null, cols = 110, rows = 26 }) {
  let pty, Terminal;
  try { pty = require('@lydell/node-pty'); Terminal = require('@xterm/headless').Terminal; } catch { return null; }
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin, { recursive: true });
  const fake = path.join(__dirname, 'fixtures', 'fake-claude.js');
  if (process.platform === 'win32') fs.writeFileSync(path.join(bin, 'claude.cmd'), `@echo off\r\n"${process.execPath}" "${fake}" %*\r\n`);
  else { fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`); fs.chmodSync(path.join(bin, 'claude'), 0o755); }
  // En Windows la variable se llama "Path": si se añadiera otra "PATH" ganaría la original y no se vería el claude falso.
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') || 'PATH';
  const env = {
    ...process.env, [pathKey]: bin + path.delimiter + process.env[pathKey],
    CLAUDE_CONFIG_DIR: fx.cfg, HOPDECK_CONFIG: path.join(root, 'cfg.json'), HOPDECK_CACHE: path.join(root, 'cache.json'),
    WT_SESSION: '', HOPDECK_NOPROMPT: '1', HOPDECK_LANG: 'es', HOPDECK_EMBED: '1', HOPDECK_THEME: 'dark', COLORTERM: 'truecolor', ...extra,
  };
  if (home) { env.HOME = home; env.USERPROFILE = home; }
  delete env.HOPDECK_INSIDE; delete env.TMUX; delete env.NO_COLOR;
  const term = new Terminal({ cols, rows, allowProposedApi: true });
  const p = pty.spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'hopdeck.js')], { name: 'xterm-256color', cols, rows, cwd: cwd || root, env });
  let dead = false;
  term.onData((d) => { if (!dead) try { p.write(d); } catch { /* */ } });
  p.onData((d) => term.write(d));
  const h = { p, term, exited: false };
  p.onExit(() => { h.exited = true; });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  h.sleep = sleep;
  h.lines = () => { const b = term.buffer.active; const out = []; for (let y = 0; y < rows; y++) { const l = b.getLine(b.viewportY + y); out.push(l ? l.translateToString(true) : ''); } return out; };
  h.screen = () => h.lines().join('\n');
  h.write = (d) => { if (!dead) try { p.write(d); } catch { /* */ } };
  h.waitFor = async (re, label, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (re.test(h.screen())) return; await sleep(60); }
    throw new Error(`Tiempo agotado esperando: ${label}\n----- pantalla -----\n${h.screen()}`);
  };
  h.waitGone = async (re, label, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (!re.test(h.screen())) return; await sleep(60); }
    throw new Error(`Seguía en pantalla: ${label}\n----- pantalla -----\n${h.screen()}`);
  };
  /** Evento de ratón SGR (x, y en base 1). b: 0 clic, 35 movimiento sin botón, 64/65 rueda arriba/abajo. */
  h.mouse = (b, x, y, type = 'M') => h.write(`\x1b[<${b};${x};${y}${type}`);
  /** Posición (base 1) del texto `needle` en pantalla (a partir de la columna `desde`), o null. */
  h.find = (needle, desde = 0) => { const ls = h.lines(); for (let y = 0; y < ls.length; y++) { const x = ls[y].indexOf(needle, desde); if (x >= 0) return { x: x + 1, y: y + 1 }; } return null; };
  h.kill = () => { dead = true; try { p.kill(); } catch { /* */ } };
  /** Cierra tras dejar que terminen las escrituras pendientes (evita un EAGAIN asíncrono al matar el PTY). */
  h.close = async () => { await sleep(200); h.kill(); await sleep(50); };
  return h;
}

module.exports = { strip, tmp, makeFixture, makePNG, launchHub };
