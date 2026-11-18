'use strict';
const fs = require('fs');
const path = require('path');
const found = new Map();
function findExecutable(name) {
  const hit = found.get(name);
  if (hit) { try { if (fs.statSync(hit).isFile()) return hit; } catch { /* search again */ } found.delete(name); }
  const win = process.platform === 'win32';
  const exts = win ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').concat(['']) : [''];
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') || 'PATH';
  for (const dir of (process.env[pathKey] || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const file = path.join(dir, name + ext.toLowerCase());
      try { if (fs.statSync(file).isFile()) { found.set(name, file); return file; } } catch { /* next */ }
    }
  }
  return null;
}
module.exports = { findExecutable };
