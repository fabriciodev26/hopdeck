'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { tmp, launchHub } = require('./helpers');
const { parseProvider } = require('../lib/provider');
const { CodexClient, listProjects, preview, groupThreads } = require('../lib/codex-history');
const root = tmp('hopdeck-codex-');
const cwd = path.join(root, 'project with spaces'); fs.mkdirSync(cwd);
const threads = path.join(root, 'threads.json');
const data = [
  { id: 'codex-one', name: 'Sesión Codex uno', preview: 'Primera pregunta', cwd, updatedAt: 1700000000 },
  { id: 'codex-two', preview: 'Segunda pregunta', cwd, updatedAt: 1700000001 },
];
fs.writeFileSync(threads, JSON.stringify(data));
process.env.HOPDECK_FAKE_THREADS = threads;
const fake = path.join(__dirname, 'fixtures', 'fake-codex.js');
const makeClient = (timeout) => new CodexClient({ bin: process.execPath, args: [fake, 'app-server'], timeout });

test('provider: explicit CLI option wins; invalid selection fails', () => {
  assert.deepEqual(parseProvider(['--provider', 'codex', '--model', 'test']), { id: 'codex', args: ['--model', 'test'] });
  assert.deepEqual(parseProvider(['--provider=claude'], 'codex'), { id: 'claude', args: [] });
  assert.throws(() => parseProvider(['--provider']), /Usage/);
  assert.throws(() => parseProvider([], 'other'), /Usage/);
});

test('Codex history: initialize, paginate, group by cwd and preview item entries', async () => {
  const client = makeClient();
  try {
    const projects = await listProjects(client);
    assert.equal(projects.length, 1);
    assert.equal(projects[0].cwd, cwd);
    assert.deepEqual(projects[0].sessions.map((s) => s.id), ['codex-two', 'codex-one']);
    assert.equal(projects[0].sessions[0].title, 'Segunda pregunta');
    assert.equal(projects[0].sessions[1].title, 'Sesión Codex uno');
    const messages = await preview(client, projects[0].sessions[0]);
    assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant']);
    assert.match(messages[1].text, /Respuesta de Codex/);
    assert.equal(groupThreads([...data, data[0], { id: 'bad' }])[0].sessions.length, 2);
    client.close();
    assert.equal((await listProjects(client)).length, 1, 'an old child exit cannot reject requests on the new connection');
  } finally { client.close(); }
});

test('CLI: provider validation and isolated preferences', () => {
  const file = path.join(root, 'codex-config.json');
  const env = { ...process.env, HOPDECK_CONFIG: file, HOPDECK_NOPROMPT: '1' };
  const entry = path.join(__dirname, '..', 'bin', 'hopdeck.js');
  const run = (...args) => cp.spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', env, windowsHide: true });
  assert.equal(run('--provider', 'bad').status, 2);
  assert.equal(run('--provider', 'codex', 'theme', 'light').status, 0);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).theme, 'light');
  const providerFile = path.join(__dirname, '..', 'lib', 'provider');
  const config = cp.execFileSync(process.execPath, ['-e', `console.log(require(${JSON.stringify(providerFile)}).configFile)`], { encoding: 'utf8', env: { ...env, HOPDECK_PROVIDER: 'codex' } });
  assert.match(config, /\.hopdeck-codex\.json/);
});

test('Codex history: old protocol fallback, RPC errors, timeout and child exit', async () => {
  for (const mode of ['legacy', 'error', 'timeout', 'exit']) {
    process.env.FAKE_RPC = mode;
    const client = makeClient(mode === 'timeout' ? 200 : 5000);
    try {
      if (mode === 'legacy') assert.equal((await preview(client, data[0]))[0].text, 'Respuesta antigua');
      else await assert.rejects(listProjects(client), mode === 'error' ? /History unavailable/ : mode === 'timeout' ? /timed out/ : /exited/);
    } finally { client.close(); delete process.env.FAKE_RPC; }
  }
});

test('shortcuts: both providers installed once with a backup and removable block', () => {
  const hd = require('../bin/hopdeck');
  for (const kind of ['posix', 'fish', 'pwsh']) {
    assert.match(hd.SNIP[kind], /hopdeck --provider claude/);
    assert.match(hd.SNIP[kind], /hopdeck --provider codex/);
  }
  const profile = path.join(root, 'profile.ps1');
  fs.writeFileSync(profile, '# existing profile\n');
  const list = [{ file: profile, kind: 'pwsh' }];
  hd.install(false, list, true); hd.install(false, list, true);
  const text = fs.readFileSync(profile, 'utf8');
  assert.equal(text.split('function codex {').length, 2);
  assert.equal(text.split(hd.MARK_A).length, 2);
  assert.equal(fs.readFileSync(profile + '.hopdeck-backup', 'utf8'), '# existing profile\n');
  hd.install(true, list, true);
  assert.equal(fs.readFileSync(profile, 'utf8').trim(), '# existing profile');
});

test('PowerShell shortcuts select each provider and forward arguments unchanged', { skip: process.platform !== 'win32' }, () => {
  const bin = path.join(root, 'shortcut-bin'); fs.mkdirSync(bin);
  const record = path.join(bin, 'record.js');
  fs.writeFileSync(record, 'console.log(JSON.stringify(process.argv.slice(2)))');
  for (const name of ['claude', 'codex']) fs.writeFileSync(path.join(bin, name + '.cmd'), `@echo off\r\n"${process.execPath}" "${record}" ${name} %*\r\n`);
  const script = path.join(root, 'check-shortcuts.ps1');
  fs.writeFileSync(script, 'function hopdeck { ConvertTo-Json -Compress -InputObject @($args) }\n' + require('../bin/hopdeck').SNIP.pwsh + '\nclaude\ncodex\nclaude --version\ncodex exec "hello world"\n');
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') || 'PATH';
  const output = cp.execFileSync('pwsh', ['-NoProfile', '-File', script], { encoding: 'utf8', env: { ...process.env, HOPDECK_SKIP: '', [pathKey]: bin + path.delimiter + process.env[pathKey] }, windowsHide: true });
  const results = output.trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(results, [['--provider', 'claude'], ['--provider', 'codex'], ['claude', '--version'], ['codex', 'exec', 'hello world']]);
});

test('POSIX shortcuts select each provider and preserve arguments in real terminals', { skip: process.platform === 'win32', timeout: 45000 }, async (t) => {
  let pty; try { pty = require('@lydell/node-pty'); } catch { return t.skip('node-pty unavailable'); }
  const { findExecutable } = require('../lib/executable');
  const bin = path.join(root, 'posix-bin'); fs.mkdirSync(bin);
  const record = path.join(bin, 'record.js');
  fs.writeFileSync(record, 'console.log("HOPDECK_RECORD " + JSON.stringify(process.argv.slice(2)))');
  for (const name of ['hopdeck', 'claude', 'codex']) {
    const file = path.join(bin, name);
    fs.writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" "${record}" ${name} "$@"\n`, { mode: 0o755 });
  }
  for (const name of ['bash', 'zsh', 'fish']) await t.test(name, { skip: !findExecutable(name) }, async () => {
    const script = path.join(root, `shortcuts.${name}`);
    const snippet = require('../bin/hopdeck').SNIP[name === 'fish' ? 'fish' : 'posix'];
    fs.writeFileSync(script, snippet + '\nclaude\ncodex\nclaude --version\ncodex exec "hello world"\n');
    const args = name === 'bash' ? ['--noprofile', '--norc', script] : name === 'zsh' ? ['-f', script] : ['--no-config', script];
    const p = pty.spawn(findExecutable(name), args, { cols: 160, rows: 24, cwd: root, env: { ...process.env, HOPDECK_SKIP: '', PATH: bin + path.delimiter + process.env.PATH } });
    let output = '', timer;
    p.onData((data) => { output += data; });
    try {
      const code = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(name + ' shortcut test timed out')), 10000);
        p.onExit((event) => resolve(event.exitCode));
      });
      assert.equal(code, 0, output);
      const records = output.split(/\r?\n/).filter((line) => line.startsWith('HOPDECK_RECORD ')).map((line) => JSON.parse(line.slice(15)));
      assert.deepEqual(records, [['hopdeck', '--provider', 'claude'], ['hopdeck', '--provider', 'codex'], ['claude', '--version'], ['codex', 'exec', 'hello world']]);
    } finally { clearTimeout(timer); try { p.kill(); } catch { /* already exited */ } }
  });
});

test('Codex embedded terminal: preview, resume, input, new chat and two live sessions', { timeout: 90000 }, async (t) => {
  const log = path.join(root, 'launches.jsonl');
  const h = launchHub({ root, fx: { cfg: root }, env: { HOPDECK_PROVIDER: 'codex', HOPDECK_FAKE_THREADS: threads, FAKE_LAUNCH_LOG: log }, args: ['--provider', 'codex', '--model', 'test-model'] });
  if (!h) return t.skip('node-pty/xterm unavailable');
  try {
    await h.waitFor(/Hopdeck/, 'hub');
    await h.waitFor(/project with spaces/, 'Codex project');
    h.write('\x10'); await h.waitFor(/⌕/, 'quick switch');
    h.write('uno'); await h.waitFor(/Sesión Codex uno/, 'session');
    h.write('\r'); await h.waitFor(/FAKE CODEX/, 'resumed Codex');
    await h.waitFor(/args=resume codex-one --model test-model/, 'resume arguments');
    h.write('hola\r'); await h.waitFor(/eco: hola/, 'chat input');
    h.write('\x1bOP'); await h.sleep(300);
    h.write('n'); await h.waitFor(/FAKE CODEX args=--model test-model/, 'new Codex chat');
    h.write('\x1bOP'); await h.sleep(300);
    h.write('\x10'); await h.waitFor(/⌕/, 'switch back');
    h.write('uno'); await h.sleep(300); h.write('\r');
    await h.waitFor(/eco: hola/, 'first chat stayed alive');
    const launches = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(launches.length, 2);
    assert.deepEqual(launches[0].args, ['resume', 'codex-one', '--model', 'test-model']);
    assert.deepEqual(launches[1].args, ['--model', 'test-model']);
    for (const launch of launches) assert.equal(path.resolve(launch.cwd).toLowerCase(), path.resolve(cwd).toLowerCase(), JSON.stringify(launch));
    h.write('\x1bOP'); await h.waitFor(/\[n\] nueva/, 'list focus before quitting'); h.write('q');
    for (let i = 0; i < 200 && !h.exited; i++) await h.sleep(50);
    assert.ok(h.exited, 'clean exit');
  } finally { await h.close(); }
});
