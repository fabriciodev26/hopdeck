'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { findExecutable } = require('./executable');
const { clean } = require('./style');

const PROVIDERS = {
  claude: { label: 'Claude Code', origin: 'https://claude.ai', shell: 'bash', login: ['auth', 'login'], status: ['auth', 'status'] },
  codex: { label: 'Codex', origin: 'https://chatgpt.com/codex', shell: 'sh', login: ['login'], status: ['login', 'status'] },
};
function installerFor(id, platform = process.platform) {
  const info = PROVIDERS[id];
  if (!info || !['win32', 'darwin', 'linux'].includes(platform)) throw new Error('Unsupported provider or platform');
  return { ...info, url: info.origin + (platform === 'win32' ? '/install.ps1' : '/install.sh'), interpreter: platform === 'win32' ? 'powershell.exe' : info.shell };
}
function canPrompt({ env = process.env, input = process.stdin, output = process.stdout } = {}) {
  return !!input.isTTY && !!output.isTTY && !env.HOPDECK_NOPROMPT && !(env.CI && !['0', 'false'].includes(env.CI));
}
function findProvider(id, { env = process.env, platform = process.platform, home = os.homedir(), find = findExecutable } = {}) {
  if (!PROVIDERS[id]) return find(id, { env, platform });
  const hit = find(id, { env, platform }); if (hit) return hit;
  const paths = platform === 'win32' ? path.win32 : path.posix, win = platform === 'win32';
  const dirs = [paths.join(home, '.local', 'bin')];
  if (id === 'codex') {
    if (env.CODEX_INSTALL_DIR && paths.isAbsolute(env.CODEX_INSTALL_DIR)) dirs.unshift(env.CODEX_INSTALL_DIR);
    if (win && env.LOCALAPPDATA) dirs.push(paths.join(env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin'));
  }
  for (const dir of dirs) {
    const file = paths.join(dir, id + (win ? '.exe' : ''));
    try {
      if (!fs.statSync(file).isFile()) continue;
      if (!win) fs.accessSync(file, fs.constants.X_OK);
      const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
      env[key] = dir + (win ? ';' : ':') + (env[key] || '');
      return file;
    } catch { /* another installation location */ }
  }
  return null;
}

// Bounded HTTPS download. Only installerFor() supplies the initial URL.
async function downloadInstaller(url, file, fetchImpl = fetch) {
  const allowed = Object.keys(PROVIDERS).flatMap((id) => ['win32', 'linux'].map((platform) => installerFor(id, platform).url));
  if (!allowed.includes(url)) throw new Error('Unknown installer source');
  const signal = AbortSignal.timeout(45000);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const target = new URL(url);
    if (target.protocol !== 'https:' || target.username || target.password) throw new Error('Installer requires HTTPS');
    const response = await fetchImpl(url, { redirect: 'manual', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location'); if (!location) throw new Error('Invalid installer redirect');
      url = new URL(location, url).href; continue;
    }
    if (!response.ok || !response.body) throw new Error('Installer download failed (HTTP ' + response.status + ')');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 2 * 1024 * 1024) throw new Error('Installer download is too large');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    const data = Buffer.concat(chunks);
    if (!data.length || /^\s*(?:<!doctype|<html)/i.test(data.toString('utf8', 0, 80))) throw new Error('Invalid installer response');
    fs.writeFileSync(file, data, { mode: 0o600, flag: 'wx' }); return;
  }
  throw new Error('Too many installer redirects');
}

function runCommand(bin, args, { env = process.env, stdio = 'inherit', timeout = 600000 } = {}) {
  return new Promise((resolve, reject) => {
    let command = bin, argv = args, verbatim = false;
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
      if (/["%\r\n]/.test(bin) || args.some((arg) => !/^[\w-]+$/.test(arg))) return reject(new Error('Unsupported batch command'));
      command = env.ComSpec || 'cmd.exe'; argv = ['/d', '/v:off', '/s', '/c', `""${bin}" ${args.join(' ')}"`]; verbatim = true;
    }
    const child = cp.spawn(command, argv, { env: { ...env, HOPDECK_SKIP: '1' }, stdio, windowsHide: true, windowsVerbatimArguments: verbatim });
    let timedOut = false, interrupted = false;
    const stop = () => {
      if (process.platform === 'win32' && child.pid) cp.spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 5000 });
      else child.kill();
    };
    const onInterrupt = () => { interrupted = true; stop(); };
    process.on('SIGINT', onInterrupt);
    const timer = timeout > 0 ? setTimeout(() => { timedOut = true; stop(); }, timeout) : null;
    const cleanup = () => { clearTimeout(timer); process.removeListener('SIGINT', onInterrupt); };
    child.once('error', (error) => { cleanup(); reject(error); });
    child.once('close', (code) => { cleanup(); resolve(interrupted ? 130 : timedOut ? 124 : code ?? 1); });
  });
}

async function installProvider(id, { platform = process.platform, env = process.env, find = findExecutable, download = downloadInstaller, run = runCommand } = {}) {
  const plan = installerFor(id, platform);
  const interpreter = find(plan.interpreter, { env, platform }) || (platform === 'win32' && find('pwsh.exe', { env, platform }));
  if (!interpreter) throw new Error('Required interpreter: ' + plan.interpreter);
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hopdeck-provider-')));
  try {
    const file = path.join(dir, platform === 'win32' ? 'install.ps1' : 'install.sh');
    await download(plan.url, file);
    const args = platform === 'win32'
      ? ['-NoLogo', '-NoProfile', '-Command', "$ErrorActionPreference='Stop'; & ([ScriptBlock]::Create([IO.File]::ReadAllText($env:HOPDECK_INSTALL_SCRIPT)))"] : [file];
    return await run(interpreter, args, { env: { ...env, ...(id === 'codex' ? { CODEX_NON_INTERACTIVE: '1' } : {}), HOPDECK_INSTALL_SCRIPT: file } });
  } finally {
    // The random directory belongs to this invocation; never remove a computed parent.
    if (path.dirname(dir) === fs.realpathSync(os.tmpdir()) && path.basename(dir).startsWith('hopdeck-provider-')) fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function chooseProvider({ ask, T, output = process.stdout }) {
  output.write('\n  » Hopdeck\n\n  ' + T.setupChoose + '\n  ' + T.setupChoices + '\n');
  return ask((key) => key === '1' ? 'claude' : key === '2' ? 'codex' : key === '\x1b' || /^[qQ]$/.test(key) ? null : undefined);
}

async function ensureProvider({ id, config, save, ask, T, env = process.env, input = process.stdin, output = process.stdout,
  find = () => findProvider(id, { env }), install = () => installProvider(id, { env }), run = runCommand }) {
  const info = installerFor(id), interactive = canPrompt({ env, input, output });
  let bin = find(), approved = false;
  if (!bin && !interactive) { output.write(T.setupUnavailable(info.label, id) + '\n'); return false; }
  while (!bin) {
    if (!approved) {
      output.write('\n  » Hopdeck\n\n  ' + T.setupMissing(info.label) + '\n  ' + T.setupInstallInfo + '\n  ' + T.setupSource(info.url) + '\n\n  ' + T.setupInstallKeys + '\n');
      approved = await ask((key) => /^[\r\n]+$/.test(key) || /^[syi]$/i.test(key) ? true : key === '\x1b' || /^[nq]$/i.test(key) ? false : undefined);
      if (!approved) { output.write(T.setupCancelled + '\n'); return false; }
    }
    try {
      output.write('\n  ' + T.setupInstalling(info.label) + '\n');
      const code = await install(); if (code === 130) return false; if (code !== 0) throw new Error('Installer exit: ' + code);
      bin = find(); if (!bin || await run(bin, ['--version'], { env, stdio: 'ignore', timeout: 15000 }) !== 0) throw new Error('Installed command unavailable');
      config.providerLoginPending = true; save(); output.write('\n  ' + T.setupInstalled(info.label) + '\n');
    } catch (error) {
      bin = null; output.write('\n  ' + T.setupFailed(info.label) + '\n  ' + clean(error.message).slice(0, 300) + '\n  ' + T.setupRetryKeys + '\n');
      if (!await ask((key) => /^[rR]$/.test(key) ? true : /^[\r\n]+$/.test(key) || key === '\x1b' ? false : undefined)) return false;
    }
  }
  if (!config.providerLoginPending || !interactive) return true;
  try { if (await run(bin, info.status, { env, stdio: 'ignore', timeout: 15000 }) === 0) { config.providerLoginPending = false; save(); return true; } } catch { /* ask the CLI to authenticate */ }
  while (true) {
    output.write('\n  ' + T.setupLoginInfo(info.label) + '\n  ' + T.setupLoginKeys + '\n');
    const choice = await ask((key) => /^[\r\n]+$/.test(key) ? 'login' : /^[mM]$/.test(key) ? 'later' : key === '\x1b' ? 'quit' : undefined);
    if (choice !== 'login') return choice === 'later';
    let code = 1; try { code = await run(bin, info.login, { env }); } catch { /* preserve pending login */ }
    if (code === 130) return false;
    if (code === 0) { config.providerLoginPending = false; save(); output.write(T.setupLoginDone + '\n'); return true; }
    output.write(T.setupLoginFailed + '\n');
  }
}

module.exports = { installerFor, canPrompt, findProvider, downloadInstaller, runCommand, installProvider, chooseProvider, ensureProvider };
