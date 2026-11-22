'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { tmp } = require('./helpers');
const setup = require('../lib/provider-setup');
const { T } = require('../lib/i18n');

function harness(keys = [], extra = {}) {
  const events = [], config = {}; let text = '';
  const options = { id: 'claude', config, save: () => events.push('save'), T,
    env: {}, input: { isTTY: true }, output: { isTTY: true, write: (s) => { text += s; } },
    ask: async (accept) => { assert.ok(keys.length, 'unexpected question'); const answer = accept(keys.shift()); assert.notEqual(answer, undefined); return answer; },
    find: () => null, install: async () => { throw new Error('unexpected installation'); },
    run: async () => { throw new Error('unexpected command'); }, ...extra };
  return { options, events, config, text: () => text };
}

test('provider setup: only official installers for supported platforms', () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    for (const id of ['claude', 'codex']) {
      const plan = setup.installerFor(id, platform);
      assert.equal(plan.url, (id === 'claude' ? 'https://claude.ai' : 'https://chatgpt.com/codex') + (platform === 'win32' ? '/install.ps1' : '/install.sh'));
    }
  }
  assert.throws(() => setup.installerFor('other'));
  assert.throws(() => setup.installerFor('codex', 'freebsd'));
});

test('provider setup: cancellation and automation never install or ask for login', async () => {
  const cancelled = harness(['\x1b']);
  assert.equal(await setup.ensureProvider(cancelled.options), false);
  assert.deepEqual(cancelled.config, {});
  for (const extra of [{ input: {} }, { env: { CI: 'true' } }, { env: { HOPDECK_NOPROMPT: '1' } }]) {
    const h = harness([], extra); assert.equal(await setup.ensureProvider(h.options), false);
    assert.deepEqual(h.config, {});
  }
  const existing = harness([], { find: () => '/existing/provider' });
  assert.equal(await setup.ensureProvider(existing.options), true);
  assert.equal(existing.text(), '');
});

for (const id of ['claude', 'codex']) test('provider setup: installs and authenticates only ' + id, async () => {
  let installed = false; const commands = [];
  const h = harness(['\r', '\r'], { id,
    find: () => installed ? '/new/provider' : null,
    install: async () => { installed = true; return 0; },
    run: async (bin, args, options) => { commands.push({ bin, args, stdio: options.stdio }); return args.at(-1) === 'status' ? 1 : 0; },
  });
  assert.equal(await setup.ensureProvider(h.options), true);
  const plan = setup.installerFor(id);
  assert.deepEqual(commands.map((x) => x.args), [['--version'], plan.status, plan.login]);
  assert.equal(commands[0].stdio, 'ignore'); assert.equal(commands[1].stdio, 'ignore');
  assert.equal(commands[2].stdio, undefined, 'authentication belongs to the interactive CLI');
  assert.equal(h.config.providerLoginPending, false); assert.equal(h.events.length, 2);
  assert.ok(h.text().includes(plan.url));
});

test('provider setup: failed install retries with the original consent; failed validation stops', async () => {
  let attempts = 0;
  const h = harness(['\r', 'r', '\r'], {
    find: () => attempts ? '/new/provider' : null,
    install: async () => { if (++attempts === 1) throw new Error('offline'); return 0; },
    run: async () => 7,
  });
  assert.equal(await setup.ensureProvider(h.options), false);
  assert.equal(attempts, 2); assert.deepEqual(h.config, {});
  assert.ok(h.text().includes('offline'));
});

test('provider setup: login can be postponed, resumed, retried or cancelled', async () => {
  const h = harness(['m'], { find: () => '/existing/provider', run: async () => 1 });
  h.config.providerLoginPending = true;
  assert.equal(await setup.ensureProvider(h.options), true);
  assert.equal(h.config.providerLoginPending, true);
  let logins = 0;
  const again = harness(['\r', '\r'], { config: h.config, find: h.options.find,
    run: async (bin, args) => args.at(-1) === 'status' ? 1 : ++logins === 1 ? 1 : 0 });
  assert.equal(await setup.ensureProvider(again.options), true);
  assert.equal(logins, 2); assert.equal(h.config.providerLoginPending, false);
  for (const code of [0, 130]) {
    const auth = harness(code ? ['\r'] : [], { config: { providerLoginPending: true }, find: h.options.find,
      run: async (bin, args) => args.at(-1) === 'status' ? (code ? 1 : 0) : code });
    assert.equal(await setup.ensureProvider(auth.options), !code);
    assert.equal(auth.options.config.providerLoginPending, !!code);
  }
});

test('provider setup: native binaries are found immediately without a new terminal', () => {
  const root = tmp('hopdeck-native-'), home = path.join(root, 'home with spaces');
  const dir = path.join(home, '.local', 'bin'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'claude' + (process.platform === 'win32' ? '.exe' : ''));
  fs.writeFileSync(file, 'fake', { mode: 0o755 });
  const env = { PATH: '' };
  assert.equal(setup.findProvider('claude', { env, home }), file);
  assert.equal(env.PATH.split(path.delimiter)[0], dir);
  fs.unlinkSync(file);
  assert.equal(setup.findProvider('claude', { env, home }), null, 'removed binaries invalidate the cache');
  const codexDir = path.join(root, 'custom codex'); fs.mkdirSync(codexDir);
  const codex = path.join(codexDir, 'codex' + (process.platform === 'win32' ? '.exe' : ''));
  fs.writeFileSync(codex, 'fake', { mode: 0o755 });
  assert.equal(setup.findProvider('codex', { env: { PATH: '', CODEX_INSTALL_DIR: codexDir }, home }), codex);
  if (process.platform === 'win32') {
    const nativeDir = path.join(root, 'Programs', 'OpenAI', 'Codex', 'bin'); fs.mkdirSync(nativeDir, { recursive: true });
    fs.writeFileSync(path.join(nativeDir, 'codex.exe'), 'fake');
    assert.equal(setup.findProvider('codex', { env: { PATH: '', LOCALAPPDATA: root }, home }), path.join(nativeDir, 'codex.exe'));
  }
});

test('provider setup: HTTPS redirects, bounded downloads and rejected responses', async () => {
  const root = tmp('hopdeck-download-'), url = setup.installerFor('codex').url;
  const file = path.join(root, 'installer'); let requests = 0;
  await setup.downloadInstaller(url, file, async (target, options) => {
    assert.equal(options.redirect, 'manual'); requests++;
    return requests === 1 ? new Response(null, { status: 302, headers: { location: 'https://releases.openai.com/codex/install.sh' } }) : new Response('echo installed');
  });
  assert.equal(requests, 2); assert.equal(fs.readFileSync(file, 'utf8'), 'echo installed');
  for (const response of [new Response('oops', { status: 500 }), new Response('<html>error</html>'), new Response(''), new Response('x'.repeat(2 * 1024 * 1024 + 1)), new Response(null, { status: 302, headers: { location: 'http://example.invalid/install.sh' } })]) {
    await assert.rejects(setup.downloadInstaller(url, path.join(root, 'bad'), async () => response));
    assert.ok(!fs.existsSync(path.join(root, 'bad')));
  }
  await assert.rejects(setup.downloadInstaller('https://example.invalid/install.sh', file, async () => { throw new Error('must not fetch'); }), /Unknown installer/);
});

test('provider setup: installer process runs a harmless fixture and always cleans its temporary script', async () => {
  const root = tmp('hopdeck-installer-'), marker = path.join(root, 'installed');
  for (const id of ['claude', 'codex']) {
    let script;
    const code = await setup.installProvider(id, { env: { ...process.env, HOPDECK_TEST_MARKER: marker },
      run: (bin, args, options) => {
        assert.equal(options.env.CODEX_NON_INTERACTIVE, id === 'codex' ? '1' : process.env.CODEX_NON_INTERACTIVE, 'the installer cannot launch a separate Codex chat');
        return setup.runCommand(bin, args, options);
      },
      download: async (url, file) => { script = file; fs.writeFileSync(file, process.platform === 'win32'
        ? "[IO.File]::WriteAllText($env:HOPDECK_TEST_MARKER, 'installed')"
        : 'printf installed > "$HOPDECK_TEST_MARKER"\n'); },
    });
    assert.equal(code, 0); assert.equal(fs.readFileSync(marker, 'utf8'), 'installed');
    assert.ok(!fs.existsSync(path.dirname(script))); fs.unlinkSync(marker);
  }
  let script;
  await assert.rejects(setup.installProvider('codex', { find: () => 'fake-interpreter',
    download: async (url, file) => { script = file; throw new Error('offline'); } }), /offline/);
  assert.ok(!fs.existsSync(path.dirname(script)));
  await assert.rejects(setup.installProvider('codex', { find: () => null }), /Required interpreter/);
});

test('provider setup: subprocess failures and timeouts are reported and release the interrupt handler', async () => {
  const before = process.listenerCount('SIGINT');
  assert.equal(await setup.runCommand(process.execPath, ['-e', 'process.exit(7)'], { stdio: 'ignore' }), 7);
  assert.equal(await setup.runCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', timeout: 150 }), 124);
  await assert.rejects(setup.runCommand(path.join(tmp('hopdeck-missing-'), 'missing.exe'), [], { stdio: 'ignore' }));
  assert.equal(process.listenerCount('SIGINT'), before);
});

test('provider setup: saved provider is used by bare Hopdeck and explicit selection wins', () => {
  const file = path.join(tmp('hopdeck-preferred-'), 'cfg.json');
  const check = (value, selected = '') => {
    fs.writeFileSync(file, JSON.stringify({ defaultProvider: value }));
    const r = cp.spawnSync(process.execPath, ['-e', 'process.stdout.write(require("./lib/provider").id)'], {
      cwd: path.join(__dirname, '..'), encoding: 'utf8', env: { ...process.env, HOPDECK_CONFIG: file, HOPDECK_PROVIDER: selected },
    }); assert.equal(r.status, 0, r.stderr); return r.stdout;
  };
  assert.equal(check('codex'), 'codex'); assert.equal(check('codex', 'claude'), 'claude'); assert.equal(check('invalid'), 'claude');
});
