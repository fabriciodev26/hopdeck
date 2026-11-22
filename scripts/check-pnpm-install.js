'use strict';
// Consumer smoke test: installs the published package in a private pnpm home,
// resolves its own dependencies, then opens both providers in real PTYs.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { createRequire } = require('module');
const { makeFixture } = require('../test/helpers');

const worker = process.argv[2] === '--verify';
let cli = worker ? null : path.resolve(process.argv[2] || '');
if (cli && fs.existsSync(cli) && fs.statSync(cli).isDirectory()) {
  cli = path.join(cli, 'bin', fs.existsSync(path.join(cli, 'bin/pnpm.cjs')) ? 'pnpm.cjs' : 'pnpm.mjs');
}
if (!worker && (!fs.existsSync(cli) || !/pnpm\.(cjs|mjs)$/.test(cli))) throw new Error('Pass the pnpm package directory or its JS entry point');
const root = worker ? path.resolve(process.argv[4]) : fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hopdeck-pnpm-install-')));
const work = path.join(root, 'work'), home = path.join(root, 'pnpm');
if (!worker) { fs.mkdirSync(work); fs.mkdirSync(home); }
const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') || 'PATH';
const env = { ...process.env, PNPM_HOME: home, XDG_CONFIG_HOME: path.join(root, 'config'),
  npm_config_userconfig: path.join(root, 'empty.npmrc'), npm_config_store_dir: path.join(root, 'store'),
  npm_config_cache_dir: path.join(root, 'cache'), npm_config_state_dir: path.join(root, 'state'),
  npm_config_update_notifier: 'false', CI: 'true',
  [pathKey]: [home, path.join(home, 'bin'), process.env[pathKey]].join(path.delimiter) };
fs.writeFileSync(env.npm_config_userconfig, '');
for (const key of ['HOPDECK_PROVIDER', 'HOPDECK_INSIDE', 'HOPDECK_SKIP', 'TMUX']) delete env[key];
function pnpm(args) {
  const result = cp.spawnSync(process.execPath, [cli, ...args], { cwd: work, env, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`pnpm ${args[0]} failed: ${result.error?.message || result.stdout + result.stderr}`);
  return result.stdout.trim();
}

async function checkHub(installed, provider) {
  const load = createRequire(path.join(installed, 'package.json'));
  // These MUST resolve from the pnpm installation, not the repository's node_modules.
  const pty = load('@lydell/node-pty'), { Terminal } = load('@xterm/headless');
  const sandbox = fs.mkdtempSync(path.join(root, provider + '-'));
  const fx = makeFixture(sandbox, [{ name: 'alpha', sessions: [{ id: 'pnpm-session', first: 'pnpm smoke', custom: 'PNPM smoke', ageH: 1 }] }]);
  const bin = path.join(sandbox, 'bin'); fs.mkdirSync(bin);
  const fake = path.resolve(__dirname, '../test/fixtures/fake-' + provider + '.js');
  if (process.platform === 'win32') fs.writeFileSync(path.join(bin, provider + '.cmd'), `@echo off\r\n"${process.execPath}" "${fake}" %*\r\n`);
  else fs.writeFileSync(path.join(bin, provider), `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`, { mode: 0o755 });
  const threads = path.join(sandbox, 'threads.json');
  fs.writeFileSync(threads, JSON.stringify([{ id: 'pnpm-session', name: 'PNPM smoke', preview: 'pnpm smoke', cwd: fx.cwds.alpha, updatedAt: Date.now() / 1000, source: 'cli', originator: 'codex_cli_rs' }]));
  const childEnv = { ...env, [pathKey]: bin + path.delimiter + env[pathKey], CLAUDE_CONFIG_DIR: fx.cfg,
    HOPDECK_CONFIG: path.join(sandbox, 'preferences.json'), HOPDECK_CACHE: path.join(sandbox, 'cache.json'),
    HOPDECK_FAKE_THREADS: threads, HOPDECK_NOPROMPT: '1', HOPDECK_EMBED: '1', HOPDECK_LANG: 'es',
    HOPDECK_THEME: 'dark', WT_SESSION: '', TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  delete childEnv.NO_COLOR;
  const term = new Terminal({ cols: 110, rows: 26, allowProposedApi: true });
  const child = pty.spawn(process.execPath, [path.join(installed, 'bin/hopdeck.js'), '--provider', provider],
    { name: 'xterm-256color', cols: 110, rows: 26, cwd: fx.cwds.alpha, env: childEnv });
  let exited = false, exitCode;
  child.onData((data) => term.write(data));
  child.onExit((event) => { exited = true; exitCode = event.exitCode; });
  term.onData((data) => { if (!exited) child.write(data); });
  const screen = () => {
    const buffer = term.buffer.active;
    return Array.from({ length: term.rows }, (_, i) => buffer.getLine(buffer.viewportY + i)?.translateToString(true) || '').join('\n');
  };
  const wait = async (condition, label) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) { if (condition()) return; await new Promise((resolve) => setTimeout(resolve, 50)); }
    throw new Error(`${provider}: ${label}\n${screen()}`);
  };
  try {
    await wait(() => screen().includes('alpha'), 'project list');
    child.write('\x10'); await wait(() => screen().includes('⌕'), 'quick switch');
    child.write('PNPM smoke'); await wait(() => screen().includes('PNPM smoke'), 'session search');
    child.write('\r'); await wait(() => screen().includes('FAKE ' + provider.toUpperCase()), 'nested terminal');
    child.write('pnpm-check\r'); await wait(() => screen().includes('eco: pnpm-check'), 'chat input and output');
    child.write('\x1bOP'); await wait(() => screen().includes('[n] nueva'), 'list focus');
    child.write('q'); await wait(() => exited, 'clean shutdown');
    assert.equal(exitCode, 0);
    console.log(`PASS ${provider}: native PTY, launch, resume, chat input and clean exit`);
  } finally {
    try { child.kill(); } catch { /* already stopped */ }
    await new Promise((resolve) => setTimeout(resolve, 250)); term.dispose();
  }
}

function verifyInstalled() {
  const groups = JSON.parse(pnpm(['list', '-g', '--json']));
  const dependency = groups.map((group) => group.dependencies?.hopdeck).find(Boolean);
  assert.ok(dependency?.path, 'pnpm must report the installed package path');
  const installed = fs.realpathSync.native(dependency.path), pkg = require(path.join(installed, 'package.json'));
  assert.equal(pkg.name, 'hopdeck');
  // Exercise the generated global command shim, including pnpm's Windows .cmd launcher.
  const binDir = pnpm(['bin', '-g']), shim = path.join(binDir, process.platform === 'win32' ? 'hopdeck.cmd' : 'hopdeck');
  assert.ok(fs.existsSync(shim), 'global command shim exists');
  const result = process.platform === 'win32'
    ? cp.spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${shim}" --version"`], { cwd: work, env, encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true, timeout: 15000 })
    : cp.spawnSync(shim, ['--version'], { cwd: work, env, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  assert.equal(result.stdout.trim(), pkg.version);
  console.log(`PASS global hopdeck --version: ${pkg.version}`);
  // Unload native modules before removing the private installation on Windows.
  const smoke = cp.spawnSync(process.execPath, [__filename, '--verify', installed, root], { cwd: work, env, stdio: 'inherit', windowsHide: true, timeout: 120000 });
  assert.equal(smoke.status, 0, smoke.error?.message || 'installed terminal smoke failed');
  return pkg.version;
}

async function main() {
  console.log(`Platform ${process.platform}/${process.arch}; Node ${process.versions.node}; pnpm ${pnpm(['--version'])}`);
  console.log(pnpm(['add', '-g', 'hopdeck@latest', '--reporter=append-only']));
  const installed = verifyInstalled();
  const latest = JSON.parse(pnpm(['view', 'hopdeck', 'dist-tags', '--json'])).latest;
  assert.match(latest, /^\d+\.\d+\.\d+$/);
  // pnpm 12 can resolve @latest to yesterday's version during its default age window.
  // Check the exact published version as well, without disabling that policy.
  if (installed !== latest) {
    console.log(`@latest selected ${installed}; also checking the registry's explicit ${latest}`);
    console.log(pnpm(['add', '-g', 'hopdeck@' + latest, '--reporter=append-only']));
    assert.equal(verifyInstalled(), latest);
  }
}

if (worker) {
  (async () => { await checkHub(process.argv[3], 'claude'); await checkHub(process.argv[3], 'codex'); })()
    .then(() => process.exit(0), (error) => { console.error(error.message); process.exit(1); });
} else main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => {
  // Only remove the random test directory created by this script.
  const tempRoot = fs.realpathSync(os.tmpdir());
  if (path.dirname(root) !== tempRoot || !path.basename(root).startsWith('hopdeck-pnpm-install-')) return;
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* native modules may still be unloading on Windows */ }
});
