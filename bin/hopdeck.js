#!/usr/bin/env node
'use strict';
/**
 * Hopdeck
 * Selector visual de proyectos y sesiones para Claude Code.
 * Cero dependencias · arranque instantáneo.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const readline = require('readline');

const { LANG, T } = require('../lib/i18n');
const { TRUE, NOCOL, LIGHT, setTheme, isLight, fg, bg, R, C, cw, strW, fit, clean } = require('../lib/style');
const mascot = require('../lib/mascot');
const stats = require('../lib/stats');
const { baseName, tidy, home, shortPath, fold, queryWords, matchWords, fuzzy, wrapText } = require('../lib/text');
const hist = require('../lib/history');
const { CONFIG_DIR, CACHE_FILE, textOf, isType, cacheLoad, cacheSave, readSession, decodeDir, projectDirs, buildProject, beginScan, endScan } = hist;
const images = require('../lib/images');
const { encodeSixel } = require('../lib/sixel');
const gitlib = require('../lib/git');
const deepsearch = require('../lib/deepsearch');
const { collectImages, decodePNG, decodeImage, scaleBox, fitSize, halfBlocks } = images;
const { parseKeys, KEYMAP, printable, editBuf, normalizeKeys } = require('../lib/keys');
const { stripJsonc, wtCtrlV, wtSettingsFile } = require('../lib/windows-terminal');

let VERSION = '0.0.0';
try { VERSION = require('../package.json').version; } catch { /* sin package.json */ }
const WIN = process.platform === 'win32';
// Preferencias propias: proyectos fijados/ocultos, ancho del panel, ratón.
const CFG_FILE = process.env.HOPDECK_CONFIG || path.join(os.homedir(), '.hopdeck.json');
const CFG = { pinned: [], hidden: [], archived: [], sidebar: 0, mouse: true, notify: true, last: null };
const saveCfg = () => { try { fs.writeFileSync(CFG_FILE, JSON.stringify(CFG, null, 2), { mode: 0o600 }); } catch { /* solo lectura */ } };
try { Object.assign(CFG, JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'))); } catch { /* primera vez */ }

// ───────────────────────── i18n ─────────────────────────

// ───────────────────────── estilo ─────────────────────────
// ───────────────────────── datos ─────────────────────────

function sortProjects(list) {
  return list.sort((a, b) => (b.pinned - a.pinned) || (b.isCwd - a.isCwd) || (b.mtime - a.mtime));
}

function finishScan(projects) {
  endScan();
  const cur = process.cwd();
  const have = (d) => projects.some((p) => p.cwd === d);
  if (!have(cur)) projects.push({ key: '__cwd', cwd: cur, name: baseName(cur), sessions: [], mtime: Date.now() });
  // carpetas abiertas desde el selector y chats vivos que aún no tienen historial: se muestran igualmente
  for (const x of Array.isArray(CFG.recent) ? CFG.recent : []) {
    if (x && x.dir && !have(x.dir) && fs.existsSync(x.dir)) projects.push({ key: '__recent:' + x.dir, cwd: x.dir, name: baseName(x.dir), sessions: [], mtime: x.t || 0 });
  }
  for (const x of E.sessions.values()) if (!have(x.cwd)) projects.push({ key: '__live:' + x.cwd, cwd: x.cwd, name: baseName(x.cwd), sessions: [], mtime: Date.now() });
  linkChats(projects);
  for (const p of projects) {
    p.isCwd = p.cwd === cur;
    p.pinned = CFG.pinned.includes(p.cwd) ? 1 : 0;
    p.hidden = CFG.hidden.includes(p.cwd) && !p.isCwd;
    p.isCwd = p.isCwd ? 1 : 0;
  }
  return sortProjects(projects);
}

/** Un chat nuevo ya escribió su historial: se enlaza con su archivo para que la lista lo muestre como la conversación real. */
function linkChats(projects) {
  const all = [...E.sessions.values()], pend = all.filter((x) => !x.sid);
  if (!pend.length) return;
  const taken = new Set(all.map((x) => x.sid).filter(Boolean));
  for (const x of pend) {
    if (pend.filter((y) => y.cwd === x.cwd).length !== 1) continue; // varios chats nuevos en la misma carpeta: ambiguo
    const p = projects.find((q) => q.cwd === x.cwd); if (!p) continue;
    const c = p.sessions.filter((q) => q.mtime >= x.t0 - 2000 && !taken.has(q.id) && !E.sessions.has(q.id)).sort((a, b) => b.mtime - a.mtime)[0];
    if (c) { x.sid = c.id; x.title = c.title; taken.add(c.id); }
  }
  embedLive();
}

function toggleProject(p, field) {
  const list = CFG[field];
  const i = list.indexOf(p.cwd);
  if (i >= 0) list.splice(i, 1); else list.push(p.cwd);
  p[field] = field === 'pinned' ? (i < 0 ? 1 : 0) : i < 0;
  saveCfg(); sortProjects(S.projects);
}

// Se llama en cada dibujo; en WSL leer un archivo de /mnt/c cuesta unos 4 ms, así que el resultado se guarda unos segundos.
const BRANCH = new Map();
function gitBranch(cwd) {
  const now = Date.now(), hit = BRANCH.get(cwd);
  if (hit && now - hit.t < 3000) return hit.v;
  let v = '';
  try {
    const h = fs.readFileSync(path.join(cwd, '.git', 'HEAD'), 'utf8').trim();
    const m = h.match(/^ref: refs\/heads\/(.+)$/);
    v = m ? m[1] : h.slice(0, 7);
  } catch { /* sin git */ }
  BRANCH.set(cwd, { t: now, v });
  return v;
}

function scan() {
  beginScan();
  return finishScan(projectDirs().map(buildProject).filter(Boolean));
}

/** Igual que scan() pero cede el control al bucle de eventos para poder animar el loader. */
async function scanAsync(onProgress) {
  const dirs = projectDirs(); const projects = [];
  beginScan();
  for (let i = 0; i < dirs.length; i++) {
    const p = buildProject(dirs[i]); if (p) projects.push(p);
    if (i % 3 === 2) { if (onProgress) onProgress(i + 1, dirs.length); await new Promise((r) => setImmediate(r)); }
  }
  return finishScan(projects);
}

function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return T.now;
  if (s < 3600) return Math.floor(s / 60) + ' ' + T.min;
  if (s < 86400) return Math.floor(s / 3600) + ' ' + T.h;
  if (s < 86400 * 14) return Math.floor(s / 86400) + ' ' + T.d;
  if (s < 86400 * 60) return Math.floor(s / 604800) + ' ' + T.w;
  return Math.floor(s / 2592000) + ' ' + T.mo;
}

// ───────────────────────── estado ─────────────────────────
const S = { auto: false, qpos: 0, pc: 0, fb: null, confirmMk: null, confirmClose: null, more: new Set(), qs: null, promptKind: 'folder', renameTarget: null, deep: false, deepHits: null, showHidden: false, prompt: null, help: false, loading: false, projects: [], pi: 0, si: 0, focus: 0, query: '', searching: false, poff: 0, soff: 0, flash: '', c: 0, coff: 0, open: null, live: new Set(), liveKey: '' };
const SIDEBAR = process.argv.includes('--sidebar');
let EMBED = false; // vista dividida con terminal embebido (Windows / sin tmux)
const E = { sessions: new Map(), shown: null, focus: 'left', pend: null, deps: null, mouse: CFG.mouse !== false, hideSide: false, git: !!CFG.git, note: null, sel: null, gallery: null, hover: null, sixelDetected: false, cell: { w: 10, h: 20 }, sixelKey: null, sixelAt: 0, sixelStale: false, sixelRetry: null };
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let spinT = null, frameN = 0, reloading = false;
const needsSpin = () => S.loading || (E.gallery && (E.gallery.loading || E.gallery.pending)) || (E.hover && E.hover.g.pending) || [...E.sessions.values()].some((x) => x.working || (!x.ready && x === E.sessions.get(E.shown)));
function ensureSpin() {
  if (spinT) return;
  spinT = setInterval(() => {
    if (!needsSpin()) { clearInterval(spinT); spinT = null; if (active) render(); return; }
    frameN++; if (active) render();
  }, 90);
}
const spin = () => SPIN[frameN % SPIN.length];

/** Recarga la lista sin congelar la pantalla; `after` restaura la selección. */
async function reloadAsync(after, silent) {
  if (reloading) return;
  reloading = true; if (!silent) { S.loading = true; ensureSpin(); if (active) render(); }
  deepPrev = null;
  try { S.projects = await scanAsync(); } finally { reloading = false; if (!silent) S.loading = false; }
  if (after) after();
  if (active) render();
}

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

/** Marca junto a una conversación: ↻N = es la misma conversación continuada N veces (se muestra solo la última); #xxxx = otra distinta con el mismo título. */
const sessTag = (s) => (s.parts ? '↻' + s.parts : s.dup ? '#' + s.id.slice(0, 4) : '');

function view() {
  // La búsqueda son palabras sueltas, sin importar el orden, mayúsculas ni acentos: «vistas roles» encuentra «Roles y vistas».
  // Cada conversación se compara con proyecto + título + primer mensaje; el proyecto entero sale si lo que se busca está en su nombre o ruta.
  const ws = queryWords(S.query);
  const base = S.projects.filter((p) => S.showHidden || !p.hidden);
  const vis = (x) => S.showHidden || !CFG.archived.includes(x.id);
  if (!ws.length) return base.map((p) => ({ p, ss: p.sessions.filter(vis) }));
  const hitS = (p, x) => matchWords(ws, x._f || (x._f = fold(p.name + ' ' + x.title + ' ' + x.first))) || !!(S.deepHits && S.deepHits.has(x.id));
  const out = [];
  for (const p of base) {
    const hit = matchWords(ws, p._f || (p._f = fold(p.name + ' ' + p.cwd)));
    const ss = (hit ? p.sessions : p.sessions.filter((x) => hitS(p, x))).filter(vis);
    if (hit || ss.length) out.push({ p, ss });
  }
  return out;
}

// búsqueda dentro del texto de las conversaciones (Tab en el modo búsqueda): en hilos de trabajo y con los aciertos en directo
let deepT = null, deepTok = 0, deepPrev = null, deepJob = null;
function queryChanged() {
  clearTimeout(deepT); deepTok++; S.deepHits = null;
  if (deepJob) { deepJob.cancel(); deepJob = null; }
  // Si ningún título ni proyecto coincide, se busca solo dentro del contenido sin que haya que pedirlo con Tab
  S.auto = !S.deep && S.query.trim().length >= 3 && !view().length;
  const deepOn = S.deep || S.auto;
  if (!deepOn || !S.query.trim()) deepPrev = null;
  if (!deepOn || S.query.trim().length < 3) { if (!reloading) S.loading = false; return; }
  const tok = deepTok; S.loading = true; ensureSpin();
  deepT = setTimeout(() => {
    const q = S.query.trim().toLowerCase(), hits = new Set();
    const all = S.projects.flatMap((p) => p.sessions);
    // si la búsqueda anterior era un prefijo de esta, solo hay que mirar sus aciertos
    const list = (deepPrev && q.startsWith(deepPrev.q) ? all.filter((x) => deepPrev.hits.has(x.id)) : all).filter((x) => x.file);
    const idOf = new Map(list.map((x) => [x.file, x.id]));
    S.deepHits = hits; // se va llenando: los aciertos aparecen en la lista según se encuentran
    const job = deepsearch.deepSearch(list.map((x) => x.file), q, (file) => { if (tok !== deepTok) return; hits.add(idOf.get(file)); if (active) scheduleRender(); });
    deepJob = job;
    job.done.then(() => { if (tok === deepTok) { deepPrev = { q, hits }; S.loading = false; deepJob = null; if (active) render(); } });
  }, 250);
}

const scroll = (off, sel, h) => clamp(off, sel - h + 1, sel);

// ───────────────────────── render ─────────────────────────
function frame(cols, rows) {
  const W = cols, H = rows;
  if (W < 60 || H < 12) return [fit([[T.small, C.warn]], W)];
  const V = view();
  S.pi = clamp(S.pi, 0, Math.max(0, V.length - 1));
  const cur = V[S.pi];
  const ents = cur ? [{ neu: true }, ...cur.ss] : [];
  S.si = clamp(S.si, 0, Math.max(0, ents.length - 1));

  const inner = W - 2;
  const lw = clamp(Math.floor(inner * 0.4), 26, 46);
  const rw = inner - lw - 1;
  const bodyH = H - 6;
  const listH = bodyH - 3;
  const B = (s) => C.faint + s + R;
  const lines = [];

  // borde superior
  const title = ' » Hopdeck ';
  const ver = ` v${VERSION} `;
  const fill = Math.max(0, inner - 1 - strW(title) - strW(ver));
  lines.push(B('╭─') + C.brand + C.bold + ' » Hop' + R + C.text + C.bold + 'deck ' + R + B('─'.repeat(fill)) + C.dim + ver + R + B('╮'));

  // cabeceras
  const hl = S.focus === 0 ? C.accent + C.bold : C.dim;
  const hr = S.focus === 1 ? C.accent + C.bold : C.dim;
  lines.push(B('│') + fit([[' ' + T.projects, hl], ['  ' + V.length, C.dim], [S.loading ? '  ' + spin() : '', C.accent]], lw) + B('│') +
    fit([[' ' + T.sessions, hr], [cur ? ' · ' + cur.p.name : '', C.dim]], rw) + B('│'));
  lines.push(B('├' + '─'.repeat(lw) + '┼' + '─'.repeat(rw) + '┤'));

  // cuerpo
  S.poff = scroll(S.poff, S.pi, bodyH);
  S.soff = scroll(S.soff, S.si, listH);
  for (let r = 0; r < bodyH; r++) {
    // izquierda: proyectos
    let left;
    const pv = V[S.poff + r];
    if (pv) {
      const sel = S.poff + r === S.pi;
      const base = sel ? (S.focus === 0 ? C.selOn : C.selOff) : '';
      const mark = sel ? (S.focus === 0 ? '▌' : '▎') : ' ';
      const nameW = lw - 14;
      const cnt = String(pv.p.sessions.length || '·').padStart(3);
      const when = pv.p.sessions.length ? ago(pv.p.mtime).padStart(7) : ' '.repeat(7);
      left = fit([
        [mark + ' ', C.accent],
        [(pv.p.pinned ? '★ ' : '') + (pv.p.isCwd ? '● ' : '') + pv.p.name, sel ? C.text + C.bold : pv.p.hidden ? C.dim : (pv.p.isCwd ? C.ok : C.text)],
      ], nameW + 2, base) + fit([[' ' + cnt, sel ? C.accent : C.dim], [' ' + when, C.dim]], lw - nameW - 2, base);
    } else if (r === 0 && !V.length) {
      left = fit([[' ' + T.noMatch, C.dim]], lw);
    } else left = ' '.repeat(lw);

    // derecha: sesiones (y detalle en las últimas 3 filas)
    let right;
    if (r < listH) {
      const e = ents[S.soff + r];
      if (e) {
        const sel = S.soff + r === S.si && S.focus === 1;
        const base = sel ? C.selOn : '';
        const mark = sel ? '▌ ' : '  ';
        if (e.neu) {
          right = fit([[mark, C.accent], ['＋ ', C.accent], [T.newChat, sel ? C.accent + C.bold : C.accent]], rw, base);
        } else {
          const when = ago(e.mtime);
          const tw = rw - 2 - when.length - 2;
          right = fit([[mark, C.accent], [e.title, sel ? C.text + C.bold : C.text],
            [e.first && e.first !== e.title ? '  ' + e.first : '', C.dim],
            [sessTag(e) ? '  ' + sessTag(e) : '', C.accent]], tw + 2, base) +
            fit([['  ' + when, C.dim]], rw - tw - 2, base);
        }
      } else right = ' '.repeat(rw);
    } else if (r === listH) {
      right = C.faint + '┄'.repeat(rw) + R;
    } else if (r === listH + 1) {
      const missing = cur && !fs.existsSync(cur.p.cwd);
      right = fit([[' ⌂ ', C.dim], [shortPath(cur ? cur.p.cwd : ''), missing ? C.warn : C.dim],
        [cur && cur.p.isCwd ? '  · ' + T.current : '', C.ok]], rw);
    } else {
      const e = ents[S.si];
      if (e && !e.neu) {
        right = fit([[' ' + (e.first && e.first !== e.title ? '“' + e.first + '”' : e.id.slice(0, 8)), C.ital + C.dim]], rw);
      } else right = fit([[cur ? ' ' + T.sess(cur.p.sessions.length) : '', C.dim]], rw);
    }
    lines.push(B('│') + left + B('│') + right + B('│'));
  }

  // pie
  lines.push(B('├' + '─'.repeat(lw) + '┴' + '─'.repeat(rw) + '┤'));
  let foot;
  if (S.flash) foot = fit([[' ' + S.flash, C.warn]], inner);
  else if (S.searching || S.query) {
    foot = fit([[' / ', C.accent], [S.query, C.text], [S.searching ? '▏' : '', C.accent],
      ['   Tab ' + (S.deep ? '◉ ' : '○ ') + T.deep, S.deep ? C.ok : C.dim], ['   ' + T.searchHint, C.dim]], inner);
  } else {
    const k = T.k;
    const hints = S.focus === 0
      ? [['↑↓', k.move], ['→', k.open], ['n', k.neu], ['/', k.find], ['q', k.quit]]
      : [['↑↓', k.move], ['⏎', k.resume], ['←', k.back], ['n', k.neu], ['/', k.find], ['q', k.quit]];
    const segs = [[' ', '']];
    for (const [key, desc] of hints) segs.push([key, C.accent], [' ' + desc + '   ', C.dim]);
    foot = fit(segs, inner);
  }
  lines.push(B('│') + foot + B('│'));
  lines.push(B('╰' + '─'.repeat(inner) + '╯'));
  return lines;
}


// ───────────────────────── utilidades de interfaz ─────────────────────────
// ───────────────────────── modo panel lateral (tmux) ─────────────────────────
const LIMIT = 8; // sesiones visibles por proyecto antes de "mostrar N más…"
function flatList() {
  const q = S.query.trim(); const out = [];
  for (const { p, ss } of view()) {
    const open = p.key === S.open || (!!q && ss.length < p.sessions.length);
    out.push({ t: 'p', p, open });
    if (open) {
      out.push({ t: 'n', p });
      if (EMBED) for (const [key, x] of E.sessions) if (!x.sid && x.cwd === p.cwd) out.push({ t: 'l', p, key, x }); // chat nuevo aún sin historial
      const lim = q || S.more.has(p.key) ? ss.length : LIMIT;
      for (const s of ss.slice(0, lim)) out.push({ t: 's', p, s });
      if (ss.length > lim) out.push({ t: 'm', p, n: ss.length - lim });
    }
  }
  return out;
}

const chatByKey = (id) => E.sessions.get(id) || [...E.sessions.values()].find((x) => x.sid === id);
const chatKeyOf = (id) => (E.sessions.has(id) ? id : ([...E.sessions].find(([, x]) => x.sid === id) || [])[0]);

function chatMark(id) {
  if (!S.live.has(id)) return ['  ', ''];
  const x = EMBED && chatByKey(id);
  if (x && x.working) return [spin() + ' ', C.accent];
  if (x && x.unseen) return ['✔ ', C.warn];
  return ['● ', C.ok];
}

/** Trocea `text` en segmentos [[texto, estilo]] resaltando las coincidencias (sin distinguir mayúsculas) con la búsqueda `q` (en minúsculas). */
function hl(text, q, style) {
  const t = String(text), ws = queryWords(q);
  if (!ws.length) return [[t, style]];
  const f = fold(t);
  if (f.length !== t.length) return [[t, style]]; // algunas letras cambian de largo al plegarlas: no se resalta
  const on = new Array(t.length).fill(false); // cada palabra de la búsqueda, en cualquier parte y sin importar acentos ni mayúsculas
  for (const w of ws) for (let at = f.indexOf(w); at >= 0; at = f.indexOf(w, at + w.length)) for (let i = at; i < at + w.length; i++) on[i] = true;
  if (!on.includes(true)) return [[t, style]];
  const out = [];
  for (let i = 0; i < t.length;) {
    let j = i; while (j < t.length && on[j] === on[i]) j++;
    out.push([t.slice(i, j), on[i] ? C.brand + C.bold : style]);
    i = j;
  }
  return out;
}

/** Resumen de los chats abiertos para la cabecera de la lista: trabajando ⠋, terminados sin ver ✔, abiertos ●. */
function liveSummary() {
  if (!EMBED) return [];
  let w = 0, u = 0, o = 0;
  for (const x of E.sessions.values()) { if (x.working) w++; else if (x.unseen) u++; else o++; }
  const segs = [];
  if (w) segs.push(['  ' + spin() + ' ' + w, C.accent]);
  if (u) segs.push(['  ✔ ' + u, C.warn]);
  if (o) segs.push(['  ● ' + o, C.ok]);
  return segs;
}

const tailFit = (t, n) => (strW(t) > n && n > 3 ? '…' + t.slice(t.length - (n - 1)) : t);

function frameTree(W, H) {
  if (H < 8 || W < 24) return [fit([[T.small, C.warn]], W)];
  const L = flatList();
  S.c = clamp(S.c, 0, Math.max(0, L.length - 1));
  const bodyH = H - 5;
  S.coff = scroll(S.coff, S.c, bodyH);
  const lines = [];
  const searchOn = !S.fb && !S.qs && S.prompt === null && !S.help && (S.searching || !!S.query.trim()); // hay una búsqueda en marcha
  const head = [[' » ', C.brand], ['Hop', C.brand + C.bold], ['deck', C.text + C.bold], ['  ' + S.projects.length, C.dim], [S.loading && !searchOn ? '  ' + spin() : '', C.accent], ...liveSummary()];
  // «⌕ / buscar» siempre a la vista, arriba a la derecha (sin la palabra si el título y los chats abiertos ya ocupan el sitio)
  const headW = head.reduce((a, [t]) => a + strW(t), 0), longHint = ' ⌕ / ' + T.k.find + ' ', hint = headW + strW(longHint) <= W ? longHint : headW + 5 <= W ? ' ⌕ / ' : '';
  lines.push(searchOn
    // el cuadro de búsqueda ocupa el lugar del título, arriba, donde se mira primero
    ? fit([[' ⌕ ', C.accent], ...withCursor(S.query, S.searching ? S.qpos : [...S.query].length, S.searching), [S.query ? '' : ' ' + T.searchPh, C.dim]], W)
    : hint && !S.fb && !S.qs && S.prompt === null && !S.help ? fit(head, W - strW(hint)) + fit([[' ⌕ ', C.accent], ['/ ', C.accent + C.bold], [hint.slice(5), C.dim]], strW(hint))
    : fit(head, W));
  lines.push(C.faint + '─'.repeat(W) + R);
  const sq0 = S.query.trim().toLowerCase(); // búsqueda activa: se resaltan las coincidencias
  const qWords = searchOn ? queryWords(S.query) : [];
  const nHits = searchOn ? L.filter((x) => x.t === 's' || (x.t === 'p' && !x.open)).length : 0; // conversaciones que coinciden (o el proyecto, si coincidió su nombre)
  const qsList = S.qs ? qsItems() : null;
  const fbList = S.fb && !S.qs ? fbRows() : null;
  if (fbList) { S.fb.i = clamp(S.fb.i, 0, Math.max(0, fbList.length - 1)); S.fb.off = scroll(S.fb.off, S.fb.i, bodyH); lines[0] = fit([[' » ' + T.fbTitle, C.accent + C.bold]], W); }
  if (qsList) { S.qs.i = clamp(S.qs.i, 0, Math.max(0, qsList.length - 1)); S.qs.off = scroll(S.qs.off || 0, S.qs.i, bodyH); }
  for (let r = 0; r < bodyH; r++) {
    if (qsList) {
      const it = qsList[S.qs.off + r];
      if (!it) { lines.push(' '.repeat(W)); continue; }
      const sel = S.qs.off + r === S.qs.i, base = sel ? C.selOn : '';
      lines.push(fit([[sel ? '▌ ' : '  ', C.accent], [it.s.title, sel ? C.text + C.bold : C.text], ['  ' + it.p.name, C.dim]], W - 8, base) +
        fit([[' ' + ago(it.s.mtime).padStart(6), C.dim], [' ', '']], 8, base)); // el espacio evita que el nombre del proyecto se pegue a la hora
      continue;
    }
    if (fbList) {
      const it = fbList[S.fb.off + r];
      if (!it) { lines.push(' '.repeat(W)); continue; }
      const sel = S.fb.off + r === S.fb.i, base = sel ? C.selOn : '', mark = [sel ? '▌' : ' ', C.accent];
      if (it.k === 'dir') {
        const full = fbPath(S.fb, it.n), has = S.projects.some((p) => p.cwd === full && p.sessions.length);
        lines.push(fit([mark, [S.fb.dir === '' ? ' ▪ ' : ' ▸ ', C.dim], [it.n, sel ? C.text + C.bold : C.text]], W - 11, base) + fit([[has ? T.fbProj : '', C.dim], [' ', '']], 11, base));
      } else if (it.k === 'recent') {
        lines.push(fit([mark, [' ↻ ', C.accent], [baseName(it.dir), sel ? C.text + C.bold : C.text]], W - 11, base) + fit([[T.fbRecent, C.dim], [' ', '']], 11, base));
      } else if (it.k === 'none') {
        lines.push(fit([mark, ['   ', ''], [T.fbEmpty, C.dim]], W, base));
      } else {
        const lab = it.k === 'here' ? ['✔ ', T.fbHere] : it.k === 'new' ? ['＋ ', T.fbNew] : ['↑ ', T.fbUp];
        lines.push(fit([mark, [' ' + lab[0], C.accent], [lab[1], sel ? C.accent + C.bold : C.accent]], W, base));
      }
      continue;
    }
    if (S.help) { const t = T.help[r]; lines.push(fit([[t ? ' ' + t : '', r === 0 ? C.accent + C.bold : C.dim]], W)); continue; }
    const e = L[S.coff + r];
    if (!e && searchOn && !L.length && r <= 2) { // búsqueda sin resultados: se dice, y se explica qué hacer
      const msg = r === 0 ? [[' ' + T.noRes(S.query.trim()), C.warn]]
        : r === 2 ? [[' ' + ((S.deep || S.auto) ? (S.loading ? spin() + ' ' + T.searchingContent : '') : T.tryContent), C.dim]] : [];
      lines.push(fit(msg, W)); continue;
    }
    if (!e) { lines.push(' '.repeat(W)); continue; }
    const sel = S.coff + r === S.c;
    const base = sel ? (EMBED && E.focus === 'right' ? C.selOff : C.selOn) : '';
    const mark = [sel ? '▌' : ' ', C.accent];
    if (e.t === 'p') {
      const n = e.p.sessions.length;
      // nº de conversaciones (destacado) · hace cuánto fue la última; alineado con la columna de tiempo de las conversaciones
      const right = n ? [[String(n).padStart(3), sel ? C.text + C.bold : C.text], [' · ', C.faint], [''.padEnd(0), ''], [ago(e.p.mtime).padStart(6), C.dim], [' ', '']] : [[' ', '']];
      // 4) los proyectos plegados se atenúan: el desplegado, el de esta carpeta y el seleccionado destacan
      const nameC = sel ? C.text + C.bold : e.p.hidden ? C.dim : e.p.isCwd ? C.ok : e.open ? C.text : C.dim;
      lines.push(fit([mark, [e.open ? ' ▾ ' : ' ▸ ', e.open ? C.accent : C.dim],
        [(e.p.pinned ? '★ ' : '') + (e.p.isCwd ? '● ' : ''), nameC], ...hl(e.p.name, sq0, nameC)], W - 13, base) +
        fit(right, 13, base));
    } else if (e.t === 'm') {
      lines.push(fit([mark, ['      ', ''], [T.more(e.n), sel ? C.text : C.dim]], W, base));
    } else if (e.t === 'l') {
      const [mk, mc] = chatMark(e.key);
      lines.push(fit([mark, ['    ', ''], [mk, mc], [T.newChat + ' …', sel ? C.text + C.bold : C.text]], W - 13, base) +
        fit([[''.padEnd(6), ''], [ago(e.x.t0).padStart(6), C.dim], [' ', '']], 13, base));
    } else if (e.t === 'n') {
      lines.push(fit([mark, ['    ＋ ', C.accent], [T.newChat, sel ? C.accent + C.bold : C.accent]], W, base));
    } else {
      const [mk, mc] = chatMark(e.s.id);
      const arch = CFG.archived.includes(e.s.id), tag = sessTag(e.s);
      const ts = sel ? C.text + C.bold : arch ? C.dim : C.text, inTxt = qWords.length && !matchWords(qWords, fold(e.s.title)); // ⌕: coincide por el proyecto, el primer mensaje o el contenido
      lines.push(fit([mark, ['    ', ''], [mk, mc], ...hl(e.s.title, sq0, ts), ...(inTxt ? [[' ⌕', C.dim]] : [])], W - 13, base) +
        fit([[tag.padEnd(6), C.accent], [ago(e.s.mtime).padStart(6), C.dim], [' ', '']], 13, base));
    }
  }
  const cur = L[S.c];
  lines.push(C.faint + '─'.repeat(W) + R);
  const br = cur && !S.flash ? gitBranch(cur.p.cwd) : '';
  const note = EMBED && E.note;
  const deepOn = S.deep || S.auto;
  lines.push(fit(S.flash ? [[' ' + S.flash, C.warn]] : searchOn // durante una búsqueda, esta fila dice cuántos resultados hay y dónde se busca
    ? [[' ', ''], nHits ? [T.found(nHits), C.accent + C.bold] : [T.noMatch, C.warn], deepOn ? [S.loading ? '  ' + spin() + ' ' + T.searchingContent : '  · ' + T.inContent, C.dim] : ['', '']]
    : S.fb ? [[S.prompt !== null ? ' ' + T.mkIn + ' ' : ' ⌂ ', C.dim], [tailFit(S.fb.dir === '' ? T.fbDrives : shortPath(S.fb.dir) + (S.prompt !== null ? path.sep : ''), W - 14), C.accent]] : note ? [[' ' + note.t, C.ok]]
    : [[br ? ' ⎇ ' + br + '  ' : '', C.accent], [cur ? (br ? '' : ' ⌂ ') + shortPath(cur.p.cwd) : '', C.dim]], W));
  if (S.qs) {
    lines.push(fit([[' ⌕ ', C.accent], ...withCursor(S.qs.q, S.qs.pc), [S.qs.q ? '' : ' ' + T.qsHint, C.dim]], W));
  } else if (S.prompt !== null) {
    const rn = S.promptKind === 'rename';
    lines.push(fit([[rn ? ' ✎ ' : ' ⌂ ', C.accent], ...withCursor(S.prompt, S.pc), [S.prompt ? '' : ' ' + (rn ? T.renameLbl : T.pathPrompt) + '…', C.dim]], W));
  } else if (S.fb) {
    lines.push(fit(S.fb.filt || S.fb.q ? [[' / ', C.accent], ...withCursor(S.fb.q, S.fb.qp, S.fb.filt)] : [[' ' + T.fbHint, C.dim]], W));
  } else if (searchOn) {
    // teclas de la búsqueda: mientras se escribe, ⏎ abre la conversación marcada; con la búsqueda ya aceptada, / permite editarla
    lines.push(fit([[' ⏎', C.accent], [' ' + T.k.open + '  ', C.dim], S.searching ? ['Tab', C.accent] : ['/', C.accent], S.searching ? [' ' + (deepOn ? '◉ ' : '○ ') + T.deep + '  ', deepOn ? C.ok : C.dim] : [' ' + T.kEdit + '  ', C.dim],
      ['esc', C.accent], [' ' + (S.searching ? T.kEsc : T.kClear), C.dim]], W));
  } else {
    // solo lo que la barra de abajo no dice: qué hace ⏎ en la fila marcada y sus teclas propias (n, /, ?, q… ya están abajo)
    const k = T.k, segs = [[' ', '']];
    const keys = !cur ? [['⏎', k.open]]
      : cur.t === 'p' ? [['⏎', T.kUnfold], ['p', T.kPin], ['x', T.kHide]]
      : cur.t === 's' ? [['⏎', k.resume], ['R', T.kRename], ['a', T.kArchive]]
      : [['⏎', k.open]];
    keys.forEach(([key, desc], i) => segs.push([key, C.accent], [' ' + desc + (i < keys.length - 1 ? '  ' : ''), C.dim])); // sin espacios tras la última: contarían para el ancho y forzarían el «…»
    lines.push(fit(segs, W));
  }
  return lines;
}

const tmux = (...a) => cp.execFileSync('tmux', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sq = (x) => `'${String(x).replace(/'/g, "'\\''")}'`;

function chatCmd(bin, args, left) {
  const run = ['env', 'HOPDECK_SKIP=1', 'HOPDECK_INSIDE=1', bin, ...args].map(sq).join(' ');
  const self = [process.execPath, __filename, '--idle'].map(sq).join(' ');
  const win = (t) => `"$(tmux display -p -t ${t} '#{window_id}')"`;
  return `printf '\\033[38;5;105m»\\033[0m  %s…\\n\\n' ${sq(T.opening)}; ${run}; tmux set-option -p -t "$TMUX_PANE" -u @hopdeck_key; tmux set-option -p -t "$TMUX_PANE" -u @hopdeck_title; ` +
    `[ ${win('"$TMUX_PANE"')} = ${win(sq(left))} ] && tmux select-pane -t ${sq(left)}; exec env HOPDECK_INSIDE=1 ${self}`;
}

function tmuxPanes() {
  return tmux('list-panes', '-a', '-F', '#{pane_id}\t#{@hopdeck_key}').split('\n').filter(Boolean)
    .map((l) => { const [id, key = ''] = l.split('\t'); return { id, key }; });
}

/** Abre (o trae al frente) una conversación en el panel derecho sin matar las demás. */
function launchSlot(project, session) {
  if (!fs.existsSync(project.cwd)) { flash(T.missing + ': ' + shortPath(project.cwd)); return; }
  const bin = findClaude();
  if (!bin) { flash(T.noClaude); return; }
  const mine = process.env.TMUX_PANE;
  const key = session ? session.id : 'new-' + Date.now();
  try {
    const panes = tmuxPanes();
    const slot = tmux('list-panes', '-t', mine, '-F', '#{pane_id}').split('\n').find((id) => id && id !== mine);
    let target = session && (panes.find((x) => x.key === key) || {}).id;
    if (!target) {
      const cmd = chatCmd(bin, [...(session ? ['--resume', session.id] : []), ...extraArgs], mine);
      const slotInfo = panes.find((x) => x.id === slot);
      if (slotInfo && !slotInfo.key) { tmux('respawn-pane', '-k', '-t', slot, '-c', project.cwd, cmd); target = slot; }
      else target = tmux('new-window', '-d', '-P', '-F', '#{pane_id}', '-c', project.cwd, cmd);
      tmux('set-option', '-p', '-t', target, '@hopdeck_key', key);
      tmux('set-option', '-p', '-t', target, '@hopdeck_title', project.name + ' › ' + (session ? session.title : T.newChat));
    }
    if (target !== slot) tmux('swap-pane', '-d', '-s', target, '-t', slot);
    tmux('select-pane', '-t', target);
  } catch (e) { flash(String(e.message).split('\n').filter(Boolean).pop() || 'tmux error'); }
  refreshLive();
}

function refreshLive() {
  try {
    const live = new Set(tmuxPanes().map((x) => x.key).filter(Boolean));
    const k = [...live].sort().join();
    if (k !== S.liveKey) { S.live = live; S.liveKey = k; render(); }
  } catch { /* sin tmux */ }
}

function reloadKeep() {
  const e = flatList()[S.c];
  return reloadAsync(() => {
    if (!e) return;
    const same = (x) => x.t === e.t && x.p.key === e.p.key && (e.t !== 's' || x.s.id === e.s.id);
    const i = flatList().findIndex(same);
    if (i >= 0) S.c = i;
  });
}

function qsItems() {
  const q = S.qs.q.trim(); const items = [];
  for (const p of S.projects) {
    if (p.hidden && !S.showHidden) continue;
    for (const x of p.sessions) { if (CFG.archived.includes(x.id) && !S.showHidden) continue; items.push({ p, s: x }); }
  }
  if (!q) return items.sort((a, b) => b.s.mtime - a.s.mtime).slice(0, 200);
  return items.map((it) => ({ it, sc: fuzzy(q, it.p.name + ' ' + it.s.title + ' ' + it.s.first) })).filter((x) => x.sc >= 0)
    .sort((a, b) => b.sc - a.sc || b.it.s.mtime - a.it.s.mtime).slice(0, 200).map((x) => x.it);
}

function doRename(x, name) {
  name = (name || '').trim();
  if (!x || !name) return;
  if (S.live.has(x.id)) { flash(T.busyRename); return; }
  // Claude Code guarda el título como una línea más del historial
  try { fs.appendFileSync(x.file, JSON.stringify({ type: 'custom-title', customTitle: name, sessionId: x.id }) + '\n'); } catch (e) { flash(String(e.message).split('\n')[0]); return; }
  reloadKeep();
}

function adjustSidebar(d) {
  const cur = EMBED ? embedLayout().SW || 36 : process.stdout.columns || 40;
  const lim = EMBED ? panelLimits(process.stdout.columns || 100) : { min: 24, max: 80 };
  CFG.sidebar = clamp(cur + d, lim.min, lim.max); saveCfg();
  if (EMBED) return embedResize();
  if (SIDEBAR) { try { tmux('resize-pane', '-t', process.env.TMUX_PANE, '-x', String(CFG.sidebar)); } catch { /* */ } render(); }
}

function rememberState() {
  try {
    const e = flatList()[S.c];
    CFG.last = { open: S.open, e: e ? { t: e.t, pk: e.p.key, sid: e.s && e.s.id } : null };
    saveCfg();
  } catch { /* */ }
}

function restoreState() {
  const l = CFG.last; if (!l || !S.projects.some((p) => p.key === l.open)) return;
  S.open = l.open;
  if (l.e) {
    const i = flatList().findIndex((x) => x.t === l.e.t && x.p.key === l.e.pk && (l.e.t !== 's' || x.s.id === l.e.sid));
    if (i >= 0) S.c = i;
  }
}

/** Abre una conversación nueva en una carpeta cualquiera (acepta ~ y rutas relativas). */
/** Abre la caja de texto inferior (nombre de carpeta / renombrar) con el cursor al final. */
function setPrompt(text, kind) { S.prompt = text; S.promptKind = kind; S.pc = [...text].length; }
/** Texto con el cursor dibujado en `pos` (para las cajas de entrada). */
const withCursor = (str, pos, on = true) => { const a = [...str], i = clamp(Number.isFinite(pos) ? pos : a.length, 0, a.length); return [[a.slice(0, i).join(''), C.text], [on ? '▏' : '', C.accent], [a.slice(i).join(''), C.text]]; };


/** Carpeta base para nombres sueltos: la que se está viendo en el selector (por defecto ~). */
const newFolderBase = () => (S.fb && S.fb.dir ? S.fb.dir : os.homedir());

// ── Selector de carpetas: se navega con flechas desde ~ y se elige dónde abrir el chat ──
const FB_SKIP = new Set(['AppData', 'Application Data', 'Local Settings', 'Cookies', 'NetHood', 'PrintHood', 'Recent', 'SendTo', 'Start Menu', 'Templates', 'node_modules', '$Recycle.Bin', 'System Volume Information']);
function listDrives() { // Windows: letras de unidad disponibles
  const out = [];
  for (let c = 65; c <= 90; c++) { const r = String.fromCharCode(c) + ':\\'; try { if (fs.existsSync(r)) out.push(r); } catch { /* */ } }
  return out;
}
/** Subcarpetas visibles de `dir` (ocultas y carpetas de sistema solo si `hid`). dir === '' → unidades de Windows. */
function fbNames(dir, hid) {
  if (dir === '') return listDrives();
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => {
        if (hid ? false : (d.name.startsWith('.') || FB_SKIP.has(d.name))) return false;
        if (d.isDirectory()) return true;
        if (d.isSymbolicLink()) { try { return fs.statSync(path.join(dir, d.name)).isDirectory(); } catch { return false; } }
        return false;
      })
      .map((d) => d.name).sort((x, y) => x.localeCompare(y));
  } catch { return []; /* sin permiso */ }
}
const fbPath = (f, n) => (f.dir === '' ? n : path.join(f.dir, n));
const fbCanUp = (f) => f.dir !== '' && (path.dirname(f.dir) !== f.dir || WIN);
function fbOpen(dir, sel) {
  const hid = S.fb ? S.fb.hid : false;
  S.fb = { dir, names: fbNames(dir, hid), i: 0, off: 0, hid, q: '', qp: 0, filt: false };
  const rows = fbRows(), j = sel ? rows.findIndex((r) => r.k === 'dir' && r.n === sel) : -1;
  S.fb.i = j >= 0 ? j : 0;
}
function fbRows() {
  const f = S.fb, r = [];
  if (f.dir !== '') r.push({ k: 'here' }, { k: 'new' });
  if (fbCanUp(f)) r.push({ k: 'up' });
  if (f.dir === os.homedir() && !f.q) {
    for (const x of (Array.isArray(CFG.recent) ? CFG.recent : [])) {
      if (r.filter((y) => y.k === 'recent').length >= 5) break;
      if (x && x.dir && x.dir !== f.dir && fs.existsSync(x.dir)) r.push({ k: 'recent', dir: x.dir });
    }
  }
  const q = f.q.toLowerCase(), ds = f.names.filter((n) => !q || n.toLowerCase().includes(q));
  for (const n of ds) r.push({ k: 'dir', n });
  if (!ds.length && f.dir !== '') r.push({ k: 'none' });
  return r;
}
function fbActivate() {
  const f = S.fb, r = fbRows()[f.i]; if (!r || r.k === 'none') return;
  if (r.k === 'here') return openFolder(f.dir);
  if (r.k === 'new') { setPrompt('', 'folder'); return render(); }
  if (r.k === 'recent') return openFolder(r.dir);
  if (r.k === 'up') { const par = path.dirname(f.dir); if (par === f.dir) fbOpen('', f.dir); else fbOpen(par, path.basename(f.dir)); }
  else fbOpen(fbPath(f, r.n));
  render();
}
/** Espacio: abrir el chat en la carpeta resaltada (sin entrar en ella). */
function fbChoose() {
  const f = S.fb, r = fbRows()[f.i]; if (!r || r.k === 'none') return;
  if (r.k === 'dir') return openFolder(fbPath(f, r.n));
  if (r.k === 'up') return openFolder(path.dirname(f.dir));
  return fbActivate();
}
function fbUp() { const f = S.fb; if (!fbCanUp(f)) return; const par = path.dirname(f.dir); if (par === f.dir) fbOpen('', f.dir); else fbOpen(par, path.basename(f.dir)); }
function fbKey(k, raw) {
  const f = S.fb;
  if (f.filt) { // escribiendo un filtro
    const n = fbRows().length;
    if (k === 'esc') { f.filt = false; f.q = ''; f.i = 0; }
    else if (k === 'enter') { f.filt = false; f.i = clamp(f.i, 0, n - 1); }
    else if (k === 'up') f.i = Math.max(0, f.i - 1);
    else if (k === 'down') f.i = Math.min(n - 1, f.i + 1);
    else { const r = editBuf(f.q, f.qp, k, raw); if (r) { const ch = r.s !== f.q; f.q = r.s; f.qp = r.pos; if (ch) { const j = fbRows().findIndex((x) => x.k === 'dir'); f.i = f.q && j >= 0 ? j : 0; } } } // al filtrar, la selección salta a la primera coincidencia
    return render();
  }
  const n = fbRows().length;
  if (k === 'esc') { if (f.q) { f.q = ''; f.i = 0; } else S.fb = null; }
  else if (k === 'q') S.fb = null;
  else if (k === 'up' || k === 'k') f.i = Math.max(0, f.i - 1);
  else if (k === 'down' || k === 'j') f.i = Math.min(n - 1, f.i + 1);
  else if (k === 'pgup') f.i = Math.max(0, f.i - 8);
  else if (k === 'pgdn') f.i = Math.min(n - 1, f.i + 8);
  else if (k === 'home' || k === 'g') f.i = 0;
  else if (k === 'end' || k === 'G') f.i = n - 1;
  else if (k === 'left' || k === 'h' || k === 'bs') fbUp();
  else if (k === 'enter' || k === 'right' || k === 'l') return fbActivate();
  else if (k === ' ') return fbChoose();
  else if (k === 'n' && f.dir !== '') setPrompt('', 'folder');
  else if (k === '/') { f.filt = true; f.qp = [...f.q].length; }
  else if (k === '.') { const sel = (fbRows()[f.i] || {}).n; f.hid = !f.hid; f.names = fbNames(f.dir, f.hid); f.i = Math.max(0, fbRows().findIndex((r) => r.k === 'dir' && r.n === sel)); f.off = 0; }
  else if (k === '~') fbOpen(os.homedir());
  render();
}

function recordFolder(d) {
  CFG.recent = [{ dir: d, t: Date.now() }, ...(Array.isArray(CFG.recent) ? CFG.recent : []).filter((x) => x && x.dir !== d)].slice(0, 12);
  saveCfg();
}

function openFolder(txt) {
  const t = txt.trim().replace(/^~(?=$|[\\/])/, os.homedir());
  // un nombre suelto ("mi-app") o ruta relativa se crea junto a tus otros proyectos; rutas completas, "~" y "./" funcionan igual que antes
  const d = path.isAbsolute(t) || /^\.\.?([\\/]|$)/.test(t) ? path.resolve(t) : path.resolve(newFolderBase(), t);
  let ok = false; try { ok = fs.statSync(d).isDirectory(); } catch { /* no existe */ }
  if (!txt.trim()) { flash(T.missing + ': ' + shortPath(d)); return; }
  if (!ok) { // carpeta nueva: Enter otra vez la crea (con confirmación para no crear carpetas por un error de tecleo)
    if (S.confirmMk !== d) { S.confirmMk = d; setPrompt(txt, 'folder'); flash(T.mkAsk + ': ' + baseName(d)); return; }
    S.confirmMk = null;
    try { fs.mkdirSync(d, { recursive: true }); } catch (e) { flash(T.mkFail + ': ' + String(e.message).split('\n')[0]); return; }
  }
  S.fb = null; recordFolder(d);
  const proj = S.projects.find((p) => p.cwd === d) || { key: '__open', cwd: d, name: baseName(d), sessions: [], mtime: Date.now() };
  launch(proj, null);
}

function onKeyTree(raw) {
  const k = KEYMAP[raw] || raw;
  const L = flatList(); const e = L[S.c];
  const top = () => { const i = flatList().findIndex((x) => x.t === 'p' && x.p === e.p); if (i >= 0) S.c = i; };
  if (k === 'ctrlc') return quit();
  if (k === 'focus') return reloadKeep();
  if (k === 'f6') { const key = EMBED ? E.shown : null; return key ? closeChat(key) : flash(T.notOpen); }
  if (k === 'f2') { if (EMBED && E.sessions.has(E.shown)) { E.focus = 'right'; render(); } return; }
  if (k === 'f1') return;
  if (S.help) { S.help = false; return render(); }
  if (k === 'ctrlp' || k === 'f5') { S.qs = S.qs ? null : { q: '', pc: 0, i: 0, off: 0 }; return render(); }
  if (S.qs) {
    const items = qsItems();
    if (k === 'esc') S.qs = null;
    else if (k === 'enter') {
      const it = items[S.qs.i]; S.qs = null;
      if (it) {
        S.open = it.p.key; S.query = ''; queryChanged();
        const i = flatList().findIndex((x) => x.t === 's' && x.s.id === it.s.id); if (i >= 0) S.c = i;
        render(); return launch(it.p, it.s);
      }
    }
    else if (k === 'up') S.qs.i = Math.max(0, S.qs.i - 1);
    else if (k === 'down') S.qs.i = Math.min(items.length - 1, S.qs.i + 1);
    else { const r = editBuf(S.qs.q, S.qs.pc, k, raw); if (r) { if (r.s !== S.qs.q) S.qs.i = 0; S.qs.q = r.s; S.qs.pc = r.pos; } }
    return render();
  }
  if (S.prompt !== null) {
    if (k === 'esc') S.prompt = null;
    else if (k === 'enter') {
      const t = S.prompt, kind = S.promptKind, tgt = S.renameTarget; S.prompt = null; render();
      return kind === 'rename' ? doRename(tgt, t) : openFolder(t);
    }
    else { const r = editBuf(S.prompt, S.pc, k, raw); if (r) { S.prompt = r.s; S.pc = r.pos; } }
    return render();
  }
  if (S.fb) return fbKey(k, raw);
  if (S.searching) {
    if (k === 'esc') { S.query = ''; S.searching = false; S.c = 0; queryChanged(); }
    else if (k === 'enter') {
      S.searching = false;
      const en = L[S.c]; // con una conversación marcada, ⏎ la abre ya (como el salto rápido); sobre un proyecto solo termina de escribir
      if (en && en.t === 's') { render(); return launch(en.p, en.s); }
    }
    else if (k === '\t') { S.deep = !S.deep; queryChanged(); }
    else if (k === 'up') S.c = Math.max(0, S.c - 1);
    else if (k === 'down') S.c = Math.min(L.length - 1, S.c + 1);
    else {
      const r = editBuf(S.query, S.qpos, k, raw);
      if (r) {
        const ch = r.s !== S.query; S.query = r.s; S.qpos = r.pos;
        if (ch) { queryChanged(); const i = flatList().findIndex((x) => x.t === 's'); S.c = S.query.trim() && i >= 0 ? i : 0; } // se marca el primer resultado
      }
    }
    return render();
  }
  S.flash = '';
  switch (k) {
    case 'q': return quit();
    case 'up': case 'k': S.c = Math.max(0, S.c - 1); break;
    case 'down': case 'j': S.c = Math.min(L.length - 1, S.c + 1); break;
    case 'pgup': S.c = Math.max(0, S.c - 8); break;
    case 'pgdn': S.c = Math.min(L.length - 1, S.c + 8); break;
    case 'home': case 'g': S.c = 0; break;
    case 'end': case 'G': S.c = Math.max(0, L.length - 1); break;
    case 'enter': case 'right': case 'l':
      if (!e) break;
      if (e.t === 'p') { S.open = (e.open && k === 'enter') ? null : e.p.key; top(); }
      else if (e.t === 'm') { S.more.add(e.p.key); }
      else if (e.t === 'l') { const x = E.sessions.get(e.key); if (x) { x.unseen = false; E.shown = e.key; E.focus = 'right'; } return render(); }
      else return launch(e.p, e.t === 's' ? e.s : null);
      break;
    case 'left': case 'h':
      if (!e) break;
      if (e.t !== 'p') top(); else { S.open = null; top(); }
      break;
    case 'n': if (e) return launch(e.p, null); break;
    case '/': S.searching = true; S.qpos = [...S.query].length; break;
    case 'r': reloadKeep(); return;
    case '?': S.help = true; break;
    case 'o': fbOpen(os.homedir()); break;
    case 'R': if (e && e.t === 's') { setPrompt(e.s.title, 'rename'); S.renameTarget = e.s; } break;
    case 'a':
      if (e && e.t === 's') {
        const i = CFG.archived.indexOf(e.s.id);
        if (i >= 0) CFG.archived.splice(i, 1); else CFG.archived.push(e.s.id);
        saveCfg(); S.flash = i >= 0 ? T.unarchMsg : T.archMsg;
      }
      break;
    case 'c': {
      const key = e && e.t === 's' && S.live.has(e.s.id) ? (chatKeyOf(e.s.id) || e.s.id) : e && e.t === 'l' ? e.key : EMBED ? E.shown : null;
      return key ? closeChat(key) : flash(T.notOpen);
    }
    case 't': case 'f9': return toggleTheme(); // tema claro/oscuro en caliente
    case 'b': return toggleGit(); // panel de git (F8 en macOS pide Fn: por defecto son las teclas multimedia)
    case 'i': case 'f7':
      if (e && e.t === 's') {
        if (EMBED) return openGallery(e.p.name, e.s);
        imagesOf(e.s).then((imgs) => { // con tmux no hay panel propio: se abren en el visor del sistema
          if (!imgs.length) return flash(T.noImages);
          openExternal(exportImages(imgs).dir); flash(T.imgFolder);
        });
      } else if (EMBED) return openGalleryShown();
      break;
    case '[': return adjustSidebar(-4);
    case ']': return adjustSidebar(4);
    case 'H': S.showHidden = !S.showHidden; break;
    case 'p': case 'x':
      if (e) {
        const pr = e.p, f = k === 'p' ? 'pinned' : 'hidden';
        toggleProject(pr, f);
        const i = flatList().findIndex((x) => x.t === 'p' && x.p === pr);
        if (i >= 0) S.c = i;
        S.flash = f === 'hidden' ? (pr.hidden ? T.hiddenMsg : '') : (pr.pinned ? T.pinMsg : '');
      }
      break;
    case 'esc': if (S.query) { S.query = ''; S.c = 0; queryChanged(); } break;
    default: break;
  }
  render();
}

function idle() {
  const draw = () => {
    const c = process.stdout.columns || 80, r = process.stdout.rows || 24;
    const rows = [[C.brand + C.bold, '» Hop\u0001deck'], [C.text, T.idle1], [C.dim, T.idle2], ['', ''], [C.dim, T.idle3]];
    let out = '\x1b[2J\x1b[?25l';
    const art = mascotArt(c, r - rows.length - 2), gap = art.length ? 1 : 0; // el panel de tmux también lleva la mascota, si cabe
    const top = art.length ? Math.max(1, Math.floor((r - art.length - gap - rows.length) / 2) + 1) : Math.max(1, Math.floor(r / 2) - 2);
    art.forEach((_, j) => { out += `\x1b[${top + j};1H${mascotRow(art, j, c)}`; });
    rows.forEach(([st, t], i) => { out += `\x1b[${top + art.length + gap + i};${Math.max(1, Math.floor((c - strW(t.replace('\u0001', ''))) / 2) + 1)}H${st}${paintMark(t)}${R}`; });
    process.stdout.write(out);
  };
  draw(); process.stdout.on('resize', draw);
  const bye = () => { process.stdout.write('\x1b[?25h'); process.exit(0); };
  process.on('SIGTERM', bye); process.on('SIGHUP', bye);
  setInterval(() => { /* mantiene vivo el panel */ }, 1 << 30);
}

function hasTmux() { try { return cp.spawnSync('tmux', ['-V'], { stdio: 'ignore' }).status === 0; } catch { return false; } }

/** Crea (o reabre) la sesión tmux: panel lateral con el hub + panel derecho para los chats. */
function bootstrap() {
  const cols = process.stdout.columns || 120, rows = process.stdout.rows || 32;
  const sock = ['-L', 'hopdeck'];
  let confDir = null; // carpeta privada y aleatoria: un nombre fijo en /tmp permitiría que otro usuario del equipo colara su configuración
  const has = cp.spawnSync('tmux', [...sock, 'has-session', '-t', 'hopdeck'], { stdio: 'ignore' }).status === 0;
  if (!has) {
    confDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hopdeck-tmux-'));
    const conf = path.join(confDir, 'tmux.conf');
    fs.writeFileSync(conf, [
      'set -g default-shell /bin/sh', 'set -g mouse on', 'set -g escape-time 10', 'set -g history-limit 50000',
      'set -g focus-events on', 'set -g default-terminal "screen-256color"', 'set -ga terminal-overrides ",*:Tc"',
      'set -g status on', 'set -g status-style "bg=default,fg=colour244"', 'set -g status-left ""', 'set -g status-right-length 120',
      `set -g status-right "#[fg=colour105]F1#[fg=colour244] ${T.bar1}   #[fg=colour105]F2#[fg=colour244] ${T.bar2}   #[fg=colour105]Ctrl+b d#[fg=colour244] ${T.bar3} "`,
      'setw -g window-status-format ""', 'setw -g window-status-current-format ""',
      'set -g pane-border-status top',
      'set -g pane-border-format "#{?@hopdeck_title, #[fg=colour105#,bold]#{@hopdeck_title}#[default] ,}"',
      'set -g pane-border-style "fg=colour239"', 'set -g pane-active-border-style "fg=colour105"',
      'bind -n F1 select-pane -L', 'bind -n F2 select-pane -R', '',
    ].join('\n'));
    const me = [process.execPath, __filename];
    const t = (...a) => cp.execFileSync('tmux', [...sock, ...a], { encoding: 'utf8' }).trim();
    const right = t('-f', conf, 'new-session', '-d', '-s', 'hopdeck', '-x', String(cols), '-y', String(rows), '-P', '-F', '#{pane_id}',
      ['env', 'HOPDECK_INSIDE=1', ...me, '--idle'].map(sq).join(' '));
    try { fs.rmSync(confDir, { recursive: true, force: true }); } catch { /* */ } // tmux ya leyó la configuración
    const sw = CFG.sidebar ? clamp(CFG.sidebar, 24, 80) : clamp(Math.floor(cols * 0.3), 38, 46);
    const left = t('split-window', '-hb', '-t', right, '-l', String(sw), '-P', '-F', '#{pane_id}',
      ['env', 'HOPDECK_INSIDE=1', ...me, '--sidebar', ...extraArgs].map(sq).join(' '));
    t('select-pane', '-t', left);
  }
  cp.spawnSync('tmux', [...sock, 'attach', '-t', 'hopdeck'], { stdio: 'inherit' });
}

// ───────────────────────── modo embebido (PowerShell / sin tmux) ─────────────────────────
// Un terminal virtual (xterm headless + PTY) dibujado dentro del panel derecho.
function loadDeps() {
  try { return { pty: require('@lydell/node-pty'), Terminal: require('@xterm/headless').Terminal }; } catch { return null; }
}

/** Límites de un panel lateral al arrastrar su borde con el ratón: del 15 % al 50 % del ancho (y nunca menos de 20 columnas). */
const panelLimits = (W) => ({ min: Math.min(Math.max(20, Math.round(W * 0.15)), Math.floor(W * 0.5)), max: Math.max(20, Math.floor(W * 0.5)) });
/** Ancho de la lista (panel izquierdo): el guardado por el usuario, o 30 % del terminal por defecto. */
const sideWidth = (W) => (E.hideSide ? 0 : CFG.sidebar ? clamp(CFG.sidebar, panelLimits(W).min, panelLimits(W).max) : clamp(Math.floor(W * 0.3), 36, 46));
/** Ancho del panel de git (derecho): el guardado por el usuario, o GIT_W por defecto. */
const gitWidth = (W) => (CFG.gitw ? clamp(CFG.gitw, panelLimits(W).min, panelLimits(W).max) : GIT_W);

function embedLayout() {
  const W = process.stdout.columns || 100, H = process.stdout.rows || 30;
  const SW = sideWidth(W);
  const room = Math.max(10, W - SW - (SW ? 1 : 0));
  const gw = gitWidth(W);
  const GW = E.git && room - gw - 1 >= GIT_MIN_CHAT ? gw : 0; // tercer panel (git): solo si el chat conserva un ancho cómodo
  return { W, H, SW, GW, rw: GW ? room - GW - 1 : room, rh: Math.max(3, H - 1), th: Math.max(3, H - 3) };
}

/**
 * Arrastre de una línea divisoria: `x` es la columna (desde 1) donde está el ratón. La lista ocupa las columnas anteriores
 * a la línea y el panel de git las posteriores. El chat conserva siempre su ancho mínimo, así el panel de git no desaparece.
 */
function dragPanel(which, x) {
  const { W, SW, GW } = embedLayout(), l = panelLimits(W);
  if (which === 'side') {
    const hi = Math.max(l.min, Math.min(l.max, W - 1 - (GW ? GW + 1 + GIT_MIN_CHAT : 40)));
    const n = clamp(x - 1, l.min, hi);
    if (n === SW) return;
    CFG.sidebar = n;
  } else {
    const hi = Math.max(l.min, Math.min(l.max, W - (SW ? SW + 1 : 0) - 1 - GIT_MIN_CHAT));
    const n = clamp(W - x, l.min, hi);
    if (n === GW) return;
    CFG.gitw = n;
  }
  embedResize();
}

// ───────────────────────── panel de git (tercer panel, F8) ─────────────────────────
const GIT_W = 38, GIT_MIN_CHAT = 60;
const GITC = new Map(); // carpeta → { t, loading, data }
/** Estado de git de la carpeta, de la caché; si tiene más de 4 s se vuelve a leer en segundo plano. */
function gitInfo(cwd) {
  const hit = GITC.get(cwd), now = Date.now();
  if (hit && (hit.loading || now - hit.t < 4000)) return hit.data;
  GITC.set(cwd, { t: hit ? hit.t : 0, loading: true, data: hit ? hit.data : null });
  gitlib.readGit(cwd).then((data) => { GITC.set(cwd, { t: Date.now(), loading: false, data }); if (active && E.git) scheduleRender(); });
  return hit ? hit.data : null;
}
const gitCwd = () => {
  const sh = E.sessions.get(E.shown);
  if (sh && sh.cwd) return sh.cwd;
  const e = !S.help && !S.qs ? flatList()[S.c] : null;
  return e && e.p ? e.p.cwd : null;
};
function toggleGit() {
  if (!EMBED) return flash(T.gitOnlyEmbed);
  if (!E.git) {
    const W = process.stdout.columns || 100, SW = sideWidth(W);
    const need = SW + (SW ? 1 : 0) + GIT_MIN_CHAT + gitWidth(W) + 1;
    if ((process.stdout.columns || 100) < need) return flash(T.gitNarrow(need));
  }
  E.git = !E.git; CFG.git = E.git; saveCfg();
  embedResize();
}
/** Las `rh` filas del panel de git: título, línea y contenido (rama, cambios, ramas recientes, actividad de ramas). */
function gitRows(GW, rh) {
  const cwd = gitCwd(), d = cwd ? gitInfo(cwd) : null;
  const out = [fit([[' ⎇ Git', C.accent + C.bold], [cwd ? '  ' + baseName(cwd) : '', C.dim]], GW), C.faint + '─'.repeat(GW) + R];
  const body = [], line = (...segs) => body.push(segs);
  const row = (left, right, rc) => body.push({ left, right, rc });
  if (!cwd) line([' ' + T.gitNone, C.dim]);
  else if (!d) line([' ' + spin() + ' …', C.accent]);
  else if (!d.ok) { line([' ' + (d.missing ? T.gitMissing : d.repo ? T.gitErr : T.gitNoRepo), C.dim]); if (d.err && d.repo && !d.missing) line([' ' + d.err, C.faint]); }
  else {
    const s = d.status, n = s.files.length, now = Date.now();
    line([' ', ''], [(s.detached ? '⌀ ' : '⎇ ') + s.branch, C.brand + C.bold], [s.ahead ? '  ↑' + s.ahead : '', C.ok], [s.behind ? '  ↓' + s.behind : '', C.warn]);
    line(n ? [' ● ', C.warn] : [' ✔ ', C.ok], [n ? T.gitDirty(n) : T.gitClean, n ? C.warn : C.dim]);
    const room = Math.max(0, Math.min(6, rh - 2 - 14));
    for (const f of s.files.slice(0, room)) {
      const code = f.x === '?' ? '?' : f.x !== ' ' ? f.x : f.y;
      line(['   ', ''], [code + ' ', code === 'D' ? C.brand : code === 'M' ? C.warn : C.ok], [f.path, C.text]);
    }
    if (n > room && room > 0) line(['   ', ''], [T.gitMore(n - room), C.dim]);
    body.push(null);
    line([' ' + T.gitBranches, C.dim + C.bold]);
    for (const b of d.branches.slice(0, 5)) row([[b.cur ? '  ● ' : '    ', b.cur ? C.ok : ''], [b.name, b.cur ? C.text + C.bold : C.text]], b.t ? ago(b.t * 1000) : '');
    body.push(null);
    line([' ' + T.gitActivity, C.dim + C.bold]);
    if (!d.activity.length) line(['   ' + T.gitNoActivity, C.dim]);
    for (const a of d.activity) {
      const fresh = now - a.t * 1000 < 10 * 60 * 1000, mark = [fresh ? '  ● ' : '    ', fresh ? C.brand : ''];
      const txt = a.k === 'switch' ? [[a.from, C.dim], [' → ', C.accent], [a.to, C.text]]
        : a.k === 'create' ? [['+ ', C.ok], [a.name, C.text], ...(a.from !== 'HEAD' && strW(a.name) + strW(a.from) + strW(T.gitFrom) + 19 <= GW ? [[' ' + T.gitFrom + ' ' + a.from, C.dim]] : [])]
        : a.k === 'merge' ? [['⇄ merge ', C.accent], [a.what, C.text]] : [['↻ rebase', C.accent]];
      row([mark, ...txt], ago(a.t * 1000));
    }
  }
  for (const b of body) {
    if (out.length >= rh) break;
    if (b === null) out.push(' '.repeat(GW));
    else if (Array.isArray(b)) out.push(fit(b, GW));
    else { const rw = strW(b.right) + 1; out.push(fit(b.left, GW - rw) + fit([[b.right, b.rc || C.dim], [' ', '']], rw)); }
  }
  while (out.length < rh) out.push(' '.repeat(GW));
  return out;
}

function sgr(c, fgMode) {
  const base = fgMode ? 30 : 40;
  const isDef = fgMode ? c.isFgDefault() : c.isBgDefault();
  if (isDef) return '';
  const v = fgMode ? c.getFgColor() : c.getBgColor();
  if (fgMode ? c.isFgRGB() : c.isBgRGB()) return `;${base + 8};2;${(v >> 16) & 255};${(v >> 8) & 255};${v & 255}`;
  if (v < 8) return `;${base + v}`;
  if (v < 16) return `;${base + 60 + v - 8}`;
  return `;${base + 8};5;${v}`;
}

function termRow(term, y, width, sel, from = 0) {
  const buf = term.buffer.active;
  const line = buf.getLine(buf.viewportY + y);
  let out = '', used = 0, last = null;
  if (line) {
    const cell = buf.getNullCell();
    for (let x = from; x < from + width && x < term.cols; x++) {
      const c = line.getCell(x, cell);
      if (!c) break;
      const w = c.getWidth();
      if (w === 0) continue;
      const ch = c.getChars() || ' ';
      if (used + w > width) break;
      const inSel = sel && x >= sel[0] && x <= sel[1];
      const st = (inSel && !c.isInverse() ? ';7' : '') + (c.isBold() ? ';1' : '') + (c.isDim() ? ';2' : '') + (c.isItalic() ? ';3' : '') + (c.isUnderline() ? ';4' : '') +
        (c.isInverse() ? ';7' : '') + (c.isInvisible() ? ';8' : '') + (c.isStrikethrough() ? ';9' : '') + sgr(c, true) + sgr(c, false);
      if (st !== last) { out += '\x1b[0m' + (st ? '\x1b[' + st.slice(1) + 'm' : ''); last = st; }
      out += ch; used += w;
    }
  }
  return out + '\x1b[0m' + ' '.repeat(Math.max(0, width - used));
}

/** Texto con la marca en dos colores: \u0001 separa "Hop" (color de marca) de "deck" (color del texto). */
const paintMark = (t) => t.replace('\u0001', R + C.text + C.bold);

/** La mascota, del mayor tamaño que quepa (en `width` columnas y `rows` filas); nada si no cabe ni la más pequeña o si no hay colores. */
function mascotArt(width, rows) {
  if (NOCOL) return [];
  const n = mascot.sizeFor(width - 2, rows);
  return n ? mascot.render(n) : [];
}

/** Una fila de la mascota centrada en `width` columnas. */
function mascotRow(art, j, width) {
  const n = art.length * 2, pad = Math.max(0, Math.floor((width - n) / 2));
  return ' '.repeat(pad) + art[j] + ' '.repeat(Math.max(0, width - pad - n));
}

function idleRow(y, width, height) {
  const k = T.k;
  const rows = [[C.brand + C.bold, '» Hop\u0001deck'], [C.text, T.idle1], [C.dim, T.idle2], ['', ''], [C.accent, `⏎ ${k.resume}   n ${k.neu}   / ${k.find}   ? ${T.kHelp}`], [C.dim, T.idle3]];
  const art = mascotArt(width, height - rows.length - 2); // la mascota va encima del texto, si cabe
  const gap = art.length ? 1 : 0;
  const start = art.length ? Math.floor((height - art.length - gap - rows.length) / 2) : Math.floor(height / 2) - 2;
  const j = y - start;
  if (j >= 0 && j < art.length) return mascotRow(art, j, width);
  const i = j - art.length - gap;
  if (i < 0 || i >= rows.length) return ' '.repeat(width);
  const [st, t] = rows[i];
  const vis = t.replace('\u0001', ''), pad = Math.max(0, Math.floor((width - strW(vis)) / 2));
  return ' '.repeat(pad) + st + paintMark(t) + R + ' '.repeat(Math.max(0, width - pad - strW(vis)));
}

function loaderRow(y, width, height, title) {
  const rows = [[C.accent + C.bold, spin() + '  ' + T.opening + '…'], [C.dim, title]];
  const i = y - (Math.floor(height / 2) - 1);
  if (i < 0 || i >= rows.length) return ' '.repeat(width);
  const [st, t0] = rows[i];
  const t = strW(t0) > width - 2 ? t0.slice(0, Math.max(0, width - 3)) + '…' : t0;
  const pad = Math.max(0, Math.floor((width - strW(t)) / 2));
  return ' '.repeat(pad) + st + t + R + ' '.repeat(Math.max(0, width - pad - strW(t)));
}

// ───────────────────────── imágenes de las conversaciones ─────────────────────────
// Claude Code guarda las imágenes adjuntas como bloques base64 dentro del historial. Se muestran con
// "medios bloques" (▀: dos píxeles por celda), que funciona en cualquier terminal con color.
const IMG = new Map(); // archivo → { m, images }

const maxImages = () => (CFG.maxImages > 0 ? CFG.maxImages : 200); // configurable en ~/.hopdeck.json
const previewMsgs = () => (CFG.previewMsgs > 0 ? CFG.previewMsgs : 12);
const extractImages = (file) => images.extractImages(file, maxImages());

async function imagesOf(x) {
  const hit = IMG.get(x.file);
  if (hit && hit.m === x.mtime) return hit.images;
  const images = await extractImages(x.file);
  IMG.set(x.file, { m: x.mtime, images });
  return images;
}

/** Abre un archivo o carpeta con el programa por defecto del sistema. */
function openExternal(target) {
  if (process.env.HOPDECK_OPEN_LOG) { try { fs.appendFileSync(process.env.HOPDECK_OPEN_LOG, target + '\n'); } catch { /* */ } return; } // pruebas: no se abre ningún visor
  const quiet = (cmd, args) => { try { const c = cp.spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }); c.on('error', () => {}); c.unref(); } catch { /* */ } };
  if (WIN) quiet('cmd', ['/c', 'start', '', target]);
  else if (process.platform === 'darwin') quiet('open', [target]);
  else if (process.env.WSL_DISTRO_NAME) { try { quiet('explorer.exe', [cp.execFileSync('wslpath', ['-w', target], { encoding: 'utf8' }).trim()]); } catch { quiet('xdg-open', [target]); } }
  else quiet('xdg-open', [target]);
}

/**
 * Extensión de una imagen según sus primeros bytes (no según el "media_type" del historial, que no es de fiar:
 * un resultado de herramienta podría declarar "image/exe" y acabaría guardado y abierto como programa).
 * Devuelve null si no es un formato de imagen conocido.
 */
function imageExt(im) {
  const b = Buffer.from(String(im.data).slice(0, 64), 'base64');
  if (b.length >= 4 && b.readUInt32BE(0) === 0x89504e47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  return null;
}

const EXPORT_DIRS = new Set();
/** Guarda las imágenes en una carpeta temporal privada (aleatoria, solo del usuario) y devuelve sus rutas. */
function exportImages(images) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hopdeck-images-')); EXPORT_DIRS.add(dir);
  return { dir, files: images.map((im, i) => {
    const ext = imageExt(im), f = path.join(dir, `imagen-${i + 1}.${ext || 'bin'}`);
    fs.writeFileSync(f, Buffer.from(im.data, 'base64'), { mode: 0o600 });
    return ext ? f : null; // lo que no es una imagen reconocible se guarda como .bin y no se abre
  }) };
}
function cleanExports() { for (const d of EXPORT_DIRS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } } EXPORT_DIRS.clear(); }

async function openGallery(project, x) {
  const g = { project, title: x.title, file: x.file, id: x.id, images: [], i: 0, loading: true, pending: false, dec: new Map(), cache: new Map() };
  E.gallery = g; ensureSpin(); render();
  try { g.images = await imagesOf(x); } catch { g.images = []; }
  g.loading = false; render();
}

/** Galería del chat abierto: si es nuevo, su archivo es la sesión más reciente del proyecto. */
async function shownSession(x) {
  let sess = x.sid && S.projects.flatMap((p) => p.sessions).find((q) => q.id === x.sid);
  if (!sess) {
    await reloadAsync(null, true);
    const p = S.projects.find((q) => q.cwd === x.cwd);
    // un chat nuevo aún sin enlazar: solo vale una conversación creada después de abrirlo. Usar "la más reciente del proyecto"
    // podía mostrar la imagen de OTRA conversación cuando coincidía el número
    sess = p && p.sessions.find((q) => q.mtime >= (x.t0 || 0) - 2000);
  }
  return sess;
}

// ── Imágenes reales (Sixel): se usan si el terminal las admite; si no, la vista rápida con medios bloques ──
/** HOPDECK_SIXEL=1 las fuerza, =0 las apaga; sin definir, se usan si el terminal dijo que las admite (consulta DA1 al arrancar). */
// En Windows Terminal (1.22+) la respuesta del terminal no siempre atraviesa ConPTY, así que ahí se activa sin esperarla.
const sixelOn = () => process.env.HOPDECK_SIXEL === '1' || (process.env.HOPDECK_SIXEL !== '0' && (E.sixelDetected || (WIN && !!process.env.WT_SESSION)));

/**
 * Quita de la entrada las respuestas del terminal a nuestras consultas y las guarda en `st`:
 * DA1 (ESC [ ? 61;4;… c): el atributo 4 significa que admite Sixel; y el tamaño en píxeles de una celda (ESC [ 6 ; alto ; ancho t).
 */
function parseTermReplies(s, st) {
  return s
    .replace(/\x1b\[\?([0-9;]*)c/g, (m, attrs) => { st.sixelDetected = attrs.split(';').includes('4'); return ''; })
    .replace(/\x1b\[6;(\d+);(\d+)t/g, (m, hh, ww) => { const h = +hh, w = +ww; if (h >= 4 && h <= 200 && w >= 2 && w <= 100) st.cell = { w, h }; return ''; });
}

/** Secuencia que coloca el cursor y dibuja la imagen. Con HOPDECK_SIXEL_LOG (pruebas) la ruta y los datos se anotan en un archivo y no se escribe nada. */
function emitSixel(row, col, data) {
  if (process.env.HOPDECK_SIXEL_LOG) { try { fs.appendFileSync(process.env.HOPDECK_SIXEL_LOG, JSON.stringify({ row, col, data }) + '\n'); } catch { /* */ } return ''; }
  return `\x1b[${row};${col}H` + data;
}

/** Texto de una fila del terminal virtual y la columna de cada carácter (los de ancho 2 ocupan dos celdas). */
function rowChars(term, y) {
  const b = term.buffer.active, line = b.getLine(b.viewportY + y), cols = []; let text = '';
  if (!line) return { text, cols };
  const cell = b.getNullCell();
  for (let x = 0; x < term.cols; x++) {
    const c = line.getCell(x, cell); if (!c) break;
    if (c.getWidth() === 0) continue;
    const ch = c.getChars() || ' ';
    for (let i = 0; i < ch.length; i++) cols.push(x);
    text += ch;
  }
  return { text, cols };
}

/** ¿Hay un "[Image #N]" bajo la columna `col` de la fila `y`? Devuelve { n, x } o null. Tolera espacios no separables y caracteres anchos antes de la marca. */
function imageMarkerAt(term, y, col) {
  const { text, cols } = rowChars(term, y);
  for (const m of text.matchAll(/\[Image\s*#(\d+)\]/g)) {
    const x0 = cols[m.index], x1 = cols[m.index + m[0].length - 1];
    if (col >= x0 && col <= x1) return { n: +m[1], x: x0 };
  }
  return null;
}

async function openGalleryShown() {
  const x = E.sessions.get(E.shown); if (!x) return flash(T.notOpen);
  const sess = await shownSession(x);
  if (!sess) return flash(T.noImages);
  openGallery(x.project, sess);
}

/** Hover sobre un "[Image #N]" del chat: muestra esa imagen (si ya está en el historial) mientras el cursor siga encima. */
/** Cuadro flotante con la imagen del hover: se dibuja sobre el chat, pegado a la marca [Image #N], sin tapar el resto. */
function hoverPopup(hv, rw, th) {
  const g = hv.g, img = g.images[0]; if (!img) return null;
  if (!g.dec.has(0) && !g.pending) {
    g.pending = true; ensureSpin();
    setImmediate(() => { let d = false; try { d = decodeImage(img) || false; } catch { d = false; } g.dec.set(0, d); g.pending = false; if (active) render(); });
  }
  const d = g.dec.get(0), lab = ` [Image #${hv.n}] `;
  let rows, tw, sx = null;
  if (d && d.rgba && sixelOn()) { // imagen real: se deja un hueco en blanco del tamaño de la imagen y se dibuja encima con Sixel
    const cw = E.cell.w, ch = E.cell.h, maxCols = Math.max(8, Math.min(rw - 6, 36)), maxRows = Math.max(2, Math.min(th - 5, 9)); // vista previa pequeña: como mucho 36×9 celdas
    const k = Math.min((maxCols * cw) / d.w, (maxRows * ch) / d.h, 3);
    const iw = Math.max(1, Math.min(maxCols, Math.round((d.w * k) / cw))), ih = Math.max(1, Math.min(maxRows, Math.round((d.h * k) / ch))), key = `sx:${iw}x${ih}`;
    let data = g.cache.get(key);
    if (!data) { data = encodeSixel(scaleBox(d.rgba, d.w, d.h, iw * cw, ih * ch), iw * cw, ih * ch); g.cache.clear(); g.cache.set(key, data); }
    sx = { data, iw, ih, key }; tw = iw; rows = Array.from({ length: ih }, () => ' '.repeat(iw));
  } else if (d && d.rgba) {
    const sz = fitSize(d.w, d.h, Math.max(8, Math.min(rw - 6, 96)), Math.max(2, Math.min(th - 6, 18)) * 2), key = `${sz.tw}x${sz.th}`;
    let hb = g.cache.get(key);
    if (!hb) { hb = halfBlocks(scaleBox(d.rgba, d.w, d.h, sz.tw, sz.th), sz.tw, sz.th); g.cache.clear(); g.cache.set(key, hb); }
    rows = hb; tw = sz.tw;
  } else {
    const txt = d === undefined ? spin() + ' …' : `${T.imgNoPrev} (${img.media || '?'})`; // el formato ayuda a saber por qué no se pudo leer
    tw = Math.max(strW(lab) + 1, Math.min(strW(txt) + 2, Math.max(8, rw - 4)));
    rows = [fit([[' ' + txt, d === false ? C.warn : C.accent]], tw)];
  }
  const label = strW(lab) <= tw - 1 ? lab : '', b = C.accent;
  const box = [b + '╭─' + label + '─'.repeat(Math.max(0, tw - 1 - strW(label))) + '╮' + R,
    ...rows.map((r) => b + '│' + R + r + b + '│' + R),
    (() => { const h = ` ${T.imgClickHint} `; return strW(h) <= tw - 1 ? b + '╰─' + C.dim + h + b + '─'.repeat(tw - 1 - strW(h)) + '╯' + R : b + '╰' + '─'.repeat(tw) + '╯' + R; })()];
  const bw = tw + 2, bh = box.length, left = clamp(hv.at.x, 0, Math.max(0, rw - bw));
  let top = hv.at.y + 1; // debajo de la marca; si no cabe, encima; si tampoco, pegado al borde
  if (top + bh > th) top = hv.at.y - bh;
  if (top < 0) top = Math.max(0, th - bh);
  return { left, top, bw, rows: box, sixel: sx ? { ...sx, key: `${hv.k}|${sx.key}|${left},${top}` } : null };
}

/** La imagen que corresponde a "[Image #n]" en la conversación de este chat, o null si aún no está en el historial. */
async function imageForMarker(sh, n) {
  try {
    const sess = await shownSession(sh);
    if (!sess) return null;
    const imgs = await imagesOf(sess);
    let img = imgs.find((im) => im.n === n) || (imgs.some((im) => im.n) ? null : imgs[n - 1]) || null;
    if (!img && imgs.length >= maxImages()) img = await images.findImageByNumber(sess.file, n); // pasó el límite de la galería: se busca en todo el archivo
    return img;
  } catch { return null; }
}

/**
 * Clic en un "[Image #N]": abre esa imagen en el visor del sistema, a su tamaño real. En el terminal solo se puede dibujar una
 * vista rápida (dos píxeles por carácter): una captura de pantalla con texto de 1917 px de ancho queda en unos 50 y no se lee.
 */
async function openMarkerImage(sh, n) {
  const img = await imageForMarker(sh, n);
  const note = (t) => { E.note = { t, until: Date.now() + 2500 }; scheduleRender(); };
  if (!img) return note(T.hoverMiss(n));
  const { files } = exportImages([img]);
  if (!files[0]) return note(T.imgNoPrev); // no es una imagen reconocible: no se abre
  openExternal(files[0]);
  note(T.imgOpened(n));
}

function hoverChat(sh, x, y) {
  const { SW, rw } = embedLayout(), x0 = SW ? SW + 2 : 1;
  let n = 0, at = null;
  if (sh.ready && x >= x0 && y >= 3) {
    const hit = imageMarkerAt(sh.term, y - 3, x - x0);
    if (hit) { n = hit.n; at = { x: hit.x, y: y - 3 }; }
  }
  if (!n) { if (E.hover) { E.hover = null; scheduleRender(); } return; }
  const k = `${n}:${at.x}:${at.y}`;
  if (E.hover && E.hover.k === k) return;
  const hv = { n, k, at, g: { project: sh.project, title: sh.title, images: [], i: 0, loading: true, pending: false, dec: new Map(), cache: new Map() } };
  E.hover = hv; scheduleRender();
  (async () => {
    const img = await imageForMarker(sh, n);
    if (E.hover !== hv) return; // el cursor ya se fue
    if (!img) { hv.g.loading = false; E.note = { t: T.hoverMiss(n), until: Date.now() + 2000 }; return scheduleRender(); }
    hv.g.images = [img]; hv.g.loading = false; scheduleRender();
  })();
}

function galleryRows(rw, th, g = E.gallery) {
  const rows = [], blank = ' '.repeat(rw);
  const center = (segs) => { const t = segs.map((q) => q[0]).join(''); const pad = Math.max(0, Math.floor((rw - strW(t)) / 2)); return ' '.repeat(pad) + fit(segs, Math.max(1, rw - pad)); };
  const body = th - 1; let content = [];
  if (g.loading) content = [center([[spin() + '  ' + T.findImgs, C.accent]])];
  else if (!g.images.length) content = [center([[T.noImages, C.dim]])];
  else {
    const img = g.images[g.i];
    if (!g.dec.has(g.i) && !g.pending) {
      g.pending = true; ensureSpin();
      setImmediate(() => { let d = false; try { d = decodeImage(img) || false; } catch { d = false; } g.dec.set(g.i, d); g.pending = false; if (active) render(); });
    }
    const d = g.dec.get(g.i);
    if (d === undefined) content = [center([[spin() + '  ' + T.decoding, C.accent]])];
    else if (d === false) content = [center([[T.imgNoPrev, C.warn]]), center([[img.media + ' · o', C.dim]])];
    else {
      const { tw, th: th2 } = fitSize(d.w, d.h, rw, body * 2), key = `${g.i}:${tw}x${th2}`;
      let img2 = g.cache.get(key);
      if (!img2) { img2 = halfBlocks(scaleBox(d.rgba, d.w, d.h, tw, th2), tw, th2); g.cache.clear(); g.cache.set(key, img2); }
      const pad = Math.floor((rw - tw) / 2);
      content = img2.map((l) => ' '.repeat(pad) + l + ' '.repeat(Math.max(0, rw - pad - tw)));
    }
  }
  const top = Math.max(0, Math.floor((body - content.length) / 2));
  for (let i = 0; i < body; i++) rows.push(content[i - top] !== undefined && i >= top ? content[i - top] : blank);
  rows.push(fit([[' ' + T.imgHint, C.accent]], rw));
  return rows;
}

function galleryKey(raw) {
  const g = E.gallery, k = KEYMAP[raw] || raw, n = g.images.length;
  if (k === 'esc' || k === 'q' || k === 'i' || k === 'f7' || k === 'ctrlc') E.gallery = null;
  else if (k === 'left' || k === 'h' || k === 'p') g.i = Math.max(0, g.i - 1);
  else if (k === 'right' || k === 'l' || k === 'n') g.i = Math.min(Math.max(0, n - 1), g.i + 1);
  else if (k === 'home') g.i = 0;
  else if (k === 'end') g.i = Math.max(0, n - 1);
  else if (k === 'o' && n) { cleanExports(); const { files } = exportImages(g.images); if (files[g.i]) { openExternal(files[g.i]); E.note = { t: T.imgFolder, until: Date.now() + 2500 }; } else E.note = { t: T.imgNoPrev, until: Date.now() + 2500 }; }
  render();
}

// Vista previa de los últimos mensajes de la conversación seleccionada (cuando no hay un chat abierto).
const PREV = new Map();
function previewFor(x) {
  const hit = PREV.get(x.file);
  if (hit && hit.m === x.mtime) return hit.msgs;
  PREV.set(x.file, { m: x.mtime, msgs: null });
  (async () => {
    let msgs = [];
    try {
      const fh = await fs.promises.open(x.file, 'r');
      try {
        const st = await fh.stat(); const len = Math.min(st.size, 512 * 1024);
        const buf = Buffer.alloc(len); await fh.read(buf, 0, len, st.size - len);
        const lines = buf.toString('utf8').split('\n'); if (st.size > len) lines.shift();
        for (let i = lines.length - 1; i >= 0 && msgs.length < previewMsgs(); i--) {
          const l = lines[i]; if (!isType(l, 'user') && !isType(l, 'assistant')) continue;
          let j; try { j = JSON.parse(l); } catch { continue; }
          if (j.isMeta || j.isSidechain || !j.message) continue;
          const text = tidy(textOf(j.message.content)).slice(0, 700);
          if (!text || text.startsWith('<') || text.startsWith('[Request interrupted')) continue;
          msgs.unshift({ role: j.type, text });
        }
      } finally { await fh.close(); }
    } catch { msgs = []; }
    PREV.set(x.file, { m: x.mtime, msgs });
    if (active) render();
  })();
  return null;
}

function previewRows(msgs, width, height, info = '') {
  const lines = [];
  for (const m of msgs) {
    const user = m.role === 'user';
    // tú: › en violeta y texto destacado; Claude: ● en naranja y texto atenuado
    wrapText(m.text, Math.max(10, width - 4)).forEach((t, i) => lines.push([i === 0 ? (user ? ' › ' : ' ● ') : '   ', user ? C.accent + C.bold : C.brand, t, user ? C.text : C.dim]));
    lines.push(null);
  }
  while (lines.length && lines[lines.length - 1] === null) lines.pop();
  const head = info ? 2 : 0; // fila de resumen + línea en blanco
  const shown = lines.slice(-Math.max(1, height - 2 - head)), rows = [];
  for (let i = 0; i < height; i++) {
    if (i === height - 1) { rows.push(fit([[' ' + T.prevHint, C.accent]], width)); continue; }
    if (info && i === 0) { rows.push(fit([[' ' + info, C.dim]], width)); continue; }
    if (info && i === 1) { rows.push(' '.repeat(width)); continue; }
    const l = shown[i - head];
    rows.push(l ? fit([[l[0], l[1]], [' ' + (l[2] || ''), l[3]]], width) : ' '.repeat(width));
  }
  return rows;
}

/** Título del panel del chat: proyecto › conversación  ⎇ rama */
// ── Estadísticas de la conversación (mensajes, tokens, herramientas, modelo), en la fila del título del chat ──
const STATS = new Map(); // archivo → { st, sum, at, busy, m, z }; solo se guardan las últimas conversaciones vistas
let sidIdx = { src: null, map: new Map() };
/** Archivo de una conversación por su id (la lista se recorre una vez por escaneo). */
function fileOfSid(sid) {
  if (sidIdx.src !== S.projects) sidIdx = { src: S.projects, map: new Map(S.projects.flatMap((p) => p.sessions.map((q) => [q.id, q.file]))) };
  return sidIdx.map.get(sid) || null;
}
const chatFile = (x) => x.file || (x.sid ? fileOfSid(x.sid) : null);
/**
 * Resumen de la conversación de ese archivo, o null mientras se lee la primera vez (undefined si no hay archivo). Se calcula en segundo
 * plano y, si el archivo crece (el chat abierto), se actualiza leyendo solo lo nuevo, como mucho cada 3 s.
 */
function chatStats(file) {
  if (!file) return undefined;
  let e = STATS.get(file);
  if (e) { STATS.delete(file); STATS.set(file, e); } // los más recientes al final
  else { e = { st: stats.newState(), sum: null, at: 0, busy: false, m: -1, z: -1 }; STATS.set(file, e); if (STATS.size > 12) STATS.delete(STATS.keys().next().value); }
  const now = Date.now();
  if (!e.busy && now - e.at > (e.sum ? 3000 : 0)) {
    e.at = now;
    let s; try { s = fs.statSync(file); } catch { return e.sum; }
    if (!e.sum || s.size !== e.z || s.mtimeMs !== e.m) {
      e.busy = true; e.z = s.size; e.m = s.mtimeMs;
      stats.update(e.st, file).then(() => { e.sum = stats.summary(e.st); }, () => { e.sum = e.sum || stats.summary(e.st); }).finally(() => { e.busy = false; if (active) scheduleRender(); });
    }
  }
  return e.sum;
}

/** Campos de las estadísticas, de más a menos importante: se muestran los que quepan, siempre en este orden: MSGS │ TOK │ TOOLS │ modelo. */
function statFields(sum) {
  if (sum === undefined) return [];
  if (sum === null) return [{ t: '…', c: C.dim, o: 0 }];
  return [
    { t: 'MSGS ' + sum.msgs, c: C.accent, o: 0 },
    sum.tok ? { t: 'TOK ' + stats.fmtNum(sum.tok), c: C.ok, o: 1 } : null,
    sum.model ? { t: stats.modelShort(sum.model), c: C.brand + C.bold, o: 3 } : null,
    sum.tools ? { t: 'TOOLS ' + sum.tools, c: C.warn, o: 2 } : null,
  ].filter(Boolean);
}

/** Título del panel del chat: proyecto › conversación  ⎇ rama, y a la derecha MSGS │ TOK │ TOOLS │ modelo (los que quepan). */
function headerRow(sh, width, sum) {
  if (!sh) return ' '.repeat(width);
  const left = [[' ' + sh.project, C.accent + C.bold], [' › ' + sh.title, C.text], [sh.branch ? '   ⎇ ' + sh.branch : '', C.dim]];
  const leftW = left.reduce((a, [t]) => a + strW(t), 0), budget = width - Math.min(leftW, Math.floor(width * 0.5)) - 1; // el título puede acortarse, pero no desaparecer
  const chosen = []; let used = 0;
  for (const f of statFields(sum)) { const w = strW(f.t) + (chosen.length ? 3 : 0); if (used + w > budget) break; chosen.push(f); used += w; } // en orden de importancia
  if (!chosen.length) return fit(left, width);
  chosen.sort((a, b) => a.o - b.o);
  const right = [];
  chosen.forEach((f, i) => { if (i) right.push([' │ ', C.faint]); right.push([f.t, f.c]); });
  right.push([' ', '']);
  const rw = right.reduce((a, [t]) => a + strW(t), 0);
  return fit(left, width - rw) + fit(right, rw);
}

function renderEmbed() {
  const { W, H, SW, GW, rw, rh, th } = embedLayout();
  if (W < 70 || H < 12) { process.stdout.write('\x1b[2J\x1b[H' + T.small); invalidate(); return; }
  const left = SW ? frameTree(SW, rh) : null;
  const sh = E.sessions.get(E.shown);
  const rowsOut = [];
  // sin chat abierto: vista previa de la conversación seleccionada en la lista
  const selEnt = !sh && !S.help && !S.qs ? flatList()[S.c] : null;
  const pvMsgs = selEnt && selEnt.t === 's' ? previewFor(selEnt.s) : null;
  const pvRows = pvMsgs && pvMsgs.length ? previewRows(pvMsgs, rw, th, T.prevInfo(ago(selEnt.s.mtime), pvMsgs.length)) : null;
  const hdr = sh || (selEnt && selEnt.t === 's' ? { project: selEnt.p.name, title: selEnt.s.title, branch: gitBranch(selEnt.p.cwd), file: selEnt.s.file } : null);
  const gRows = E.gallery ? galleryRows(rw, th) : null;
  const hv = !E.gallery && sh && sh.ready && E.hover && !E.hover.g.loading && E.hover.g.images.length ? E.hover : null;
  const pop = hv ? hoverPopup(hv, rw, th) : null;
  const popRow = (ty) => (pop && ty >= pop.top && ty < pop.top + pop.rows.length
    ? termRow(sh.term, ty, pop.left, selRange(ty, rw)) + pop.rows[ty - pop.top] + termRow(sh.term, ty, rw - pop.left - pop.bw, selRange(ty, rw), pop.left + pop.bw)
    : null);
  const div = (E.drag === 'side' || E.focus === 'right' ? C.accent : C.faint) + '│' + R;
  const gdiv = (E.drag === 'git' ? C.accent : C.faint) + '│' + R; // la línea que se está arrastrando se resalta
  const gitR = GW ? gitRows(GW, rh) : null;
  for (let y = 0; y < rh; y++) {
    const ty = y - 2; // las 2 primeras filas del panel derecho son el título y su línea
    const gd = E.gallery && E.gallery.dec.get(E.gallery.i);
    const right = gRows ? (y === 0 ? fit([[' ' + E.gallery.project, C.accent + C.bold], [' › ' + E.gallery.title, C.text],
        [E.gallery.images.length ? `   ▣ ${E.gallery.i + 1}/${E.gallery.images.length}` + (gd ? ` · ${gd.w}×${gd.h}` : '') : '', C.dim]], rw)
        : y === 1 ? C.faint + '─'.repeat(rw) + R : gRows[ty])
      : y === 0 ? headerRow(hdr, rw, hdr ? chatStats(chatFile(hdr)) : undefined) : y === 1 ? C.faint + '─'.repeat(rw) + R
      : sh && sh.ready ? (popRow(ty) || termRow(sh.term, ty, rw, selRange(ty, rw))) : sh ? loaderRow(ty, rw, th, sh.title) : pvRows ? pvRows[ty] : idleRow(ty, rw, th);
    rowsOut.push((left ? (left[y] || ' '.repeat(SW)) + div : '') + right + (gitR ? gdiv + gitR[y] : ''));
  }
  const live = E.sessions.size;
  const k = (key, d) => [['[' + key + ']', C.accent + C.bold], [' ' + d + '  ', C.text]]; // [tecla] descripción
  const sb = sh && sh.ready ? sh.term.buffer.active : null;
  const back = sb ? sb.baseY - sb.viewportY : 0;
  // las teclas cambian con el foco: en el chat, las letras son de Claude y solo valen las F; en la lista valen las letras
  const keys = E.focus === 'right' && sh
    ? [...k('F1', T.barList), ...k('F3', E.mouse ? T.bar4 : T.bar5), ...k('F4', E.hideSide ? T.bar7 : T.bar6), ...k('F5', T.barJump), ...k('F8', T.bar8), ...k('F9', T.barTheme)]
    : [...k('/', T.k.find), ...k('n', T.k.neu), ...k('Ctrl+P', T.barJump), ...k('b', T.bar8), ...k('t', T.barTheme), ...k('?', T.kHelp), ...k('q', T.k.quit)];
  // a la derecha: los chats abiertos y cuántos proyectos y chats hay (se omiten si no caben)
  const stat = [[live ? '● ' + live + '  ' : '', C.ok], [T.barCount(S.projects.length, S.projects.reduce((a, p) => a + p.sessions.length, 0)), C.dim], [' ', '']];
  const statW = stat.reduce((a, [t]) => a + strW(t), 0), keysW = keys.reduce((a, [t]) => a + strW(t), 0) + strW(E.note ? E.note.t : '') + 8;
  const full = W - statW >= keysW; // el resumen solo sale si las teclas caben enteras
  const barL = fit([[' ', ''], [E.note ? E.note.t + '   ' : '', C.ok], [back > 0 ? T.up(back, sb && sb.baseY ? Math.round((100 * sb.viewportY) / sb.baseY) : -1) + '   ' : '', C.warn], ...keys], full ? W - statW : W);
  rowsOut.push(full ? barL + fit(stat, statW) : barL);
  const changes = diffRows(rowsOut);
  // imagen real (Sixel) sobre el hueco del cuadro: se dibuja al aparecer y se repite si algo reescribe esas filas (con un mínimo de 150 ms entre dibujos)
  let sx = '';
  if (pop && pop.sixel) {
    const top = pop.top + 3, touched = lastChanged.some((y) => y >= top && y < top + pop.sixel.ih);
    if (E.sixelKey !== pop.sixel.key || touched || E.sixelStale) {
      const now = Date.now();
      if (E.sixelKey === pop.sixel.key && now - E.sixelAt < 150) { E.sixelStale = true; if (!E.sixelRetry) E.sixelRetry = setTimeout(() => { E.sixelRetry = null; scheduleRender(); }, 160); }
      else { sx = emitSixel(pop.top + 4, (SW ? SW + 2 : 1) + pop.left + 1, pop.sixel.data); E.sixelKey = pop.sixel.key; E.sixelAt = now; E.sixelStale = false; }
    }
  } else if (E.sixelKey) { E.sixelKey = null; E.sixelStale = false; } // al quitar el cuadro, las filas que cubría ya se reescriben solas con el texto del chat
  let cur = '';
  if (sh && sh.ready && E.focus === 'right' && !sh.cursorHidden && back === 0) {
    const b = sh.term.buffer.active;
    cur = `\x1b[${Math.min(th, b.cursorY + 1) + 2};${(SW ? SW + 1 : 0) + 1 + Math.min(rw - 1, b.cursorX)}H\x1b[?25h`;
  }
  process.stdout.write((changes || sx ? '\x1b[?2026h\x1b[?25l' + changes + sx : '\x1b[?25l') + cur + (changes || sx ? '\x1b[?2026l' : ''));
}

function scheduleRender() {
  if (E.pend) return;
  E.pend = setTimeout(() => { E.pend = null; render(); }, 16);
}

function embedLive() { S.live = new Set([...E.sessions.keys(), ...[...E.sessions.values()].map((x) => x.sid).filter(Boolean)]); }

function embedLaunch(project, session) {
  if (!fs.existsSync(project.cwd)) { flash(T.missing + ': ' + shortPath(project.cwd)); return; }
  const bin = findClaude();
  if (!bin) { flash(T.noClaude); return; }
  const key = session ? session.id : 'new-' + Date.now();
  const ex = chatKeyOf(key);
  if (ex) { const x = E.sessions.get(ex); x.unseen = false; E.shown = ex; E.focus = 'right'; render(); return; }
  const { pty, Terminal } = E.deps; const { rw, th } = embedLayout();
  const args = [...(session ? ['--resume', session.id] : []), ...extraArgs];
  const win = WIN && !/\.exe$/i.test(bin);
  const env = { ...process.env, HOPDECK_SKIP: '1', HOPDECK_INSIDE: '1', TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  let p;
  try {
    p = pty.spawn(win ? (process.env.ComSpec || 'cmd.exe') : bin, win ? ['/d', '/c', bin, ...args] : args,
      { name: 'xterm-256color', cols: rw, rows: th, cwd: project.cwd, env });
  } catch (e) { flash(String(e.message).split('\n')[0]); return; }
  const term = new Terminal({ cols: rw, rows: th, allowProposedApi: true, scrollback: 2000 });
  const sess = { p, term, cursorHidden: false, ready: false, lastData: Date.now(), quietUntil: 0, working: false, busy: false, unseen: false, title: session ? session.title : T.newChat, t0: Date.now(), project: project.name, cwd: project.cwd, sid: session ? session.id : null, closing: false, branch: gitBranch(project.cwd) };
  const vis = (hidden) => (params) => { if (params.some((x) => x === 25 || (Array.isArray(x) && x.includes(25)))) sess.cursorHidden = hidden; return false; };
  term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, vis(false));
  term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, vis(true));
  term.onData((d) => { try { p.write(d); } catch { /* cerrado */ } }); // respuestas a consultas del terminal
  p.onData((d) => {
    if (Date.now() >= sess.quietUntil) sess.lastData = Date.now(); // lo que Claude repinta justo tras redimensionar no es trabajo
    // "listo" = ya hay texto visible. En Windows ConPTY manda secuencias de control al arrancar, antes de que Claude dibuje nada.
    term.write(d, () => { if (!sess.ready && hasContent(term)) sess.ready = true; if (E.shown === key) scheduleRender(); });
  });
  setTimeout(() => { if (!sess.ready) { sess.ready = true; if (E.shown === key) scheduleRender(); } }, 20000); // por si el chat nunca imprime
  p.onExit((ev) => {
    const code = ev && ev.exitCode;
    if ((code || !sess.ready) && !sess.closing) flash(T.exited(code || 0));
    E.sessions.delete(key); embedLive();
    if (E.shown === key) { E.shown = null; E.focus = 'left'; }
    try { term.dispose(); } catch { /* */ }
    render();
  });
  E.sessions.set(key, sess); E.shown = key; E.focus = 'right'; embedLive();
  if (!S.projects.some((q) => q.cwd === project.cwd && q.sessions.length)) { // carpeta sin historial: que la lista la muestre ya, con su chat nuevo
    reloadAsync(() => { const q = S.projects.find((x) => x.cwd === project.cwd); if (q) S.open = q.key; }, true);
  }
  ensureSpin(); render();
}

function selNorm(sl) {
  let a = sl.a, b = sl.b;
  if (b.y < a.y || (b.y === a.y && b.x < a.x)) [a, b] = [b, a];
  return [a, b];
}
// La selección del chat guarda en `y` la línea del historial del terminal (absoluta), no la fila de la pantalla: así sigue sobre
// el mismo texto aunque el chat se desplace mientras se arrastra, y puede abarcar más de lo que cabe en pantalla.
function selRange(ty, rw) {
  if (!E.sel) return null;
  const sh = E.sessions.get(E.shown); if (!sh) return null;
  const y = sh.term.buffer.active.viewportY + ty, [a, b] = selNorm(E.sel);
  if (y < a.y || y > b.y) return null;
  return [y === a.y ? a.x : 0, y === b.y ? b.x : rw - 1];
}
function selText(sh, sl) {
  const [a, b] = selNorm(sl); const buf = sh.term.buffer.active; const out = [];
  for (let y = a.y; y <= b.y; y++) {
    const l = buf.getLine(y);
    out.push(l ? l.translateToString(true, y === a.y ? a.x : 0, y === b.y ? b.x + 1 : sh.term.cols) : '');
  }
  return out.join('\n').replace(/\s+$/, '');
}
/** Copia la selección marcada y la quita. Solo se llama cuando el usuario lo pide (Ctrl+C, clic derecho), o con "copyOnSelect". */
function copySelection(sh) {
  const sl = E.sel; E.sel = null; stopSelScroll();
  const t = sl && sh ? selText(sh, sl) : '';
  if (t) { copyText(t); E.note = { t: T.copied(t.length), until: Date.now() + 3000 }; }
}

// Al arrastrar contra el borde de arriba o de abajo, el chat se desplaza solo (aunque el ratón se quede quieto) y la selección sigue.
let selTimer = null;
function stopSelScroll() { if (selTimer) { clearInterval(selTimer); selTimer = null; } if (E.sel) E.sel.dir = 0; }
function selScrollTick() {
  const sel = E.sel, sh = E.sessions.get(E.shown);
  if (!sel || !sel.down || !sel.dir || !sh || sh.term.buffer.active.type === 'alternate') return stopSelScroll();
  sh.term.scrollLines(-sel.dir * 2); // dir > 0: hacia arriba
  const row = sel.dir > 0 ? 0 : embedLayout().th - 1;
  sel.b = { x: sel.b.x, y: sh.term.buffer.active.viewportY + row };
  render();
}
/** `row`: fila del ratón respecto a la zona del chat (negativa = encima, ≥ th = debajo). Pone en marcha o para el desplazamiento. */
function selEdge(sh, row) {
  const th = embedLayout().th, dir = row < 0 ? 1 : row >= th ? -1 : 0;
  E.sel.dir = dir;
  if (dir && sh.term.buffer.active.type !== 'alternate') { if (!selTimer) { selTimer = setInterval(selScrollTick, 60); selScrollTick(); } }
  else if (selTimer) { clearInterval(selTimer); selTimer = null; }
}
/** Copia al portapapeles: OSC 52 (la mayoría de terminales) + comando del sistema como respaldo. */
function copyText(t) {
  if (process.env.HOPDECK_COPY_LOG) { try { fs.appendFileSync(process.env.HOPDECK_COPY_LOG, JSON.stringify(t) + '\n'); } catch { /* */ } return; } // pruebas: se anota en un archivo y no se toca el portapapeles
  try { process.stdout.write(`\x1b]52;c;${Buffer.from(t).toString('base64')}\x07`); } catch { /* */ }
  const run = (cmd, args) => { try { const c = cp.spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] }); c.on('error', () => {}); c.stdin.on('error', () => {}); c.stdin.end(t); } catch { /* */ } };
  if (process.platform === 'darwin') run('pbcopy', []);
  else if (WIN) run('powershell', ['-NoProfile', '-Command', '[Console]::InputEncoding=[Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())']);
  else if (process.env.WAYLAND_DISPLAY) run('wl-copy', []);
  else run('xclip', ['-selection', 'clipboard']);
}

function scrollSession(sh, lines) { // lines > 0 = hacia arriba
  if (!sh || sh.term.buffer.active.type === 'alternate') return;
  sh.term.scrollLines(-lines);
}

/** Rueda sobre el chat: si Claude captura el ratón o usa pantalla alternativa, se la reenviamos; si no, scroll del historial. */
function wheelChat(sh, up, x, y) {
  if (!sh || !sh.ready) return;
  const t = sh.term, alt = t.buffer.active.type === 'alternate';
  if (t.modes.mouseTrackingMode !== 'none') {
    const { SW, rw, th } = embedLayout(), x0 = SW ? SW + 2 : 1;
    const cx = clamp(x - x0 + 1, 1, rw), cy = clamp(y - 3 + 1, 1, th);
    try { sh.p.write(`\x1b[<${up ? 64 : 65};${cx};${cy}M`.repeat(3)); } catch { /* cerrado */ }
  } else if (alt) {
    const k = (up ? '\x1b[A' : '\x1b[B').replace('[', t.modes.applicationCursorKeysMode ? 'O' : '[');
    try { sh.p.write(k.repeat(3)); } catch { /* cerrado */ }
  } else scrollSession(sh, up ? 3 : -3);
}

/** Modos de ratón que se piden al terminal: clics, formato SGR y (solo en el modo embebido, que lo usa para el hover) el movimiento. */
const mouseModes = (on) => (EMBED ? ['1000', '1003', '1006'] : ['1000', '1006']).map((m) => `\x1b[?${m}${on ? 'h' : 'l'}`).join('');

function setMouse(on) {
  E.mouse = on;
  process.stdout.write(mouseModes(on));
  render();
}

/**
 * Ratón en el modo tmux (la lista es su propio panel): rueda para moverse y clic para abrir. tmux solo reenvía los
 * eventos a un panel cuyo programa los ha pedido; sin esto, los clics solo cambiaban el foco del panel.
 */
function sidebarMouse(b, x, y, type, rows = process.stdout.rows || 30) {
  if (b & 64) { // rueda
    const d = (b & 1) === 0 ? -3 : 3;
    if (S.fb) S.fb.i = clamp(S.fb.i + d, 0, Math.max(0, fbRows().length - 1));
    else if (S.qs) S.qs.i = clamp(S.qs.i + d, 0, Math.max(0, qsItems().length - 1));
    else S.c = clamp(S.c + d, 0, Math.max(0, flatList().length - 1));
    return render();
  }
  if (type !== 'M' || (b & 3) !== 0 || (b & 32)) return; // solo clic izquierdo (no soltar, ni arrastrar, ni otros botones)
  if (y === 1 && !S.help && !S.fb && !S.qs && S.prompt === null) { S.searching = true; S.qpos = [...S.query].length; return render(); } // clic en la fila de arriba: buscar
  if (S.help || S.prompt !== null || y < 3 || y > rows - 3) return; // las filas de la lista van de la 3 a rows-3
  if (S.qs) { const i = S.qs.off + (y - 3); if (qsItems()[i]) { S.qs.i = i; return onKeyTree('\r'); } return; }
  if (S.fb) { const i = S.fb.off + (y - 3); if (fbRows()[i]) { S.fb.i = i; fbActivate(); } return; }
  const i = S.coff + (y - 3);
  if (flatList()[i]) { S.c = i; return onKeyTree('\r'); }
}

function onMouse(b, x, y, type) {
  if (E.gallery) return;
  const { SW, GW, rw, rh } = embedLayout();
  const sh = E.sessions.get(E.shown);
  // líneas divisorias arrastrables (columna de cada '│'): lista|chat y chat|git
  const sx = SW ? SW + 1 : 0, gx = GW ? sx + rw + 1 : 0;
  if (E.drag) {
    if (type === 'm') { E.drag = null; saveCfg(); return render(); }
    if ((b & 32) && (b & 3) === 0) return dragPanel(E.drag, x);
  } else if (type === 'M' && !(b & 96) && (b & 3) === 0 && y <= rh && ((SW && x === sx) || (GW && x === gx))) {
    E.drag = x === sx ? 'side' : 'git'; E.sel = null; E.hover = null;
    return render();
  }
  if (GW && x > (SW ? SW + 1 : 0) + rw) { if (E.hover) { E.hover = null; scheduleRender(); } return; } // el panel de git es de solo lectura
  if (b & 64) { // rueda
    E.hover = null;
    const up = (b & 1) === 0;
    if (x <= SW && S.fb) S.fb.i = clamp(S.fb.i + (up ? -3 : 3), 0, fbRows().length - 1);
    else if (x <= SW) { const n = flatList().length; S.c = clamp(S.c + (up ? -3 : 3), 0, Math.max(0, n - 1)); }
    else wheelChat(sh, up, x, y);
    return render();
  }
  if ((b & 32) && (b & 3) === 3) { // movimiento sin botón (hover): previsualiza la conversación bajo el cursor
    if (S.help || S.qs || (E.sel && E.sel.down)) return;
    if (S.fb) { const i = S.fb.off + (y - 3); if (x <= SW && y >= 3 && y <= rh - 2 && fbRows()[i] && i !== S.fb.i) { S.fb.i = i; scheduleRender(); } return; }
    if (sh) { if (x > SW) hoverChat(sh, x, y); else if (E.hover) { E.hover = null; scheduleRender(); } return; }
    if (x > SW || y < 3 || y > rh - 2) return;
    const i = S.coff + (y - 3), L = flatList();
    if (L[i] && i !== S.c) { S.c = i; scheduleRender(); }
    return;
  }
  const x0 = SW ? SW + 2 : 1, inPane = (SW ? x > SW + 1 : true) && y >= 3 && sh && sh.ready;
  // celda del chat bajo el ratón; `y` es la línea del historial (ver selRange), así que sirve aunque el chat esté desplazado
  const cell = () => { const L = embedLayout(); return { x: clamp(x - x0, 0, L.rw - 1), y: sh.term.buffer.active.viewportY + clamp(y - 3, 0, L.th - 1) }; };
  if ((b & 32) && (b & 3) === 0) { // arrastre
    if (E.sel && E.sel.down && sh) { E.sel.b = cell(); selEdge(sh, y - 3); render(); }
    return;
  }
  if (type === 'm') { // soltar
    stopSelScroll();
    const sl = E.sel;
    if (!sl || !sl.down) return render();
    if (sl.a.x === sl.b.x && sl.a.y === sl.b.y) { // un clic sin arrastrar: si es sobre un [Image #N], se abre la imagen
      E.sel = null;
      if (sh && sh.ready) { const hit = imageMarkerAt(sh.term, sl.a.y - sh.term.buffer.active.viewportY, sl.a.x); if (hit) openMarkerImage(sh, hit.n); }
      return render();
    }
    sl.down = false; // la selección se queda marcada: no se copia sola (se copia con Ctrl+C o clic derecho), salvo con "copyOnSelect": true
    if (CFG.copyOnSelect) copySelection(sh); else E.note = { t: T.selHint, until: Date.now() + 8000 };
    return render();
  }
  if (type === 'M' && (b & 3) === 2 && E.sel && !E.sel.down && sh) { copySelection(sh); return render(); } // clic derecho: copiar lo marcado
  if (type !== 'M' || (b & 3) !== 0) return; // solo clic izquierdo
  if (x <= SW && y === 1 && !S.fb && !S.qs && S.prompt === null && !S.help) { E.focus = 'left'; E.sel = null; S.searching = true; S.qpos = [...S.query].length; return render(); } // clic en la fila de arriba de la lista: buscar
  if (inPane) { E.focus = 'right'; const c = cell(); stopSelScroll(); E.sel = { a: c, b: c, down: true, dir: 0 }; return render(); }
  stopSelScroll(); E.sel = null;
  if (S.fb && x <= SW) {
    E.focus = 'left'; const i = S.fb.off + (y - 3);
    if (S.prompt === null && y >= 3 && y <= rh - 2 && fbRows()[i]) { S.fb.i = i; return fbActivate(); }
    return render();
  }
  if (x <= SW) {
    E.focus = 'left';
    const i = S.coff + (y - 3), L = flatList();
    if (y >= 3 && y <= rh - 2 && L[i]) { S.c = i; return onKeyTree('\r'); }
  } else if (x > SW + 1 && sh && sh.ready) E.focus = 'right';
  render();
}

function hasContent(term) {
  const b = term.buffer.active;
  for (let y = 0; y < term.rows; y++) {
    const l = b.getLine(b.viewportY + y);
    if (l && l.translateToString(true).trim()) return true;
  }
  return false;
}

function embedInput(s) {
  if (E.sel && !E.sel.down) { // hay texto seleccionado: Ctrl+C lo copia y Esc lo quita, sin llegar a Claude (Esc le interrumpiría)
    if (s === '\x03') { copySelection(E.sessions.get(E.shown)); return render(); }
    if (s === '\x1b') { E.sel = null; E.note = null; return render(); }
  }
  stopSelScroll(); E.sel = null; E.hover = null;
  if (s === '\x1bOP' || s === '\x1b[11~' || s === '\x1b[1;1P') { E.focus = 'left'; if (E.hideSide) { E.hideSide = false; embedResize(); } else render(); return; }
  const sh = E.sessions.get(E.shown);
  const b = sh.term.buffer.active, scrolled = b.baseY > b.viewportY;
  const page = Math.max(1, Math.floor(embedLayout().th / 2));
  if (s === '\x1b[5~' || s === '\x1b[5;2~') { scrollSession(sh, page); return render(); }
  if (s === '\x1b[6~' || s === '\x1b[6;2~') { scrollSession(sh, -page); return render(); }
  if (scrolled && (s === '\x1b[F' || s === '\x1b[4~' || s === '\x1bOF')) { sh.term.scrollToBottom(); return render(); }
  if (scrolled) { sh.term.scrollToBottom(); render(); }
  let d = s;
  // Ctrl+V → Alt+V: en Windows Claude Code pega imágenes con Alt+V; así funciona el atajo de siempre.
  if (WIN && d === '\x16') d = '\x1bv';
  if (!sh.term.modes.bracketedPasteMode) d = d.replace(/\x1b\[20[01]~/g, '');
  if (sh.term.modes.applicationCursorKeysMode) d = d.replace(/\x1b\[([ABCDHF])/g, '\x1bO$1');
  if (d.includes('\r')) { sh.busy = true; if (!sh.sid) { clearTimeout(sh.linkT); sh.linkT = setTimeout(() => reloadAsync(null, true), 4000); } } // se envió un mensaje: avisar cuando termine
  try { sh.p.write(d); } catch { /* cerrado */ }
}

/** Aviso de escritorio cuando un chat termina mientras miras otra cosa. */
function notifyDesktop(msg) {
  if (CFG.notify === false) return;
  msg = clean(msg).slice(0, 200); // viene del historial: sin caracteres de control
  try {
    process.stdout.write(`\x1b]9;${msg}\x07`);
    const spawnQuiet = (cmd, args, env) => { const c = cp.spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true, env: { ...process.env, ...env } }); c.on('error', () => {}); c.unref(); };
    if (process.platform === 'darwin') spawnQuiet('osascript', ['-e', 'display notification (system attribute "HOPDECK_MSG") with title "Hopdeck"'], { HOPDECK_MSG: msg });
    else if (WIN) spawnQuiet('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command',
      'Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $n=New-Object System.Windows.Forms.NotifyIcon; $n.Icon=[System.Drawing.SystemIcons]::Information; $n.Visible=$true; $n.ShowBalloonTip(6000,"Hopdeck",$env:HOPDECK_MSG,"Info"); Start-Sleep 7; $n.Dispose()'], { HOPDECK_MSG: msg });
    else spawnQuiet('notify-send', ['--', 'Hopdeck', msg], {}); // "--": un mensaje que empiece por "-" no es una opción
  } catch { /* sin notificaciones */ }
}

/** Cierra una conversación abierta (si está trabajando pide confirmar con una segunda pulsación). */
function closeChat(key) {
  if (SIDEBAR) {
    try {
      const x = tmuxPanes().find((q) => q.key === key); if (!x) return flash(T.notOpen);
      const mine = process.env.TMUX_PANE;
      const slot = tmux('list-panes', '-t', mine, '-F', '#{pane_id}').split('\n').find((id) => id && id !== mine);
      if (x.id === slot) { // el panel visible se deja como "elige una conversación"
        tmux('respawn-pane', '-k', '-t', slot, ['env', 'HOPDECK_INSIDE=1', process.execPath, __filename, '--idle'].map(sq).join(' '));
        tmux('set-option', '-p', '-t', slot, '-u', '@hopdeck_key'); tmux('set-option', '-p', '-t', slot, '-u', '@hopdeck_title');
      } else tmux('kill-pane', '-t', x.id);
      tmux('select-pane', '-t', mine);
    } catch (e) { flash(String(e.message).split('\n').filter(Boolean).pop()); }
    refreshLive(); return;
  }
  const x = E.sessions.get(key);
  if (!x) return flash(T.notOpen);
  if (x.working && !(S.confirmClose && S.confirmClose.key === key && S.confirmClose.until > Date.now())) {
    S.confirmClose = { key, until: Date.now() + 4000 }; return flash(T.confirmClose);
  }
  S.confirmClose = null; x.closing = true;
  try { x.p.kill(); } catch { /* ya terminó */ }
  flash(T.closed(x.title));
}

/**
 * ¿Claude Code está trabajando de verdad? Mientras genera, su pantalla muestra «esc to interrupt» (o «ctrl+c to interrupt»).
 * Antes bastaba con que el chat escribiera algo en el último segundo, y eso también pasa sin trabajo: al redimensionar los
 * paneles, al cambiar de ventana, o al actualizar su barra de estado. Se mira solo la pantalla viva (no lo que se ve al subir).
 */
const BUSY_HINT = /(esc|ctrl\+c) to interrupt/i;
function showsBusy(term) {
  const b = term.buffer.active;
  for (let y = Math.max(0, term.rows - 14); y < term.rows; y++) {
    const l = b.getLine(b.baseY + y);
    if (l && BUSY_HINT.test(l.translateToString(true))) return true;
  }
  return false;
}

function pollChats() {
  const now = Date.now(); let changed = false;
  for (const [key, x] of E.sessions) {
    // HOPDECK_BUSY=output devuelve el criterio antiguo (cualquier salida reciente) por si una versión de Claude cambia ese texto
    const working = x.ready && now - x.lastData < 1200 && (process.env.HOPDECK_BUSY === 'output' || showsBusy(x.term));
    if (x.working && !working && x.busy) {
      x.busy = false;
      if (E.shown !== key || E.focus !== 'right') { x.unseen = true; E.note = { t: '✔ ' + x.project + ' › ' + x.title, until: now + 6000 }; process.stdout.write('\x07'); notifyDesktop(x.project + ' › ' + x.title); }
    }
    if (x.working !== working) { x.working = working; changed = true; }
    if (x.unseen && E.shown === key && E.focus === 'right') { x.unseen = false; changed = true; }
  }
  if (E.note && E.note.until < now) { E.note = null; changed = true; }
  if (changed) { if (x_any(E)) ensureSpin(); render(); }
}
const x_any = (e) => [...e.sessions.values()].some((x) => x.working);

function embedResize() {
  invalidate(); stopSelScroll(); E.sel = null; // al cambiar el ancho las líneas se reajustan: la selección ya no marcaría lo mismo
  const { rw, th } = embedLayout();
  for (const sess of E.sessions.values()) { sess.quietUntil = Date.now() + 1500; try { sess.p.resize(rw, th); sess.term.resize(rw, th); } catch { /* */ } } // todos los chats se repintan al cambiar el tamaño
  render();
}

function embedKillAll() { for (const sess of E.sessions.values()) { try { sess.p.kill(); } catch { /* */ } } }

// Redibujado diferencial: solo se reescriben las filas que cambiaron desde el último cuadro.
let lastRows = [], forceFull = true;
const invalidate = () => { forceFull = true; };
let lastChanged = []; // índices de las filas que reescribió el último diffRows (si pisan una imagen Sixel hay que volver a dibujarla)
function diffRows(rows) {
  let out = ''; lastChanged = [];
  for (let i = 0; i < rows.length; i++) {
    if (forceFull || lastRows[i] !== rows[i]) { out += `\x1b[${i + 1};1H` + rows[i]; lastChanged.push(i); }
  }
  lastRows = rows.slice(); forceFull = false;
  return out;
}

function render() {
  if (EMBED) return renderEmbed();
  const cols = process.stdout.columns || 100, rows = process.stdout.rows || 30;
  const lines = SIDEBAR ? frameTree(cols, rows) : frame(cols, rows);
  const full = [];
  for (let i = 0; i < rows; i++) full.push(lines[i] || ' '.repeat(cols));
  const out = diffRows(full);
  if (out) process.stdout.write(out);
}

// ───────────────────────── terminal ─────────────────────────
let active = false;
function enter() {
  if (active) return; active = true; invalidate();
  process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[2J' + ((EMBED || SIDEBAR) && E.mouse ? mouseModes(true) : '') + (EMBED && process.env.HOPDECK_SIXEL !== '0' ? '\x1b[c\x1b[16t' : '')); // consulta: ¿admite imágenes (Sixel)? ¿qué tamaño tiene una celda?
  process.stdin.setRawMode(true); process.stdin.resume();
}
function leave() {
  if (!active) return; active = false;
  process.stdout.write(((EMBED || SIDEBAR) ? mouseModes(false) : '') + '\x1b[?25h\x1b[?1049l' + R);
  try { process.stdin.setRawMode(false); } catch { /* */ }
  process.stdin.pause();
}
function quit(code = 0) {
  cleanExports();
  if (EMBED || SIDEBAR) rememberState();
  if (EMBED) embedKillAll();
  if (SIDEBAR) { try { tmux('kill-server'); } catch { /* ya cerrado */ } }
  leave(); process.exit(code);
}

function load(keepKey) {
  S.projects = scan();
  if (keepKey) { const i = S.projects.findIndex((p) => p.key === keepKey); if (i >= 0) S.pi = i; }
}

const extraArgs = [];

/** Busca el ejecutable real de claude en el PATH (no depende de funciones del shell). */
/** Busca un programa en el PATH (por defecto `claude`). Recuerda el resultado mientras el archivo siga existiendo. */
const FOUND = new Map();
function findClaude(name = 'claude') {
  const known = FOUND.get(name);
  if (known) { try { if (fs.statSync(known).isFile()) return known; } catch { /* ya no está: se busca otra vez */ } FOUND.delete(name); }
  const exts = WIN ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').concat(['']) : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const f = path.join(dir, name + ext.toLowerCase());
      try { if (fs.statSync(f).isFile()) { FOUND.set(name, f); return f; } } catch { /* siguiente */ }
    }
  }
  return null;
}

/** El id de una sesión sale del nombre de su archivo; solo se pasa a `claude --resume` si es un identificador normal. */
const safeId = (id) => /^[A-Za-z0-9._-]{1,128}$/.test(String(id || ''));

function launch(project, session) {
  if (session && !safeId(session.id)) { flash(T.badId); return; }
  if (SIDEBAR) return launchSlot(project, session);
  if (EMBED) return embedLaunch(project, session);
  if (!fs.existsSync(project.cwd)) { flash(T.missing + ': ' + shortPath(project.cwd)); return; }
  const bin = findClaude();
  if (!bin) { flash(T.noClaude); return; }
  leave();
  process.stdout.write('\x1b[2J\x1b[H');
  const args = [...(session ? ['--resume', session.id] : []), ...extraArgs];
  const opts = { cwd: project.cwd, stdio: 'inherit', env: { ...process.env, HOPDECK_SKIP: '1' } };
  const onInt = () => { /* Ctrl-C es del proceso hijo */ };
  process.on('SIGINT', onInt);
  let res;
  if (WIN && /\.(cmd|bat)$/i.test(bin)) { // los .cmd necesitan shell: una sola cadena evita DEP0190
    const q = (x) => (/^[\w.:\\/=@-]+$/.test(x) ? x : `"${x.replace(/"/g, '\\"')}"`);
    res = cp.spawnSync([`"${bin}"`, ...args.map(q)].join(' '), { ...opts, shell: true });
  } else res = cp.spawnSync(bin, args, opts);
  process.removeListener('SIGINT', onInt);
  if (res.error) {
    process.stdout.write(`\n${C.warn}${res.error.message}${R}\n${C.dim}${T.pressKey}${R}\n`);
    process.stdin.setRawMode(true); process.stdin.resume();
    process.stdin.once('data', () => { process.stdin.setRawMode(false); process.stdin.pause(); back(project.key); });
    return;
  }
  back(project.key);
}
function back(key) {
  S.focus = 0; S.si = 0; S.soff = 0; S.query = ''; S.searching = false;
  enter(); render();
  reloadAsync(() => { const i = S.projects.findIndex((p) => p.key === key); if (i >= 0) S.pi = i; });
}

let flashT;
/** Cambia entre el tema claro y el oscuro sin reiniciar, y lo recuerda para la próxima vez. */
function toggleTheme() {
  const next = isLight() ? 'dark' : 'light';
  setTheme(next); CFG.theme = next; saveCfg();
  invalidate(); // todas las filas se repintan con los colores nuevos
  flash(T.themeNow(next));
}
function flash(msg) { S.flash = msg; render(); clearTimeout(flashT); flashT = setTimeout(() => { S.flash = ''; render(); }, 2500); }


function move(d) {
  const V = view(); S.flash = '';
  if (S.focus === 0) { S.pi = clamp(S.pi + d, 0, Math.max(0, V.length - 1)); S.si = 0; S.soff = 0; }
  else { const n = V[S.pi] ? V[S.pi].ss.length + 1 : 1; S.si = clamp(S.si + d, 0, n - 1); }
}

function onKey(raw) {
  const k = KEYMAP[raw] || raw;
  const V = view(); const cur = V[S.pi];
  if (k === 'ctrlc') return quit();
  if (S.searching) {
    if (k === 'esc') { S.query = ''; S.searching = false; S.pi = 0; S.si = 0; queryChanged(); }
    else if (k === 'enter') S.searching = false;
    else if (k === '\t') { S.deep = !S.deep; queryChanged(); }
    else if (k === 'bs') { S.query = S.query.slice(0, -1); S.pi = 0; S.si = 0; queryChanged(); }
    else if (k === 'up' || k === 'down') move(k === 'up' ? -1 : 1);
    else if (!KEYMAP[raw] && printable(k)) { S.query += k; S.pi = 0; S.si = 0; S.focus = 0; queryChanged(); }
    return render();
  }
  switch (k) {
    case 'q': return quit();
    case 'up': case 'k': move(-1); break;
    case 'down': case 'j': move(1); break;
    case 'pgup': move(-8); break;
    case 'pgdn': move(8); break;
    case 'home': case 'g': if (S.focus === 0) { S.pi = 0; S.si = 0; } else S.si = 0; break;
    case 'end': case 'G': if (S.focus === 0) { S.pi = Math.max(0, V.length - 1); S.si = 0; } else S.si = cur ? cur.ss.length : 0; break;
    case 'left': case 'h': S.focus = 0; break;
    case 'right': case 'l': if (cur) { S.focus = 1; S.si = Math.min(1, cur.ss.length); } break;
    case 'enter':
      if (!cur) break;
      if (S.focus === 0) { S.focus = 1; S.si = Math.min(1, cur.ss.length); break; }
      return launch(cur.p, S.si === 0 ? null : cur.ss[S.si - 1]);
    case 'n': if (cur) return launch(cur.p, null); break;
    case '/': S.searching = true; S.focus = 0; break;
    case 'r': reloadAsync(() => { const i = view().findIndex((x) => cur && x.p.key === cur.p.key); if (i >= 0) S.pi = i; }); break;
    case 'H': S.showHidden = !S.showHidden; break;
    case 'p': case 'x':
      if (cur) {
        const pr = cur.p; toggleProject(pr, k === 'p' ? 'pinned' : 'hidden');
        const i = view().findIndex((x) => x.p === pr); S.pi = i >= 0 ? i : Math.max(0, S.pi - 1); S.si = 0;
      }
      break;
    case 'esc':
      if (S.focus === 1) S.focus = 0; else if (S.query) { S.query = ''; S.pi = 0; } else return quit();
      break;
    default: break;
  }
  render();
}

function splash(done, total) {
  const c = process.stdout.columns || 80, r = process.stdout.rows || 24;
  const lines = [[C.brand + C.bold, '» Hopdeck'], ['', ''],
    [C.dim, `${spin()}  ${T.loading}${total ? `  ${done}/${total}` : '…'}`]];
  let out = '\x1b[2J';
  const art = mascotArt(c, r - lines.length - 2), gap = art.length ? 1 : 0; // la mascota va encima, si cabe
  const top = art.length ? Math.max(1, Math.floor((r - art.length - gap - lines.length) / 2) + 1) : Math.max(1, Math.floor(r / 2) - 1);
  art.forEach((_, j) => { out += `\x1b[${top + j};1H${mascotRow(art, j, c)}`; });
  lines.forEach(([st, t], i) => { out += `\x1b[${top + art.length + gap + i};${Math.max(1, Math.floor((c - strW(t)) / 2) + 1)}H${st}${t}${R}`; });
  process.stdout.write(out);
}

async function run() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) { printList(); return; }
  if (!SIDEBAR && process.env.HOPDECK_INSIDE) { console.log(T.inside); return; }
  if (!SIDEBAR) await offerShortcut(); // primera vez: ¿quieres que `claude` abra Hopdeck?
  if (!SIDEBAR) {
    // Por defecto se usa el terminal integrado (vista previa al pasar el cursor, imágenes). tmux solo con HOPDECK_TMUX=1,
    // o como alternativa si el terminal integrado no está disponible.
    const tmuxOk = !WIN && !process.env.HOPDECK_NOTMUX && !process.env.HOPDECK_EMBED && hasTmux();
    if (tmuxOk && process.env.HOPDECK_TMUX) return bootstrap();
    if (!process.env.HOPDECK_NOEMBED) { E.deps = loadDeps(); EMBED = !!E.deps; }
    if (!EMBED && tmuxOk) return bootstrap();
  }
  process.on('exit', () => { if (active) { try { process.stdout.write('\x1b[?1000l\x1b[?1003l\x1b[?1006l\x1b[?25h\x1b[?1049l'); } catch { /* */ } } });
  process.on('SIGTERM', () => quit(0));
  enter();
  splash(0, 0);
  const tick = setInterval(() => { frameN++; splash(prog[0], prog[1]); }, 90);
  const prog = [0, 0];
  S.projects = await scanAsync((d, t) => { prog[0] = d; prog[1] = t; });
  clearInterval(tick); invalidate();
  if (SIDEBAR || EMBED) {
    S.open = S.projects[0] && S.projects[0].key;
    restoreState();
    if (SIDEBAR) { process.stdout.write('\x1b[?1004h'); setInterval(refreshLive, 2000); }
  }
  process.stdout.on('resize', EMBED ? embedResize : () => { invalidate(); render(); });
  if (EMBED) setInterval(pollChats, 400);
  if (EMBED) setInterval(() => { if (active && E.git && embedLayout().GW) scheduleRender(); }, 4000); // el panel de git se refresca solo
  setInterval(() => { // lista siempre al día
    if (S.loading || reloading || S.searching || S.query || S.prompt !== null || S.help) return;
    if (SIDEBAR || EMBED) { const e = flatList()[S.c]; reloadAsync(() => { if (!e) return; const i = flatList().findIndex((x) => x.t === e.t && x.p.key === e.p.key && (e.t !== 's' || x.s.id === e.s.id)); if (i >= 0) S.c = i; }, true); }
    else { const cur = view()[S.pi]; reloadAsync(() => { if (!cur) return; const i = view().findIndex((v) => v.p.key === cur.p.key); if (i >= 0) S.pi = i; }, true); }
  }, 20000);
  process.stdin.on('data', (buf) => {
    if (!active) return;
    let s = normalizeKeys(buf.toString('utf8'));
    if (EMBED) { s = parseTermReplies(s, E); if (!s) return; } // respuestas del terminal a las consultas del arranque
    if (EMBED) {
      s = s.replace(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/g, (m, b, x, y, t) => { onMouse(+b, +x, +y, t); return ''; });
      if (!s) return;
      if (s === '\x1bOR' || s === '\x1b[13~') { CFG.mouse = !E.mouse; saveCfg(); return setMouse(!E.mouse); }
      if (E.gallery) { for (const k of parseKeys(s)) galleryKey(k); return; }
      if (s === '\x1b[17~' && E.focus === 'right') return closeChat(E.shown);
      if (s === '\x1b[18~') return openGalleryShown();
      if (s === '\x1b[19~') return toggleGit();
      if (s === '\x1b[20~') return toggleTheme();
      if (s === '\x1b[15~') { E.focus = 'left'; if (E.hideSide) E.hideSide = false; S.qs = { q: '', pc: 0, i: 0, off: 0 }; return embedResize(); }
      if (s === '\x1bOS' || s === '\x1b[14~') {
        E.hideSide = !E.hideSide && E.sessions.has(E.shown);
        E.focus = E.hideSide ? 'right' : 'left'; return embedResize();
      }
    }
    if (SIDEBAR) { // modo tmux: eventos de ratón de la lista y F3 para apagar/encender el ratón
      s = s.replace(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/g, (m, b, x, y, t) => { sidebarMouse(+b, +x, +y, t); return ''; });
      if (!s) return;
      if (s === '\x1bOR' || s === '\x1b[13~') { CFG.mouse = !E.mouse; saveCfg(); return setMouse(!E.mouse); }
    }
    if (EMBED && E.focus === 'right' && E.sessions.has(E.shown)) return embedInput(s);
    for (const k of parseKeys(s)) (SIDEBAR || EMBED ? onKeyTree : onKey)(k);
  });
  render();
}

function doctor() {
  const ok = (m) => console.log(`  ${C.ok}✔${R} ${m}`);
  const bad = (m, hint) => console.log(`  ${C.warn}✘${R} ${m}${hint ? `\n      ${C.dim}${hint}${R}` : ''}`);
  console.log(`\n  ${C.brand}${C.bold}» Hop${R}${C.text}${C.bold}deck doctor${R}  ${C.dim}v${VERSION}${R}\n`);
  if (parseInt(process.versions.node, 10) < 22) bad(T.dcNodeOld(process.version), T.dcNodeOldHint);
  else ok(`Node ${process.version} · ${process.platform} ${process.arch}`);
  const n = projectDirs().length;
  const histDir = shortPath(path.join(CONFIG_DIR, 'projects'));
  n ? ok(T.dcHist(n, histDir)) : bad(T.dcNoHist(histDir), T.dcNoHistHint);
  const bin = findClaude();
  bin ? ok(T.dcClaude(shortPath(bin))) : bad(T.dcNoClaude, WIN ? T.dcInstallWin : T.dcInstallUnix);
  const tm = !WIN && hasTmux();
  const deps = loadDeps();
  if (tm) ok(T.dcTmux);
  else if (deps) ok(T.dcEmbed);
  else bad(T.dcNone, WIN ? T.dcNoneWin : T.dcNoneUnix);
  let wrapped = false;
  for (const t of targets()) { try { if (fs.readFileSync(t.file, 'utf8').includes(MARK_A)) wrapped = true; } catch { /* */ } }
  wrapped ? ok(T.dcShort) : bad(T.dcNoShort, findClaude('hopdeck') ? T.dcNoShortHint : T.dcNoCmdHint); // sin el comando en el PATH, "hopdeck shortcut on" no existe todavía
  ok(T.dcPrefs(shortPath(CFG_FILE), shortPath(CACHE_FILE)));
  if (process.env.WT_SESSION) { // dentro de Windows Terminal: Ctrl+V solo pega texto y no deja pegar imágenes
    const f = wtSettingsFile(); let st = null;
    try { st = f ? wtCtrlV(fs.readFileSync(f, 'utf8')) : null; } catch { /* */ }
    if (st === 'custom') ok(T.wtOk);
    else if (st === 'paste') bad(T.wtBad, T.wtHint);
    else bad(T.wtUnknown, T.wtHint);
  }
  console.log('');
}

function printList() {
  for (const p of scan()) {
    console.log(clean(`${p.name}  (${p.sessions.length})  ${shortPath(p.cwd)}`));
    for (const s of p.sessions.slice(0, 5)) console.log(clean(`   ${ago(s.mtime).padEnd(8)} ${s.title}`));
  }
}

// ───────────────────────── instalación del atajo ─────────────────────────
const MARK_A = '# >>> hopdeck >>>';
const MARK_B = '# <<< hopdeck <<<';
const SNIP = {
  posix: `${MARK_A}
claude() {
  if [ $# -eq 0 ] && [ -t 0 ] && [ -t 1 ] && [ -z "$HOPDECK_SKIP" ] && command -v hopdeck >/dev/null 2>&1; then
    hopdeck
  else
    command claude "$@"
  fi
}
${MARK_B}
`,
  fish: `${MARK_A}
function claude
    if test (count $argv) -eq 0; and isatty stdin; and isatty stdout; and test -z "$HOPDECK_SKIP"; and type -q hopdeck
        hopdeck
    else
        command claude $argv
    end
end
${MARK_B}
`,
  pwsh: `${MARK_A}
function claude {
  if ($args.Count -eq 0 -and -not $env:HOPDECK_SKIP -and (Get-Command hopdeck -ErrorAction SilentlyContinue)) { hopdeck }
  else { & (Get-Command claude -CommandType Application | Select-Object -First 1).Source @args }
}
${MARK_B}
`,
};

function stripBlock(txt) {
  const a = txt.indexOf(MARK_A), b = txt.indexOf(MARK_B);
  if (a < 0 || b < 0) return txt;
  return (txt.slice(0, a) + txt.slice(b + MARK_B.length)).replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
}

function targets() {
  // HOPDECK_PROFILES (rutas separadas como las del PATH): perfiles a usar en lugar de los detectados. Pensado para las pruebas.
  if (process.env.HOPDECK_PROFILES) return process.env.HOPDECK_PROFILES.split(path.delimiter).filter(Boolean).map((file) => ({ file, kind: /\.ps1$/i.test(file) ? 'pwsh' : /\.fish$/i.test(file) ? 'fish' : 'posix' }));
  const list = []; const h = os.homedir();
  const add = (file, kind) => { if (!list.some((t) => t.file === file)) list.push({ file, kind }); };
  const sh = process.env.SHELL || '';
  if (WIN) {
    for (const exe of ['pwsh', 'powershell']) {
      try {
        const out = cp.execSync(`${exe} -NoProfile -Command "$PROFILE.CurrentUserCurrentHost"`, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }).toString().trim();
        if (out) add(out, 'pwsh');
      } catch { /* no instalado */ }
    }
    if (fs.existsSync(path.join(h, '.bashrc'))) add(path.join(h, '.bashrc'), 'posix'); // Git Bash
  } else {
    if (/zsh/.test(sh) || fs.existsSync(path.join(h, '.zshrc'))) add(path.join(h, '.zshrc'), 'posix');
    if (/bash/.test(sh) || fs.existsSync(path.join(h, '.bashrc'))) add(path.join(h, '.bashrc'), 'posix');
    if (/fish/.test(sh)) add(path.join(h, '.config', 'fish', 'conf.d', 'hopdeck.fish'), 'fish');
    if (!list.length) add(path.join(h, '.bashrc'), 'posix');
  }
  return list;
}

/**
 * Copia de seguridad del perfil de shell antes de tocarlo por primera vez: `<perfil>.hopdeck-backup`.
 * La primera copia es la original y no se sobrescribe. Si no se puede copiar, lanza el error y el perfil no se modifica.
 */
function backupProfile(file) {
  const bak = file + '.hopdeck-backup';
  if (!fs.existsSync(file) || fs.existsSync(bak)) return null;
  fs.copyFileSync(file, bak);
  return bak;
}

/** Añade (o quita, si `remove`) el atajo `claude` de los perfiles de shell. `list`/`quiet` permiten probarlo sin tocar tus perfiles reales. */
function install(remove, list = targets(), quiet = false) {
  const log = (m) => { if (!quiet) console.log(m); };
  const done = [], baks = [];
  for (const t of list) {
    try {
      let txt = null; try { txt = fs.readFileSync(t.file, 'utf8'); } catch { /* nuevo */ }
      if (remove && (txt === null || !txt.includes(MARK_A))) continue; // no hay nada que quitar: el archivo no se toca
      const before = txt || '';
      let out = stripBlock(before);
      if (!remove) out = (out && !out.endsWith('\n') ? out + '\n' : out) + (out ? '\n' : '') + SNIP[t.kind];
      if (out !== before) {
        const bak = backupProfile(t.file); if (bak) baks.push(bak);
        fs.mkdirSync(path.dirname(t.file), { recursive: true });
        fs.writeFileSync(t.file, out);
      }
      done.push(t.file);
    } catch (e) { log(`${C.warn}✗ ${t.file}: ${e.message}${R}`); }
  }
  const ok = (s) => `${C.ok}✓${R} ${s}`;
  baks.forEach((b) => log(ok(T.bakMsg(shortPath(b)))));
  if (remove) {
    log(ok(LANG === 'es' ? 'Atajo eliminado. Escribir "claude" vuelve a ser el comportamiento normal.' : 'Shortcut removed. Typing "claude" is back to normal.'));
  } else {
    done.forEach((f) => log(ok(shortPath(f))));
    if (!quiet) tutorial(true);
  }
  return { done, baks };
}

/**
 * Desinstala Hopdeck por completo: quita el atajo del perfil, borra sus preferencias y su caché y ejecuta `npm uninstall -g hopdeck`.
 * Pregunta antes (sin terminal exige --yes). No toca el historial de Claude Code ni las copias de seguridad de tus perfiles.
 * HOPDECK_NO_NPM=1 no ejecuta npm (para las pruebas). Devuelve el código de salida.
 */
async function uninstallAll({ yes = false, list = targets() } = {}) {
  const tty = process.stdin.isTTY && process.stdout.isTTY;
  if (!yes) {
    if (!tty) { console.error(`${C.warn}${T.unNeedYes}${R}`); return 2; }
    process.stdout.write(`\n  ${C.text}${C.bold}${T.unQ}${R}\n  ${C.dim}${T.unInfo}${R}\n\n  ${C.accent}${T.unKeys}${R}\n`);
    const ans = await readKey((k) => (/^[sSyY]$/.test(k) ? 'yes' : /^[nN]$/.test(k) || k === '\r' || k === '\n' || k === '\x1b' ? 'no' : undefined));
    if (ans !== 'yes') { console.log(`\n  ${C.dim}${T.unCancel}${R}`); return 0; }
  }
  const ok = (m) => console.log(`  ${C.ok}✓${R} ${m}`), note = (m) => console.log(`  ${C.dim}· ${m}${R}`);
  console.log('');
  const had = hasShortcut(list);
  const r = install(true, list, true);
  if (had && r.done.length) ok(T.unShortcutOff); else note(T.unNoShortcut);
  for (const f of [CFG_FILE, CACHE_FILE, CACHE_FILE + '.tmp']) { try { fs.rmSync(f, { force: true }); } catch { /* */ } }
  ok(T.unData);
  if (process.env.HOPDECK_NO_NPM) { note(T.unSkipNpm); console.log(`\n  ${C.dim}${T.unDone}${R}`); return 0; }
  const res = cp.spawnSync('npm uninstall -g hopdeck', { shell: true, stdio: 'inherit' }); // comando fijo, sin datos de fuera
  if (res.status === 0 && !fs.existsSync(__filename)) ok(T.unProgram);
  else console.log(`  ${C.warn}✗${R} ${T.unProgramFail(path.dirname(__dirname))}`);
  console.log(`\n  ${C.dim}${T.unDone}${R}`);
  return 0;
}

// ── Primer arranque: ofrecer que escribir `claude` abra Hopdeck ──
const markAsked = () => { CFG.shortcutAsked = true; saveCfg(); };
const hasShortcut = (list) => list.some((t) => { try { return fs.readFileSync(t.file, 'utf8').includes(MARK_A); } catch { return false; } });

/** Espera una tecla; `accept(k)` devuelve el valor a entregar, o undefined para seguir esperando. Ctrl+C sale. */
function readKey(accept) {
  return new Promise((resolve) => {
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true); process.stdin.resume();
    const on = (buf) => {
      const k = buf.toString('utf8');
      if (k === '\x03') { try { process.stdin.setRawMode(false); } catch { /* */ } process.stdout.write('\n'); process.exit(130); }
      const v = accept(k);
      if (v === undefined) return;
      process.stdin.removeListener('data', on);
      try { process.stdin.setRawMode(!!wasRaw); } catch { /* */ }
      process.stdin.pause();
      resolve(v);
    };
    process.stdin.on('data', on);
  });
}

/**
 * Pinta la pregunta, espera la respuesta y la BORRA de la pantalla (si no, se quedaba escrita como si siguiera pendiente).
 * Cada línea se ajusta al ancho del terminal para saber exactamente cuántas ocupa y poder subir el cursor hasta el principio.
 */
async function askShortcut() {
  const width = Math.max(30, (process.stdout.columns || 80) - 4);
  const block = ['', `  ${C.brand}${C.bold}» Hop${R}${C.text}${C.bold}deck${R}`, '', `  ${C.text}${C.bold}${T.offerQ}${R}`,
    ...wrapText(T.offerInfo, width).map((l) => `  ${C.dim}${l}${R}`), '', `  ${C.accent}${T.offerKeys}${R}`];
  process.stdout.write(block.join('\n') + '\n');
  const ans = await readKey((k) => (k === '\r' || k === '\n' || /^[sSyY]$/.test(k) ? 'yes' : /^[nN]$/.test(k) ? 'no' : k === '\x1b' || /^[mM]$/.test(k) ? 'later' : undefined));
  process.stdout.write(`\x1b[${block.length}A\x1b[J`); // sube hasta el principio de la pregunta y la borra
  if (ans === 'no') process.stdout.write(`  ${C.dim}${T.offerNo}${R}\n`);
  else if (ans === 'later') process.stdout.write(`  ${C.dim}${T.offerLater}${R}\n`);
  return ans;
}

/**
 * La primera vez que se abre Hopdeck pregunta si `claude` a secas debe abrirlo (instala el atajo, con copia de seguridad del perfil).
 * Solo pregunta una vez ("Más tarde" no cuenta) y nunca si ya está instalado. Devuelve el resultado; `opts` permite probarlo sin terminal.
 */
async function offerShortcut(opts = {}) {
  if (CFG.shortcutAsked || process.env.HOPDECK_NOPROMPT) return 'skipped';
  const list = opts.list || targets();
  if (hasShortcut(list)) { markAsked(); return 'installed'; }
  const ans = await (opts.ask || askShortcut)();
  if (ans === 'no') { markAsked(); return 'no'; }
  if (ans !== 'yes') return 'later';
  const r = install(false, list, true);
  markAsked();
  if (!opts.quiet) {
    process.stdout.write(`\n  ${r.done.length ? `${C.ok}✓${R} ${T.offerDone}` : `${C.warn}✗${R} ${T.offerFail}`}\n`);
    r.baks.forEach((b) => process.stdout.write(`  ${C.dim}${T.bakMsg(shortPath(b))}${R}\n`));
    process.stdout.write(`\n  ${C.dim}${T.offerCont}${R}`);
    await readKey(() => true);
    process.stdout.write('\r\x1b[2K'); // borra la línea «Pulsa una tecla…» y deja solo el resultado
  }
  return r.done.length ? 'yes' : 'failed';
}

function tutorial(afterInstall) {
  const a = C.accent, d = C.dim, b = C.bold;
  const L = LANG === 'es' ? [
    `${C.brand}${b}» Hop${R}${C.text}${b}deck${R}  ${d}v${VERSION}${R}`, '',
    afterInstall ? `${C.ok}Listo.${R} Abre una terminal nueva y escribe ${b}claude${R}.` : `Escribe ${b}hopdeck${R} (o solo ${b}claude${R} si instalaste el atajo).`, '',
    `${a}1${R} Elige un proyecto con ${a}↑ ↓${R}  ${d}(panel izquierdo)${R}`,
    `${a}2${R} Pulsa ${a}→${R} o ${a}⏎${R} para ver sus conversaciones anteriores`,
    `${a}3${R} ${a}⏎${R} reanuda una conversación · ${a}＋ Nueva${R} o ${a}n${R} empieza una nueva`,
    `${a}4${R} Al salir de Claude (${d}/exit${R}) vuelves aquí, sin abrir otra terminal`, '',
    `${d}/ buscar · r recargar · q salir${R}`,
    `${d}claude con argumentos (claude -p "...", claude --resume) funciona igual que siempre.${R}`,
    `${d}Quitar el atajo: hopdeck shortcut off · Desinstalar todo: hopdeck uninstall${R}`,
  ] : [
    `${C.brand}${b}» Hop${R}${C.text}${b}deck${R}  ${d}v${VERSION}${R}`, '',
    afterInstall ? `${C.ok}Done.${R} Open a new terminal and type ${b}claude${R}.` : `Type ${b}hopdeck${R} (or just ${b}claude${R} if you installed the shortcut).`, '',
    `${a}1${R} Pick a project with ${a}↑ ↓${R}  ${d}(left pane)${R}`,
    `${a}2${R} Press ${a}→${R} or ${a}⏎${R} to see its previous conversations`,
    `${a}3${R} ${a}⏎${R} resumes a conversation · ${a}＋ New${R} or ${a}n${R} starts a fresh one`,
    `${a}4${R} When you exit Claude (${d}/exit${R}) you land back here — no new terminal needed`, '',
    `${d}/ search · r reload · q quit${R}`,
    `${d}claude with arguments (claude -p "...", claude --resume) works as usual.${R}`,
    `${d}Remove the shortcut: hopdeck shortcut off · Uninstall everything: hopdeck uninstall${R}`,
  ];
  console.log('\n' + L.map((x) => '  ' + x).join('\n') + '\n');
}

// ───────────────────────── entrada ─────────────────────────
// ── Comandos: UNA sola forma para cada uno (shortcut on|off, uninstall, doctor, help). Lo demás no hace nada: da un error con una sugerencia ──
const COMMANDS = ['shortcut', 'theme', 'mascot', 'uninstall', 'doctor', 'help'];
// Palabras que alguien escribiría para lo mismo: no son comandos y no se ejecutan, solo sirven para sugerir el correcto
const SYNONYMS = { install: 'shortcut on', instalar: 'shortcut on', atajo: 'shortcut on', desinstalar: 'uninstall', remove: 'uninstall', delete: 'uninstall', ayuda: 'help', diagnostico: 'doctor', version: '--version', list: '--list', tema: 'theme', mascota: 'mascot', sapo: 'mascot', frog: 'mascot', modo: 'theme', mode: 'theme', dark: 'theme dark', light: 'theme light', oscuro: 'theme dark', claro: 'theme light' };
/** Nombre de comando si `arg` es exactamente uno (sin guiones ni variantes); null si no. */
const commandName = (arg) => (COMMANDS.includes(String(arg || '').toLowerCase()) ? String(arg).toLowerCase() : null);
const editDistance = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
/** El comando que se quiso escribir (por parecido, sin contar guiones, o por sinónimo), o null. */
function suggestCommand(word) {
  const w = String(word || '').replace(/^-+/, '').toLowerCase();
  if (SYNONYMS[w]) return SYNONYMS[w];
  let best = null, bd = 3;
  for (const c of COMMANDS) { const d = editDistance(w, c); if (d < bd) { bd = d; best = c; } }
  return best;
}
// Opciones que el propio programa entiende; el resto de lo que empiece por "-" se pasa a claude
const OWN_FLAGS = ['--help', '-h', '--version', '-v', '--list', '--idle', '--frame', '--sidebar'];

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  // una palabra suelta, o una opción con guiones que se parece a un comando (--uninstall, --unistall…), es una errata: no se abre
  // Hopdeck ni se le pasa nada a claude
  if (cmd && !commandName(cmd) && !OWN_FLAGS.includes(cmd) && (!cmd.startsWith('-') || suggestCommand(cmd))) {
    const sug = suggestCommand(cmd);
    console.error(`${C.warn}${T.unknownCmd(cmd)}${R}${sug ? ' ' + T.didYouMean(sug) : ''}\n${C.dim}${T.cmdList}${R}`);
    process.exit(2);
  }
  if (commandName(cmd) === 'shortcut') { // hopdeck shortcut on | off: solo el atajo de claude
    if (rest.length !== 1 || !['on', 'off'].includes(rest[0])) { console.error(`${C.warn}${T.shortcutUsage}${R}`); process.exit(2); }
    install(rest[0] === 'off'); markAsked();
  }
  else if (commandName(cmd) === 'theme') { // hopdeck theme [light|dark|auto]: guarda el tema (la variable HOPDECK_THEME manda sobre esto)
    if (rest.length > 1 || (rest[0] && !['light', 'dark', 'auto'].includes(rest[0]))) { console.error(`${C.warn}${T.themeUsage}${R}`); process.exit(2); }
    if (rest[0]) { if (rest[0] === 'auto') delete CFG.theme; else CFG.theme = rest[0]; saveCfg(); }
    const env = !!process.env.HOPDECK_THEME; // lo que se usará la próxima vez que abras Hopdeck
    const eff = env ? (LIGHT ? 'light' : 'dark') : CFG.theme || (/;(7|15)$/.test(process.env.COLORFGBG || '') ? 'light' : 'dark');
    console.log(T.themeShow(CFG.theme || 'auto', eff, CFG.theme ? 'config' : 'auto', env));
  }
  else if (commandName(cmd) === 'mascot') { // hopdeck mascot [--size small|normal|large] [--plain]: dibuja la mascota (sin colores con --plain o NO_COLOR)
    const sizes = { small: 32, normal: 48, large: 64 }; let size = 'normal', plain = false, bad = false;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--plain') plain = true;
      else if (rest[i] === '--size' && sizes[rest[i + 1]]) size = rest[++i];
      else bad = true;
    }
    if (bad) { console.error(`${C.warn}${T.mascotUsage}${R}`); process.exit(2); }
    if (plain || NOCOL) console.log(mascot.ASCII);
    else { const cols = process.stdout.isTTY ? process.stdout.columns || 80 : 999; console.log(mascot.render(Math.max(16, Math.min(sizes[size], cols))).join('\n')); }
  }
  else if (commandName(cmd) === 'uninstall') { // desinstalación completa: atajo, preferencias, caché y programa
    if (rest.some((a) => a !== '--yes' && a !== '-y')) { console.error(`${C.warn}${T.unknownCmd(rest.find((a) => a !== '--yes' && a !== '-y'))}${R}\n${C.dim}${T.cmdList}${R}`); process.exit(2); }
    uninstallAll({ yes: rest.length > 0 }).then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
  }
  else if (commandName(cmd) === 'help' || cmd === '--help' || cmd === '-h') tutorial(false);
  else if (cmd === '--version' || cmd === '-v') console.log(VERSION);
  else if (cmd === '--list') printList();
  else if (commandName(cmd) === 'doctor') doctor();
  else if (cmd === '--idle') idle();
  else if (cmd === '--frame') { // vista previa de un cuadro (pruebas)
    load();
    S.pi = +process.env.HOPDECK_PI || 0; S.focus = +process.env.HOPDECK_FOCUS || 0; S.si = +process.env.HOPDECK_SI || 0;
    const c = +process.env.COLUMNS || 100, r = +process.env.LINES || 28;
    if (process.env.HOPDECK_TREE) { S.open = S.projects[1] && S.projects[1].key; S.c = +process.env.HOPDECK_C || 0; console.log(frameTree(c, r).join('\n')); }
    else console.log(frame(c, r).join('\n'));
  } else {
    extraArgs.push(...[cmd, ...rest].filter((a) => a && a !== '--sidebar'));
    run().catch((e) => { try { leave(); } catch { /* */ } console.error(e); process.exit(1); });
  }
}

if (require.main === module) main();
else {
  // al hacer require() (pruebas automáticas) no se ejecuta nada: solo se exponen las piezas puras
  module.exports = {
    cw, strW, fit, clean, hl, gitRows, gitInfo, toggleGit, imageExt, exportImages, safeId, findClaude, install, backupProfile, ago, tidy, fuzzy, wrapText, parseKeys, KEYMAP, isType, T, S, CFG, E,
    readSession, buildProject, scan, scanAsync, finishScan, sortProjects, projectDirs,
    view, flatList, stripBlock, offerShortcut, uninstallAll, commandName, suggestCommand, parseTermReplies, sixelOn, SNIP, MARK_A, MARK_B, toggleProject, cacheLoad, selNorm,
    decodePNG, decodeImage, scaleBox, fitSize, halfBlocks, collectImages, extractImages,
    onMouse, dragPanel, panelLimits, embedLayout, sessTag, editBuf, normalizeKeys, stripJsonc, wtCtrlV, fbNames, fbOpen, fbRows, sidebarMouse, toggleTheme, gitBranch, imageMarkerAt, shownSession, linkChats, findImageByNumber: images.findImageByNumber,
  };
}
