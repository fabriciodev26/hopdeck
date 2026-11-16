'use strict';
// Lectura de solo lectura del estado de git de una carpeta, para el panel de git: rama actual, cambios sin guardar,
// ramas recientes y la actividad de ramas (cambios de rama, ramas creadas, merges) que git guarda en su reflog.
// Nunca modifica el repositorio. Solo se ejecutan comandos fijos (`status`, `reflog show`, `for-each-ref`) sin shell.
const cp = require('child_process');

// GIT_OPTIONAL_LOCKS=0: `status` no escribe en .git. core.fsmonitor=false: un repositorio ajeno no puede lanzar un programa
// propio a través de su configuración mientras lo miramos. LC_ALL=C: salida estable, sin traducir.
const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', LC_ALL: 'C' };
const BASE = ['-c', 'core.fsmonitor=false', '--no-pager'];

function run(cwd, args) {
  return new Promise((resolve) => {
    try {
      cp.execFile('git', [...BASE, ...args], { cwd, env: ENV, timeout: 6000, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
        (err, out, errOut) => resolve({ ok: !err, out: String(out || ''), err: String(errOut || ''), missing: !!(err && err.code === 'ENOENT') }));
    } catch (e) { resolve({ ok: false, out: '', err: String(e.message || e), missing: false }); }
  });
}

/** `git status --porcelain=v1 -b` → { branch, upstream, ahead, behind, detached, files: [{ x, y, path }] } */
function parseStatus(out) {
  const res = { branch: '', upstream: '', ahead: 0, behind: 0, detached: false, files: [] };
  for (const line of String(out).split('\n')) {
    if (!line) continue;
    if (line.startsWith('## ')) {
      const h = line.slice(3);
      let m;
      if ((m = h.match(/^No commits yet on (.+)$/))) { res.branch = m[1]; continue; }
      if (/^HEAD \(no branch\)/.test(h)) { res.detached = true; res.branch = 'HEAD'; continue; }
      m = h.match(/^(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/);
      if (m) {
        res.branch = m[1]; res.upstream = m[2] || '';
        const a = (m[3] || '').match(/ahead (\d+)/), b = (m[3] || '').match(/behind (\d+)/);
        res.ahead = a ? +a[1] : 0; res.behind = b ? +b[1] : 0;
      }
      continue;
    }
    if (line.length < 4) continue;
    res.files.push({ x: line[0], y: line[1], path: line.slice(3).replace(/^"(.*)"$/, '$1') });
  }
  return res;
}

/**
 * `git reflog show --all --date=unix --format=%gd%x09%gs` → actividad de ramas, la más reciente primero:
 * { k: 'switch', from, to, t } · { k: 'create', name, from, t } · { k: 'merge', what, t } · { k: 'rebase', t }   (t en segundos)
 */
function parseActivity(out, limit = 20) {
  const list = [];
  String(out).split('\n').forEach((line, idx) => {
    const m = line.match(/^(.+)@\{(\d+)\}\t(.*)$/);
    if (!m) return;
    const [, ref, ts, subj] = m, t = +ts;
    let e = null, s;
    if (ref === 'HEAD' && (s = subj.match(/^checkout: moving from (.+) to (.+)$/))) e = { k: 'switch', from: s[1], to: s[2], t };
    else if (ref !== 'HEAD' && (s = subj.match(/^branch: Created from (.+)$/))) e = { k: 'create', name: ref, from: s[1], t };
    else if (ref === 'HEAD' && (s = subj.match(/^merge (.+?)(?:: .*)?$/))) e = { k: 'merge', what: s[1], t };
    else if (ref === 'HEAD' && /^rebase.*\(finish\)/.test(subj)) e = { k: 'rebase', t };
    if (e) list.push({ ...e, idx });
  });
  return list.sort((a, b) => b.t - a.t || a.idx - b.idx).slice(0, limit).map(({ idx, ...e }) => e);
}

/** `git for-each-ref …` con %(HEAD)\t%(refname:short)\t%(committerdate:unix) → [{ cur, name, t }] */
function parseBranches(out) {
  return String(out).split('\n').map((l) => l.split('\t')).filter((p) => p.length >= 3 && p[1])
    .map(([h, name, t]) => ({ cur: h.trim() === '*', name, t: +t || 0 }));
}

// En macOS, sin las Command Line Tools /usr/bin/git es un atajo que abre el instalador de Apple: no se llama a git si es lo único que hay.
let macGit = null;
async function gitUsableOnMac() {
  if (process.platform !== 'darwin') return true;
  if (macGit !== null) return macGit;
  const run1 = (cmd, args) => new Promise((res) => { try { cp.execFile(cmd, args, { timeout: 3000 }, (err, out) => res({ ok: !err, out: String(out || '').trim() })); } catch { res({ ok: false, out: '' }); } });
  macGit = (await run1('/usr/bin/xcode-select', ['-p'])).ok || (await run1('/usr/bin/which', ['git'])).out.replace(/\/+$/, '') !== '/usr/bin/git';
  return macGit;
}

/** Estado completo de una carpeta: { ok, repo, missing, status, activity, branches } (nunca lanza). */
async function readGit(cwd) {
  if (!(await gitUsableOnMac())) return { ok: false, repo: true, missing: true };
  const st = await run(cwd, ['status', '--porcelain=v1', '-b']);
  if (st.missing) return { ok: false, repo: true, missing: true };
  if (!st.ok) return { ok: false, repo: !/not a git repository/i.test(st.err), err: st.err.trim().split('\n')[0] || '' };
  const [rl, br] = await Promise.all([
    run(cwd, ['reflog', 'show', '--all', '--date=unix', '--format=%gd%x09%gs']),
    run(cwd, ['for-each-ref', '--sort=-committerdate', '--count=8', '--format=%(HEAD)%09%(refname:short)%09%(committerdate:unix)', 'refs/heads']),
  ]);
  return { ok: true, repo: true, status: parseStatus(st.out), activity: rl.ok ? parseActivity(rl.out) : [], branches: br.ok ? parseBranches(br.out) : [] };
}

module.exports = { readGit, parseStatus, parseActivity, parseBranches };
