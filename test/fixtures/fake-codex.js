'use strict';
const fs = require('fs');
const args = process.argv.slice(2);
const file = process.env.HOPDECK_FAKE_THREADS;
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const items = (id) => process.env.HOPDECK_FAKE_ITEMS ? JSON.parse(fs.readFileSync(process.env.HOPDECK_FAKE_ITEMS, 'utf8'))[id] || [] : null;
if (args[0] === 'app-server') {
  if (process.env.FAKE_RPC_PID_FILE) fs.writeFileSync(process.env.FAKE_RPC_PID_FILE, String(process.pid));
  if (process.env.FAKE_RPC_KEEPALIVE) setInterval(() => {}, 1000);
  const rl = require('readline').createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const { id, method, params } = JSON.parse(line);
    if (id === undefined) return;
    if (process.env.FAKE_RPC === 'timeout') return;
    if (process.env.FAKE_RPC === 'exit') process.exit(7);
    let result;
    if (method === 'initialize') result = { userAgent: 'hopdeck-test' };
    else if (method === 'thread/list') {
      if (process.env.FAKE_RPC === 'error') { console.log(JSON.stringify({ id, error: { code: -32603, message: 'History unavailable' } })); return; }
      const all = read();
      result = params.cursor ? { data: all.slice(1), nextCursor: null } : { data: all.slice(0, 1), nextCursor: all.length > 1 ? 'page2' : null };
    } else if (method === 'thread/items/list') {
      if (process.env.FAKE_RPC === 'legacy') { console.log(JSON.stringify({ id, error: { code: -32601, message: 'Method not found' } })); return; }
      const all = items(params.threadId);
      if (all) {
        const ordered = params.sortDirection === 'desc' ? [...all].reverse() : all;
        const start = Number(params.cursor || 0), limit = Number(process.env.FAKE_PAGE_SIZE || params.limit);
        result = { data: ordered.slice(start, start + limit).map((item) => ({ turnId: 'turn', item })), nextCursor: start + limit < all.length ? String(start + limit) : null };
      } else result = { data: [
        { turnId: 'turn', item: { type: 'agentMessage', text: 'Respuesta de Codex de prueba' } },
        { turnId: 'turn', item: { type: 'userMessage', content: [{ type: 'text', text: 'Pregunta de Codex de prueba' }] } },
      ], nextCursor: null };
    } else if (method === 'thread/read') result = { thread: { turns: [{ items: items(params.threadId) || [{ type: 'agentMessage', text: 'Respuesta antigua' }] }] } };
    else { console.log(JSON.stringify({ id, error: { code: -32601, message: 'Method not found' } })); return; }
    console.log(JSON.stringify({ id, result }));
  });
} else {
  if (process.env.FAKE_LAUNCH_LOG) fs.appendFileSync(process.env.FAKE_LAUNCH_LOG, JSON.stringify({ args, cwd: process.cwd(), pid: process.pid }) + '\n');
  if (file && args[0] !== 'resume') {
    const all = read();
    all.unshift({ id: 'new-codex-session', name: 'Nuevo chat Codex', preview: 'Chat recién creado', cwd: process.cwd(), updatedAt: Date.now() / 1000, source: 'cli', originator: 'codex_cli_rs' });
    fs.writeFileSync(file, JSON.stringify(all));
  }
  process.stdout.write('FAKE CODEX args=' + args.join(' ') + '\r\n> ');
  if (process.env.FAKE_PRINT) process.stdout.write(process.env.FAKE_PRINT + '\r\n> ');
  let buffer = '';
  process.stdin.on('data', (data) => {
    buffer += data.toString(); let at;
    while ((at = buffer.search(/[\r\n]/)) >= 0) {
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      if (line === '/exit') process.exit(0);
      if (line) process.stdout.write('\r\neco: ' + line + '\r\n> ');
    }
  });
}
