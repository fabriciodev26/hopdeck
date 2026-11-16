'use strict';
// Búsqueda dentro del contenido de las conversaciones (Tab en el modo búsqueda). Los archivos de historial pueden sumar
// gigas (imágenes en base64, resultados de herramientas), así que la búsqueda se hace en hilos de trabajo, en paralelo,
// y cada acierto se avisa en cuanto se encuentra. Sin dependencias.
//
// No se decodifica el texto: se busca con una expresión regular sobre los bytes del archivo (leídos como latin1).
const fs = require('fs');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const CHUNK = 1024 * 1024;
const MAX_SIZE = 256 * 1024 * 1024; // más grande que esto no se busca (antes 40 MB: se perdían las conversaciones más largas)
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// eslint-disable-next-line no-control-regex
const isAscii = (s) => /^[\u0000-\u007f]*$/.test(s);

/**
 * Expresión que busca `q` sin distinguir mayúsculas directamente sobre los bytes del archivo (leídos como latin1):
 * cada letra se sustituye por las variantes (minúscula/mayúscula) codificadas en UTF-8. Así tampoco hace falta decodificar
 * el texto cuando la búsqueda lleva acentos o eñes. `keep` = bytes que hay que arrastrar entre bloques de lectura.
 */
function buildMatcher(q) {
  if (isAscii(q)) return { re: new RegExp(escapeRe(q), 'i'), keep: Math.max(0, q.length - 1) };
  const parts = []; let bytes = 0;
  for (const ch of q) {
    const vs = [...new Set([ch, ch.toLowerCase(), ch.toUpperCase()])].filter((v) => [...v].length === 1).map((v) => Buffer.from(v, 'utf8').toString('latin1'));
    bytes += Math.max(...vs.map((v) => v.length));
    parts.push(vs.length > 1 ? '(?:' + vs.map(escapeRe).join('|') + ')' : escapeRe(vs[0]));
  }
  return { re: new RegExp(parts.join('')), keep: Math.max(0, bytes - 1) };
}

/** ¿El archivo contiene `q` (sin distinguir mayúsculas)? Síncrono: pensado para correr en un hilo de trabajo. */
function fileHasSync(file, q) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return false; }
  try {
    const size = fs.fstatSync(fd).size;
    if (size > MAX_SIZE || !q) return false;
    const { re, keep } = buildMatcher(q);
    const buf = Buffer.alloc(CHUNK);
    let pos = 0, carry = '';
    while (pos < size) {
      const n = fs.readSync(fd, buf, 0, CHUNK, pos);
      if (!n) break;
      pos += n;
      const text = carry + buf.latin1Slice(0, n);
      if (re.test(text)) return true;
      carry = keep > 0 ? text.slice(-keep) : '';
    }
    return false;
  } catch { return false; } finally { try { fs.closeSync(fd); } catch { /* */ } }
}

if (!isMainThread && workerData && workerData.deepSearch) {
  // hilo de trabajo: recorre su parte de los archivos y avisa de cada acierto
  const { files, q } = workerData;
  for (const f of files) if (fileHasSync(f, q)) parentPort.postMessage({ hit: f });
  parentPort.postMessage({ done: true });
}

/**
 * Busca `q` en `files`. `onHit(file)` se llama en cuanto se encuentra un acierto. Devuelve { done: Promise, cancel() }.
 * Reparte los archivos (los grandes primero) entre varios hilos; si no se pueden crear hilos, busca en el hilo principal por tandas.
 */
function deepSearch(files, q, onHit, { threads } = {}) {
  let cancelled = false; const workers = [];
  const cancel = () => { cancelled = true; for (const w of workers) { try { w.terminate(); } catch { /* */ } } };
  const sized = files.map((f) => { let s = 0; try { s = fs.statSync(f).size; } catch { /* */ } return [f, s]; }).filter(([, s]) => s <= MAX_SIZE).sort((a, b) => b[1] - a[1]);
  const n = Math.max(1, Math.min(threads || 4, os.cpus().length - 1 || 1, sized.length));
  const parts = Array.from({ length: n }, () => []);
  sized.forEach(([f], i) => parts[i % n].push(f));
  const done = new Promise((resolve) => {
    if (!sized.length) return resolve();
    let left = parts.filter((p) => p.length).length;
    const finish = () => { if (--left <= 0) resolve(); };
    const fallback = (list) => { // sin hilos: en el hilo principal, cediendo el control entre archivos
      let i = 0;
      const step = () => { if (cancelled) return finish(); const t = Date.now(); while (i < list.length && Date.now() - t < 20) { const f = list[i++]; if (fileHasSync(f, q)) onHit(f); } if (i < list.length) setImmediate(step); else finish(); };
      step();
    };
    for (const part of parts) {
      if (!part.length) continue;
      let w;
      try { w = new Worker(__filename, { workerData: { deepSearch: true, files: part, q } }); } catch { fallback(part); continue; }
      workers.push(w);
      let ended = false; const end = () => { if (!ended) { ended = true; finish(); } };
      w.on('message', (m) => { if (cancelled) return; if (m.hit) onHit(m.hit); else if (m.done) end(); });
      w.on('error', end); w.on('exit', end);
    }
  });
  return { done, cancel };
}

module.exports = { deepSearch, fileHasSync, MAX_SIZE };
