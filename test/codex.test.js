'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { tmp, launchHub, makePNG } = require('./helpers');
const { parseProvider } = require('../lib/provider');
const { CodexClient, isCodexThread, listProjects, preview, groupThreads, sessionImages, findSessionImage } = require('../lib/codex-history');
const root = tmp('hopdeck-codex-');
const cwd = path.join(root, 'project with spaces'); fs.mkdirSync(cwd);
const threads = path.join(root, 'threads.json');
const data = [
  { id: 'codex-one', name: 'Sesión Codex uno', preview: 'Primera pregunta', cwd, updatedAt: 1700000000, source: 'cli', originator: 'codex_cli_rs' },
  { id: 'codex-two', preview: 'Segunda pregunta', cwd, updatedAt: 1700000001, source: 'vscode', originator: 'Codex Desktop' },
];
const mixedData = [
  { id: 'work-only', name: 'Work conversation', cwd: path.join(root, 'work-only-project'), updatedAt: 1900000000, source: 'vscode', originator: 'codex_work_desktop' },
  ...data,
  { ...data[0], id: 'work-shared-directory', name: 'Work in a real repository', originator: 'codex_work_desktop', source: 'vscode' },
];
fs.writeFileSync(threads, JSON.stringify(mixedData));
process.env.HOPDECK_FAKE_THREADS = threads;
const fake = path.join(__dirname, 'fixtures', 'fake-codex.js');
const makeClient = (timeout) => new CodexClient({ bin: process.execPath, args: [fake, 'app-server'], timeout });

const red = makePNG(16, 8, () => [255, 0, 0, 255]), blue = makePNG(12, 6, () => [0, 0, 255, 255]);
const localImage = path.join(cwd, 'blue image.png'); fs.writeFileSync(localImage, blue);
const imageItems = path.join(root, 'image-items.json');
const imageHistory = [
  { id: 'img-user-one', type: 'userMessage', content: [{ type: 'text', text: '[Image #1] primera' }, { type: 'image', url: 'data:image/png;base64,' + red.toString('base64') }] },
  { id: 'img-agent', type: 'agentMessage', text: 'Respuesta con imagen' },
  { id: 'img-user-two', type: 'userMessage', content: [{ type: 'text', text: '[Image #1] segunda' }, { type: 'localImage', path: 'blue image.png' }, { type: 'localImage', path: 'missing.png' }] },
];
fs.writeFileSync(imageItems, JSON.stringify({ 'codex-one': imageHistory, 'codex-two': [{ type: 'userMessage', content: [{ type: 'image', url: 'data:image/png;base64,' + red.toString('base64') }] }] }));

test('Codex images: paginated attachments, per-message numbers, missing files and legacy API', async () => {
  process.env.HOPDECK_FAKE_ITEMS = imageItems; process.env.FAKE_PAGE_SIZE = '1';
  try {
    for (const legacy of [false, true]) {
      if (legacy) process.env.FAKE_RPC = 'legacy';
      const client = makeClient();
      try {
        const found = await sessionImages(client, data[0]);
        assert.deepEqual(found.map((im) => im.n), [1, 1]);
        assert.deepEqual(found.map((im) => Buffer.from(im.data, 'base64')), [red, blue]);
        assert.equal((await sessionImages(client, data[0], 1)).length, 1, 'gallery limit is enforced');
        assert.deepEqual(Buffer.from((await findSessionImage(client, data[0], 1)).data, 'base64'), blue, 'latest marker searches past the gallery limit');
        assert.deepEqual(Buffer.from((await findSessionImage(client, data[0], 1, 1)).data, 'base64'), red, 'an older marker keeps its own attachment');
        assert.equal(await findSessionImage(client, data[0], 2), null, 'a missing image never becomes another image');
        assert.match((await preview(client, data[1]))[0].text, /\[Image #1\]/, 'image-only messages appear in previews');
      } finally { client.close(); }
    }
  } finally { delete process.env.HOPDECK_FAKE_ITEMS; delete process.env.FAKE_PAGE_SIZE; delete process.env.FAKE_RPC; }
});

test('Codex images: reject non-images, remote URLs, directories and oversized files without shifting labels', async () => {
  const bad = path.join(root, 'not-image.png'); fs.writeFileSync(bad, 'MZ this is not an image');
  const large = path.join(root, 'large.png'), fd = fs.openSync(large, 'w'); fs.ftruncateSync(fd, 19 * 1024 * 1024); fs.closeSync(fd);
  const content = [
    { type: 'image', url: 'https://example.invalid/private.png' },
    { type: 'image', url: 'data:image/png;base64,' + Buffer.from('MZ executable').toString('base64') },
    { type: 'localImage', path: bad }, { type: 'localImage', path: root }, { type: 'localImage', path: large },
    { type: 'localImage', path: localImage },
  ];
  const requests = [];
  const client = { request: async (method) => { requests.push(method); return { data: [{ type: 'userMessage', content }], nextCursor: null }; } };
  const found = await sessionImages(client, data[0]);
  assert.deepEqual(found.map((im) => im.n), [6]);
  assert.deepEqual(Buffer.from(found[0].data, 'base64'), blue);
  assert.deepEqual(requests, ['thread/items/list']);
});

test('provider: explicit CLI option wins; invalid selection fails', () => {
  assert.deepEqual(parseProvider(['--provider', 'codex', '--model', 'test']), { id: 'codex', args: ['--model', 'test'] });
  assert.deepEqual(parseProvider(['--provider=claude'], 'codex'), { id: 'claude', args: [] });
  assert.throws(() => parseProvider(['--provider']), /Usage/);
  assert.throws(() => parseProvider([], 'other'), /Usage/);
});

test('Codex origins: include native Codex clients and exclude Work, unknown clients and subagents', () => {
  for (const thread of [
    { source: 'cli', originator: 'codex_cli_rs' },
    { source: 'cli' },
    { source: 'cli', originator: null },
    { source: 'vscode', originator: 'codex_vscode' },
    { source: 'vscode', originator: 'Codex Desktop' },
    { source: 'appServer', originator: 'Codex Desktop' },
  ]) assert.equal(isCodexThread(thread), true, JSON.stringify(thread));
  for (const thread of [
    { source: 'vscode', originator: 'codex_work_desktop' },
    { source: 'cli', originator: 'codex_work_desktop' },
    { source: 'vscode' },
    { source: 'appServer', originator: 'another-client' },
    { source: 'cli', originator: 'another-client' },
    { source: 'exec', originator: 'codex_cli_rs' },
    { source: 'unknown', originator: 'Codex Desktop' },
    { source: { subAgent: 'review' }, originator: 'codex_cli_rs' },
    {}, null,
  ]) assert.equal(isCodexThread(thread), false, JSON.stringify(thread));
  const grouped = groupThreads(mixedData);
  assert.equal(grouped.length, 1, 'Work-only directories do not become projects');
  assert.deepEqual(grouped[0].sessions.map((s) => s.id), ['codex-two', 'codex-one'], 'Work is excluded even in the same repository');
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
    assert.ok(projects[0].sessions.every((s) => s.originator !== 'codex_work_desktop'), 'pagination continues after an excluded first page');
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

test('Windows Codex shutdown stops the server behind an npm batch shim', { skip: process.platform !== 'win32', timeout: 20000 }, async () => {
  const shim = path.join(root, 'codex-rpc.cmd'), pidFile = path.join(root, 'rpc-server.pid');
  fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${fake}" %*\r\n`);
  process.env.FAKE_RPC_PID_FILE = pidFile;
  process.env.FAKE_RPC_KEEPALIVE = '1';
  const client = new CodexClient({ bin: shim });
  let pid;
  const alive = () => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    await listProjects(client);
    pid = Number(fs.readFileSync(pidFile, 'utf8'));
    assert.ok(Number.isInteger(pid) && pid > 0 && alive(), 'the owned server is running behind cmd.exe');
    client.close();
    for (let i = 0; i < 60 && alive(); i++) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(alive(), false, 'closing the client also stops its grandchild server');
  } finally {
    client.close(); delete process.env.FAKE_RPC_PID_FILE; delete process.env.FAKE_RPC_KEEPALIVE;
    if (alive()) cp.spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 5000 });
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

test('Codex image UI: gallery, hover and full-size clicks keep repeated image numbers separate', { timeout: 90000 }, async (t) => {
  const uiRoot = tmp('hopdeck-codex-images-'), log = path.join(uiRoot, 'opened.log');
  const h = launchHub({ root: uiRoot, fx: { cfg: uiRoot }, env: {
    HOPDECK_PROVIDER: 'codex', HOPDECK_FAKE_THREADS: threads, HOPDECK_FAKE_ITEMS: imageItems, FAKE_PAGE_SIZE: '1',
    HOPDECK_SIXEL: '0', HOPDECK_OPEN_LOG: log, FAKE_PRINT: '[Image #1] primera\r\nrespuesta\r\n[Image #1] segunda',
  }, args: ['--provider', 'codex'] });
  if (!h) return t.skip('node-pty/xterm unavailable');
  try {
    await h.waitFor(/project with spaces/, 'Codex projects');
    h.write('\x10'); await h.waitFor(/⌕/, 'quick switch'); h.write('uno'); await h.waitFor(/Sesión Codex uno/, 'selected thread'); h.write('\r');
    await h.waitFor(/\[Image #1\] segunda/, 'image markers in resumed chat');
    for (const [label, original] of [['primera', red], ['segunda', blue]]) {
      const marker = h.find('[Image #1] ' + label, 35); assert.ok(marker);
      h.mouse(35, marker.x + 3, marker.y);
      await h.waitFor(/╭─ \[Image #1\]/, 'hover popup'); await h.waitFor(/▀/, 'decoded image preview');
      h.mouse(0, marker.x + 3, marker.y); h.mouse(0, marker.x + 3, marker.y, 'm');
      const expected = label === 'primera' ? 1 : 2;
      for (let i = 0; i < 100; i++) {
        if (fs.existsSync(log) && fs.readFileSync(log, 'utf8').trim().split('\n').length >= expected) break;
        await h.sleep(50);
      }
      const opened = fs.readFileSync(log, 'utf8').trim().split('\n');
      assert.equal(opened.length, expected);
      assert.deepEqual(fs.readFileSync(opened.at(-1)), original, 'click exports the correct original image');
      h.mouse(35, 2, 2); await h.waitGone(/╭─ \[Image #1\]/, 'hover closes');
    }
    h.write('\x1b[18~'); await h.waitFor(/1\/2/, 'F7 gallery'); await h.waitFor(/16×8/, 'first image dimensions');
    h.write('\x1b[C'); await h.waitFor(/2\/2/, 'second gallery image'); await h.waitFor(/12×6/, 'local image dimensions');
    h.write('\x1b'); await h.waitFor(/FAKE CODEX/, 'gallery closes');
  } finally { await h.close(); }
});

test('Codex embedded terminal: preview, resume, input, new chat and two live sessions', { timeout: 90000 }, async (t) => {
  const log = path.join(root, 'launches.jsonl');
  const h = launchHub({ root, fx: { cfg: root }, env: { HOPDECK_PROVIDER: 'codex', HOPDECK_FAKE_THREADS: threads, FAKE_LAUNCH_LOG: log }, args: ['--provider', 'codex', '--model', 'test-model'] });
  if (!h) return t.skip('node-pty/xterm unavailable');
  try {
    await h.waitFor(/Hopdeck/, 'hub');
    await h.waitFor(/project with spaces/, 'Codex project');
    assert.doesNotMatch(h.screen(), /work-only-project/, 'Work projects are not shown');
    h.write('\x10'); await h.waitFor(/⌕/, 'quick switch');
    assert.doesNotMatch(h.screen(), /Work conversation|Work in a real repository/, 'Work chats are not included in quick switch');
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
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    for (const { pid } of launches) assert.ok(alive(pid), 'both chats are running before quitting');
    h.write('\x1bOP'); await h.waitFor(/\[n\] nueva/, 'list focus before quitting'); h.write('q');
    for (let i = 0; i < 200 && !h.exited; i++) await h.sleep(50);
    assert.ok(h.exited, 'clean exit');
    for (let i = 0; i < 60 && launches.some(({ pid }) => alive(pid)); i++) await h.sleep(50);
    for (const { pid } of launches) assert.equal(alive(pid), false, 'quitting stops both chat processes');
  } finally { await h.close(); }
});
