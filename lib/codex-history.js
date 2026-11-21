'use strict';
// Use Codex's local JSON-RPC API rather than depending on its private SQLite/rollout formats.
const cp = require('child_process');
const readline = require('readline');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { fileURLToPath } = require('url');
const { sniffExt } = require('./images');
const { findExecutable } = require('./executable');
const { baseName, tidy } = require('./text');

class CodexClient {
  constructor({ bin, args = ['app-server'], timeout = 30000 } = {}) {
    this.bin = bin; this.args = args; this.timeout = timeout; this.next = 1;
    this.pending = new Map(); this.proc = null; this.ready = null; this.batch = false;
  }
  start() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const bin = this.bin || findExecutable('codex');
      if (!bin) throw new Error('Codex CLI not found in PATH');
      const batch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
      this.batch = batch;
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
      await this.send('initialize', { clientInfo: { name: 'hopdeck', title: 'Hopdeck', version: require('../package.json').version } });
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
    if (p) {
      try {
        if (this.batch && p.pid) {
          // npm's Windows shim leaves the server in a grandchild. Killing only cmd.exe can keep
          // the parent ConPTY open after Hopdeck exits. Stop this owned process tree together.
          const result = cp.spawnSync('taskkill.exe', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 5000 });
          if (result.status !== 0) p.kill();
        } else p.kill();
      } catch { try { p.kill(); } catch { /* closed */ } }
      p.stdin.destroy();
    }
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
    if (item.type === 'userMessage') {
      role = 'user'; text = (item.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      const count = (item.content || []).filter((c) => c.type === 'image' || c.type === 'localImage').length;
      const labels = Array.from({ length: count }, (_, i) => `[Image #${i + 1}]`).filter((label) => !text.includes(label));
      text = [...labels, text].filter(Boolean).join('\n');
    }
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

// Read attachments through the same public history API. Never fetch remote image URLs.
const MAX_IMAGE_BYTES = 18 * 1024 * 1024;
async function readImage(ref, cwd) {
  let bytes, file;
  if (typeof ref.url === 'string' && ref.url.startsWith('data:')) {
    if (ref.url.length > MAX_IMAGE_BYTES * 4 / 3 + 128) return null;
    const match = /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\r\n]+)$/i.exec(ref.url);
    if (!match) return null;
    bytes = Buffer.from(match[1], 'base64');
  } else {
    try {
      file = ref.path || (typeof ref.url === 'string' && ref.url.startsWith('file:') ? fileURLToPath(ref.url) : null);
      if (!file || /\0/.test(file) || /^[/\\]{2}/.test(file)) return null;
      if (!path.isAbsolute(file)) { if (!cwd || !path.isAbsolute(cwd)) return null; file = path.resolve(cwd, file); }
      const handle = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0));
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES || stat.size < 13) return null;
        const header = Buffer.alloc(16); await handle.read(header, 0, header.length, 0);
        if (sniffExt(header) === 'img' && header.toString('latin1', 0, 2) !== 'BM') return null;
        // Bound the read even if the file grows after stat().
        bytes = Buffer.alloc(stat.size); let offset = 0;
        while (offset < bytes.length) { const read = await handle.read(bytes, offset, bytes.length - offset, offset); if (!read.bytesRead) break; offset += read.bytesRead; }
        bytes = bytes.subarray(0, offset);
      } finally { await handle.close(); }
    } catch { return null; }
  }
  if (!bytes || bytes.length > MAX_IMAGE_BYTES) return null;
  const ext = sniffExt(bytes), bmp = bytes.toString('latin1', 0, 2) === 'BM';
  if (ext === 'img' && !bmp) return null;
  return { data: bytes.toString('base64'), media: `image/${bmp ? 'bmp' : ext === 'jpg' ? 'jpeg' : ext}` };
}

async function* attachmentItems(client, session, sortDirection = 'asc') {
  let page;
  try { page = await client.request('thread/items/list', { threadId: session.id, limit: 50, sortDirection, cursor: null }); }
  catch (err) {
    if (err.code !== -32601 && !/unknown method|unknown variant|unsupported|not found/i.test(err.message)) throw err;
    const result = await client.request('thread/read', { threadId: session.id, includeTurns: true });
    const items = (result.thread?.turns || []).flatMap((turn) => turn.items || []);
    for (const item of sortDirection === 'desc' ? items.reverse() : items) yield item;
    return;
  }
  const cursors = new Set(), ids = new Set();
  while (true) {
    for (const entry of page.data || []) {
      const item = entry.item || entry;
      if (item.id && ids.has(item.id)) continue;
      if (item.id) ids.add(item.id);
      yield item;
    }
    if (!page.nextCursor) return;
    if (cursors.has(page.nextCursor)) throw new Error('Codex returned a repeated image history cursor');
    cursors.add(page.nextCursor);
    page = await client.request('thread/items/list', { threadId: session.id, limit: 50, sortDirection, cursor: page.nextCursor });
  }
}

function attachments(item) {
  if (item.type === 'userMessage') {
    const content = item.content || [];
    // Codex's TUI numbers remote inputs first, then local inputs, starting at 1 per message.
    return [...content.filter((c) => c.type === 'image'), ...content.filter((c) => c.type === 'localImage')]
      .map((ref, i) => ({ ...ref, n: i + 1 }));
  }
  if (item.type === 'imageView') return [{ path: item.path }];
  if (item.type === 'imageGeneration' && item.status === 'completed') {
    return [item.savedPath ? { path: item.savedPath } : { url: typeof item.result === 'string' ? 'data:image/png;base64,' + item.result : undefined }];
  }
  return [];
}

async function sessionImages(client, session, max = 200) {
  const out = []; let bytes = 0;
  for await (const item of attachmentItems(client, session)) for (const ref of attachments(item)) {
    const image = await readImage(ref, session.cwd);
    if (!image) continue;
    out.push({ ...image, ...(ref.n ? { n: ref.n } : {}) }); bytes += image.data.length;
    if (out.length >= max || bytes >= 64e6) return out;
  }
  return out;
}

async function findSessionImage(client, session, n, fromEnd = 0) {
  if (!Number.isSafeInteger(n) || n < 1 || !Number.isSafeInteger(fromEnd) || fromEnd < 0) return null;
  for await (const item of attachmentItems(client, session, 'desc')) for (const ref of attachments(item)) if (ref.n === n) {
    if (fromEnd-- === 0) return readImage(ref, session.cwd);
  }
  return null;
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
  CodexClient, isCodexThread, groupThreads, listProjects, messagesFromItems, preview, sessionImages, findSessionImage, scanSync, close,
  scanProjectsAsync: (progress) => listProjects(getClient(), progress),
  previewSession: (session, limit) => preview(getClient(), session, limit),
  imagesSession: (session, max) => sessionImages(getClient(), session, max),
  imageForNumber: (session, n, fromEnd) => findSessionImage(getClient(), session, n, fromEnd),
  CONFIG_DIR: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
};
if (require.main === module) {
  listProjects(getClient()).then((projects) => { process.stdout.write(JSON.stringify(projects)); close(); }, (err) => { console.error(err.message); close(); process.exitCode = 1; });
}
