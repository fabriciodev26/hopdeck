'use strict';
// Use Codex's local JSON-RPC API rather than depending on its private SQLite/rollout formats.
const cp = require('child_process');
const readline = require('readline');
const os = require('os');
const path = require('path');
const { findExecutable } = require('./executable');
const { baseName, tidy } = require('./text');

class CodexClient {
  constructor({ bin, args = ['app-server'], timeout = 30000 } = {}) {
    this.bin = bin; this.args = args; this.timeout = timeout; this.next = 1;
    this.pending = new Map(); this.proc = null; this.ready = null;
  }
  start() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const bin = this.bin || findExecutable('codex');
      if (!bin) throw new Error('Codex CLI not found in PATH');
      const batch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
      // Only the trusted executable and fixed app-server argument enter cmd.exe; RPC data uses stdin.
      const p = this.proc = cp.spawn(batch ? process.env.ComSpec || 'cmd.exe' : bin,
        batch ? ['/d', '/s', '/c', `""${bin}" app-server"`] : this.args,
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, windowsVerbatimArguments: batch, env: { ...process.env, HOPDECK_SKIP: '1' } });
      const fail = (err) => {
        if (this.proc !== p) return;
        for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(err); }
        this.pending.clear();
        if (this.proc === p) { this.proc = null; this.ready = null; }
      };
      p.on('error', fail);
      p.on('exit', (code) => fail(new Error('Codex app-server exited' + (code ? ' (' + code + ')' : ''))));
      p.stdin.on('error', fail);
      p.stderr.resume(); // never expose logs, auth data or personal history in the UI
      this.lines = readline.createInterface({ input: p.stdout });
      this.lines.on('line', (line) => {
        let msg; try { msg = JSON.parse(line); } catch { return; }
        const request = !msg.method && this.pending.get(msg.id);
        if (request) {
          clearTimeout(request.timer); this.pending.delete(msg.id);
          if (msg.error) { const err = new Error(msg.error.message || 'Codex request failed'); err.code = msg.error.code; request.reject(err); }
          else request.resolve(msg.result);
        } else if (msg.id !== undefined && msg.method) {
          // This client only reads history: it never approves server-initiated actions.
          p.stdin.write(JSON.stringify({ id: msg.id, error: { code: -32601, message: 'Unsupported request' } }) + '\n');
        }
      });
      await this.send('initialize', { clientInfo: { name: 'hopdeck', title: 'Hopdeck', version: '1.4.3' } });
      p.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    })().catch((err) => { this.close(); throw err; });
    return this.ready;
  }
  send(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.proc) return reject(new Error('Codex app-server is not running'));
      const id = this.next++;
      const timer = setTimeout(() => { this.close(new Error('Codex request timed out: ' + method)); }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  async request(method, params) { await this.start(); return this.send(method, params); }
  close(err = new Error('Codex history connection closed')) {
    const p = this.proc; this.proc = null; this.ready = null;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(err); }
    this.pending.clear();
    if (this.lines) this.lines.close();
    if (p) { p.stdin.destroy(); try { p.kill(); } catch { /* closed */ } }
  }
}

// The store is shared with Work clients. A directory or a "vscode" source alone does not prove
// that the user created the conversation in Codex. Keep only known Codex clients, with a
// source-only fallback for legacy CLI sessions whose protocol predates originator metadata.
const CODEX_SOURCES = new Set(['cli', 'vscode', 'appServer']);
const CODEX_ORIGINATORS = new Set(['codex_cli_rs', 'codex_vscode', 'codex desktop']);
function isCodexThread(thread) {
  if (!thread || !CODEX_SOURCES.has(thread.source)) return false;
  const origin = typeof thread.originator === 'string' ? thread.originator.trim().toLowerCase() : '';
  return origin ? CODEX_ORIGINATORS.has(origin) : thread.source === 'cli';
}

function groupThreads(threads) {
  const groups = new Map(), seen = new Set();
  for (const t of threads) {
    if (!isCodexThread(t) || !t.id || !t.cwd || seen.has(t.id)) continue;
    seen.add(t.id);
    const cwd = t.cwd;
    let p = groups.get(cwd);
    if (!p) { p = { key: 'codex:' + cwd, cwd, name: baseName(cwd), sessions: [], mtime: 0 }; groups.set(cwd, p); }
    const mtime = Number(t.updatedAt || t.createdAt || 0) * 1000;
    const first = tidy(typeof t.preview === 'string' ? t.preview : '').slice(0, 300);
    p.sessions.push({ id: t.id, title: tidy(t.name || first || t.id), first, cwd, mtime, last: mtime, provider: 'codex', source: t.source, originator: t.originator || null });
    p.mtime = Math.max(p.mtime, mtime);
  }
  for (const p of groups.values()) p.sessions.sort((a, b) => b.mtime - a.mtime);
  return [...groups.values()];
}

async function listProjects(client, onProgress) {
  const threads = [], cursors = new Set(); let cursor = null;
  do {
    const page = await client.request('thread/list', { limit: 100, sortKey: 'updated_at', archived: false, sourceKinds: [...CODEX_SOURCES], cursor });
    threads.push(...(page.data || []));
    if (onProgress) onProgress(threads.length, threads.length);
    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) throw new Error('Codex returned a repeated history cursor');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return groupThreads(threads);
}

function messagesFromItems(items) {
  return items.flatMap((item) => {
    let role, text;
    if (item.type === 'userMessage') { role = 'user'; text = (item.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n'); }
    else if (item.type === 'agentMessage') { role = 'assistant'; text = item.text; }
    if (!role || typeof text !== 'string' || !text.trim()) return [];
    return [{ role, text: tidy(text).slice(0, 700) }];
  });
}

async function preview(client, session, limit = 12) {
  try {
    // New versions support bounded item pagination for both paginated and legacy history.
    const items = []; let cursor = null;
    for (let i = 0; i < 5; i++) {
      const page = await client.request('thread/items/list', { threadId: session.id, limit: 50, sortDirection: 'desc', cursor });
      items.push(...(page.data || []).map((entry) => entry.item || entry));
      if (messagesFromItems(items).length >= limit || !page.nextCursor || page.nextCursor === cursor) break;
      cursor = page.nextCursor;
    }
    return messagesFromItems(items.reverse()).slice(-limit);
  } catch (err) {
    // Older releases expose turns through thread/read instead.
    if (err.code !== -32601 && !/unknown method|unknown variant|unsupported|not found/i.test(err.message)) throw err;
    const result = await client.request('thread/read', { threadId: session.id, includeTurns: true });
    return messagesFromItems((result.thread?.turns || []).flatMap((turn) => turn.items || [])).slice(-limit);
  }
}

let client;
const getClient = () => client || (client = new CodexClient());
const close = () => { if (client) client.close(); client = null; };
// Text-only commands use a short-lived process so synchronous callers retain their existing API.
function scanSync() {
  const result = cp.spawnSync(process.execPath, [__filename, '--list'], { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'Could not read Codex history');
  return JSON.parse(result.stdout);
}
module.exports = {
  CodexClient, isCodexThread, groupThreads, listProjects, messagesFromItems, preview, scanSync, close,
  scanProjectsAsync: (progress) => listProjects(getClient(), progress),
  previewSession: (session, limit) => preview(getClient(), session, limit),
  CONFIG_DIR: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
};
if (require.main === module) {
  listProjects(getClient()).then((projects) => { process.stdout.write(JSON.stringify(projects)); close(); }, (err) => { console.error(err.message); close(); process.exitCode = 1; });
}
