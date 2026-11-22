'use strict';
const fs = require('fs');
const path = require('path');
const found = new Map();
function findExecutable(name, { env = process.env, platform = process.platform } = {}) {
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
  const key = platform + '\0' + name + '\0' + env[pathKey] + '\0' + env.PATHEXT, hit = found.get(key);
  if (hit) { try { if (fs.statSync(hit).isFile()) return hit; } catch { /* search again */ } found.delete(key); }
  const win = platform === 'win32', paths = win ? path.win32 : path.posix;
  const exts = win ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';').concat(['']) : [''];
  for (const dir of (env[pathKey] || '').split(win ? ';' : ':')) {
    if (!dir) continue;
    for (const ext of exts) {
      const file = paths.join(dir, name + ext.toLowerCase());
      try { if (fs.statSync(file).isFile()) { found.set(key, file); return file; } } catch { /* next */ }
    }
  }
  return null;
}
module.exports = { findExecutable };
