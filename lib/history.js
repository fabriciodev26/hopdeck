'use strict';
// Historial de Claude Code (~/.claude/projects): lectura de sesiones con caché, y agrupación por proyecto.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { baseName, tidy } = require('./text');

const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const b = content.find((x) => x && x.type === 'text' && typeof x.text === 'string');
    return b ? b.text : '';
  }
  return '';
}

// Caché del índice: solo se vuelven a leer las sesiones cuya fecha/tamaño cambió.
const CACHE_FILE = process.env.HOPDECK_CACHE || path.join(os.homedir(), '.hopdeck-cache.json');
let CACHE = null, cacheDirty = false, cacheSeen = null;
/** Empieza un escaneo: las entradas de la caché que no se vean se descartan al terminar. */
const beginScan = () => { cacheSeen = new Set(); };
const endScan = () => { cacheSave(); cacheSeen = null; };
function cacheLoad() {
  if (CACHE) return CACHE;
  try { const j = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); CACHE = j && j.v === 1 && j.files ? j : { v: 1, files: {} }; } catch { CACHE = { v: 1, files: {} }; }
  return CACHE;
}
function cacheSave() {
  if (!CACHE) return;
  if (cacheSeen) for (const f of Object.keys(CACHE.files)) if (!cacheSeen.has(f)) { delete CACHE.files[f]; cacheDirty = true; }
  if (!cacheDirty) return;
  // la caché contiene títulos y primeros mensajes: permisos solo para el usuario
  try { fs.writeFileSync(CACHE_FILE + '.tmp', JSON.stringify(CACHE), { mode: 0o600 }); fs.renameSync(CACHE_FILE + '.tmp', CACHE_FILE); } catch { /* sin permisos */ }
  cacheDirty = false;
}

/** ¿La línea JSON es de ese tipo? (tolera espacios; Claude escribe JSON compacto) */
const isType = (line, t) => line.includes(`"type":"${t}"`) || new RegExp(`"type"\\s*:\\s*"${t}"`).test(line);

function readSession(file) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const cache = cacheLoad(); if (cacheSeen) cacheSeen.add(file);
  const hit = cache.files[file];
  if (hit && hit.m === st.mtimeMs && hit.z === st.size) return hit.d ? { ...hit.d, file, mtime: st.mtimeMs } : null;
  const d = parseSession(file, st);
  cache.files[file] = { m: st.mtimeMs, z: st.size, d: d ? { id: d.id, title: d.title, first: d.first, cwd: d.cwd } : null };
  cacheDirty = true;
  return d;
}

function parseSession(file, st) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return null; }
  try {
    const HEAD = 64 * 1024, TAIL = 160 * 1024;
    const hb = Buffer.alloc(Math.min(st.size, HEAD));
    fs.readSync(fd, hb, 0, hb.length, 0);
    const head = hb.toString('utf8').split('\n');
    if (st.size > HEAD) head.pop(); // última línea cortada
    let tail = [];
    if (st.size > HEAD) {
      const len = Math.min(st.size, TAIL);
      const tb = Buffer.alloc(len);
      fs.readSync(fd, tb, 0, len, st.size - len);
      tail = tb.toString('utf8').split('\n');
      tail.shift();
    }
    let cwd = '', first = '', custom = '', ai = '';
    for (const line of head) {
      if (!line) continue;
      const wantCwd = !cwd && line.includes('"cwd"');
      const wantUser = !first && isType(line, 'user');
      const wantTitle = line.includes('-title"');
      if (!wantCwd && !wantUser && !wantTitle) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (wantCwd && j.cwd) cwd = j.cwd;
      if (j.type === 'custom-title' && j.customTitle) custom = j.customTitle;
      if (j.type === 'ai-title' && j.aiTitle) ai = j.aiTitle;
      if (wantUser && j.type === 'user' && !j.isMeta && !j.isSidechain) {
        const t = tidy(textOf(j.message && j.message.content));
        if (t && !t.startsWith('<') && !t.startsWith('[Request interrupted')) first = t.slice(0, 300);
      }
    }
    // los títulos más recientes están al final del archivo
    let tCustom = '', tAi = '';
    for (let i = tail.length - 1; i >= 0; i--) {
      const line = tail[i];
      if (!line.includes('-title"')) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (!tCustom && j.type === 'custom-title' && j.customTitle) tCustom = j.customTitle;
      if (!tAi && j.type === 'ai-title' && j.aiTitle) tAi = j.aiTitle;
      if (tCustom) break;
    }
    const title = tidy(tCustom || custom || tAi || ai || first || '');
    if (!title) return null; // sesión vacía
    return { id: path.basename(file, '.jsonl'), file, title, first, cwd, mtime: st.mtimeMs };
  } catch { return null; } finally { try { fs.closeSync(fd); } catch { /* */ } }
}

function decodeDir(name) { // mejor esfuerzo si ninguna sesión trae cwd
  if (/^[A-Za-z]--/.test(name)) return name[0] + ':\\' + name.slice(3).replace(/-/g, '\\');
  return name.replace(/-/g, '/');
}

function projectDirs() {
  const root = path.join(CONFIG_DIR, 'projects');
  try { return fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(root, d.name)); } catch { return []; }
}

function buildProject(dir) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { return null; }
  const sessions = files.map((f) => readSession(path.join(dir, f))).filter(Boolean);
  if (!sessions.length) return null;
  sessions.sort((a, b) => b.mtime - a.mtime);
  const seen = {};
  for (const x of sessions) { const k = x.title + '|' + x.first; seen[k] = (seen[k] || 0) + 1; }
  for (const x of sessions) x.dup = seen[x.title + '|' + x.first] > 1;
  const key = path.basename(dir);
  const cwd = (sessions.find((s) => s.cwd) || {}).cwd || decodeDir(key);
  return { key, cwd, name: baseName(cwd), sessions, mtime: sessions[0].mtime };
}

module.exports = { CONFIG_DIR, CACHE_FILE, textOf, isType, cacheLoad, cacheSave, beginScan, endScan, readSession, parseSession, decodeDir, projectDirs, buildProject };
