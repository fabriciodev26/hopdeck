'use strict';
// Teclado: separar secuencias de teclas, nombres de teclas y edición de una línea con cursor.
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function parseKeys(s) {
  const ks = []; let i = 0;
  while (i < s.length) {
    if (s[i] === '\x1b') {
      if (s[i + 1] === '[' || s[i + 1] === 'O') {
        let j = i + 2; while (j < s.length && !/[A-Za-z~]/.test(s[j])) j++;
        ks.push(s.slice(i, j + 1)); i = j + 1;
      } else { ks.push('\x1b'); i++; }
    } else { const ch = String.fromCodePoint(s.codePointAt(i)); ks.push(ch); i += ch.length; }
  }
  return ks;
}

const KEYMAP = {
  '\x1b[A': 'up', '\x1bOA': 'up', '\x1b[B': 'down', '\x1bOB': 'down', '\x1b[C': 'right', '\x1bOC': 'right',
  '\x1b[D': 'left', '\x1bOD': 'left', '\x1b[5~': 'pgup', '\x1b[6~': 'pgdn', '\x1b[H': 'home', '\x1b[1~': 'home',
  '\x1b[17~': 'f6', '\x1b[18~': 'f7', '\x10': 'ctrlp', '\x1b[15~': 'f5', '\x1b[I': 'focus', '\x1bOP': 'f1', '\x1b[11~': 'f1', '\x1bOQ': 'f2', '\x1b[12~': 'f2', '\x1b[F': 'end', '\x1b[4~': 'end', '\r': 'enter', '\n': 'enter', '\x1b': 'esc', '\x7f': 'bs', '\b': 'bs', '\x03': 'ctrlc',
};


const printable = (k) => k.length > 0 && k.charCodeAt(0) >= 32 && k.charCodeAt(0) !== 127; // ignora Supr, F-teclas y otras secuencias

/** Edición de una línea con cursor. Devuelve { s, pos } o null si la tecla no es de edición. */
function editBuf(str, pos, k, raw) {
  const a = [...str]; pos = clamp(Number.isFinite(pos) ? pos : a.length, 0, a.length);
  if (k === 'left') pos = Math.max(0, pos - 1);
  else if (k === 'right') pos = Math.min(a.length, pos + 1);
  else if (k === 'home' || raw === '\x1bOH' || raw === '\x01') pos = 0;
  else if (k === 'end' || raw === '\x1bOF' || raw === '\x05') pos = a.length;
  else if (k === 'bs') { if (pos > 0) { a.splice(pos - 1, 1); pos--; } }
  else if (raw === '\x1b[3~') a.splice(pos, 1); // Supr
  else if (raw === '\x15') { a.splice(0, pos); pos = 0; } // Ctrl+U: borrar hasta el inicio
  else if (!KEYMAP[raw] && printable(k)) { a.splice(pos, 0, k); pos++; }
  else return null;
  return { s: a.join(''), pos };
}

// Con Node 18 en Windows, F1–F5 llegan con la forma de la consola de Linux (ESC [ [ A … E) y no como ESC O P… / ESC [ 15 ~.
const CONSOLE_FKEYS = { '\x1b[[A': '\x1bOP', '\x1b[[B': '\x1bOQ', '\x1b[[C': '\x1bOR', '\x1b[[D': '\x1bOS', '\x1b[[E': '\x1b[15~' };
/** Convierte las teclas de función de la consola de Linux a la forma estándar de xterm que usa el resto del programa. */
const normalizeKeys = (s) => s.replace(/\x1b\[\[[A-E]/g, (m) => CONSOLE_FKEYS[m]);

module.exports = { parseKeys, KEYMAP, printable, editBuf, normalizeKeys };
