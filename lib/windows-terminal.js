'use strict';
// Windows Terminal: ¿Ctrl+V solo pega texto? (impide pegar imágenes en Claude). Usado por `hopdeck doctor`.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

/** Quita comentarios y comas finales de un JSON con comentarios (settings.json de Windows Terminal). */
function stripJsonc(t) {
  let o = '', i = 0, str = false;
  while (i < t.length) {
    const c = t[i], d = t[i + 1];
    if (str) { o += c; if (c === '\\') { o += d || ''; i += 2; continue; } if (c === '"') str = false; i++; continue; }
    if (c === '"') { str = true; o += c; i++; }
    else if (c === '/' && d === '/') { while (i < t.length && t[i] !== '\n') i++; }
    else if (c === '/' && d === '*') { i += 2; while (i < t.length && !(t[i] === '*' && t[i + 1] === '/')) i++; i += 2; }
    else { o += c; i++; }
  }
  return o.replace(/,(\s*[}\]])/g, '$1');
}
/** ¿Qué hace Ctrl+V en Windows Terminal? 'paste' (pega texto: no deja pasar imágenes), 'custom' (reasignado) o null si no se puede leer. */
function wtCtrlV(text) {
  let j; try { j = JSON.parse(stripJsonc(text)); } catch { return null; }
  const list = [...(Array.isArray(j.actions) ? j.actions : []), ...(Array.isArray(j.keybindings) ? j.keybindings : [])];
  const mine = list.filter((a) => a && [].concat(a.keys || []).some((k) => String(k).toLowerCase() === 'ctrl+v'));
  if (!mine.length) return 'paste'; // sin reasignar: Windows Terminal usa su atajo por defecto (pegar)
  const defs = new Map(list.filter((x) => x && x.id && x.command !== undefined).map((x) => [x.id, x.command]));
  const last = mine[mine.length - 1];
  const c = last.command !== undefined ? last.command : last.id ? (/PasteFromClipboard$/i.test(last.id) ? 'paste' : defs.get(last.id)) : undefined; // formato nuevo: la tecla apunta a una acción por "id"
  return c === 'paste' || (c && typeof c === 'object' && c.action === 'paste') ? 'paste' : 'custom';
}
function wtSettingsFile() {
  let base = process.env.LOCALAPPDATA;
  if (!base && process.env.WSL_DISTRO_NAME) { try { base = cp.execFileSync('wslpath', ['-u', cp.execFileSync('cmd.exe', ['/c', 'echo %LOCALAPPDATA%'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()], { encoding: 'utf8' }).trim(); } catch { /* */ } }
  if (!base) return null;
  const cands = [];
  try { for (const d of fs.readdirSync(path.join(base, 'Packages'))) if (/^Microsoft\.WindowsTerminal/.test(d)) cands.push(path.join(base, 'Packages', d, 'LocalState', 'settings.json')); } catch { /* */ }
  cands.push(path.join(base, 'Microsoft', 'Windows Terminal', 'settings.json'));
  return cands.find((f) => fs.existsSync(f)) || null;
}

module.exports = { stripJsonc, wtCtrlV, wtSettingsFile };
