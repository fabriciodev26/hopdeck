'use strict';
// Estadísticas de una conversación (mensajes, tokens, herramientas, modelo) sacadas de su archivo .jsonl. Claude Code solo añade
// líneas al final, así que se lee todo una vez y, cuando el archivo crece, únicamente lo que se añadió. Los archivos llegan a pesar
// decenas de MB: se lee por bloques y se cede el control entre ellos para no congelar la interfaz.
const fs = require('fs');

const newState = () => ({ pos: 0, carry: Buffer.alloc(0), users: 0, asst: new Map(), anon: 0, anonTok: 0, tools: new Set(), anonTools: 0, model: '' });

const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0);

/**
 * Suma una línea del archivo. Las de la conversación empiezan por {"parentUuid" y llevan el rol dentro de "message", al principio:
 * con eso basta para saber si es de usuario o de Claude (el "type" de la línea va al final en las de Claude). Solo se lee entera
 * la línea de Claude; las de usuario con imágenes miden cientos de KB y no hace falta leerlas.
 */
function feed(st, head, full) {
  if (!head.startsWith('{"parentUuid"')) return; // otras líneas: títulos, adjuntos, copias de peticiones…
  const m = /"message":\{[^{}]{0,240}?"role":"(user|assistant)"/.exec(head);
  if (!m) return;
  if (m[1] === 'user') { if (!head.includes('"isMeta":true') && !head.includes('"isSidechain":true')) st.users++; return; }
  let j; try { j = JSON.parse(full()); } catch { return; }
  const msg = j && j.message; if (!msg) return;
  if (typeof msg.model === 'string' && msg.model && !msg.model.startsWith('<')) st.model = msg.model; // «<synthetic>» no es un modelo
  const u = msg.usage || {};
  const cur = { i: num(u.input_tokens), o: num(u.output_tokens), cc: num(u.cache_creation_input_tokens), cr: num(u.cache_read_input_tokens) };
  // Claude Code escribe un mensaje en varias líneas (una por bloque) repitiendo el uso: cada mensaje cuenta una vez, con el mayor valor visto
  if (msg.id) {
    const prev = st.asst.get(msg.id);
    st.asst.set(msg.id, prev ? { i: Math.max(prev.i, cur.i), o: Math.max(prev.o, cur.o), cc: Math.max(prev.cc, cur.cc), cr: Math.max(prev.cr, cur.cr) } : cur);
  } else { st.anon++; st.anonTok += cur.i + cur.o + cur.cc + cur.cr; }
  if (Array.isArray(msg.content)) for (const b of msg.content) if (b && b.type === 'tool_use') { if (b.id) st.tools.add(b.id); else st.anonTools++; }
}

/** Lee lo que se haya añadido al archivo desde la última vez. */
async function update(st, file) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const { size } = await fh.stat();
    if (size < st.pos) Object.assign(st, newState()); // el archivo se reescribió más corto: se empieza de nuevo
    const CHUNK = 2 * 1024 * 1024;
    while (st.pos < size) {
      const buf = Buffer.alloc(Math.min(CHUNK, size - st.pos));
      const { bytesRead } = await fh.read(buf, 0, buf.length, st.pos);
      if (!bytesRead) break;
      st.pos += bytesRead;
      const data = st.carry.length ? Buffer.concat([st.carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead);
      let start = 0, nl;
      while ((nl = data.indexOf(10, start)) >= 0) {
        const s = start, e = nl;
        feed(st, data.toString('utf8', s, Math.min(e, s + 700)), () => data.toString('utf8', s, e));
        start = nl + 1;
      }
      st.carry = data.subarray(start); // la última línea, si aún no está completa
      await new Promise((r) => setImmediate(r));
    }
  } finally { await fh.close(); }
}

/** Resumen: { msgs, tok, tools, model }. tok suma entrada, salida y caché de cada mensaje de Claude. */
function summary(st) {
  let tok = st.anonTok;
  for (const u of st.asst.values()) tok += u.i + u.o + u.cc + u.cr;
  return { msgs: st.users + st.asst.size + st.anon, tok, tools: st.tools.size + st.anonTools, model: st.model };
}

/** 1234 → «1.2K», 206900000 → «206.9M». */
function fmtNum(n) {
  if (n < 1000) return String(n);
  for (const [div, s] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) if (n >= div) return (n / div).toFixed(1).replace(/\.0$/, '') + s;
  return String(n);
}

/** «claude-opus-4-5-20251101» → «opus». */
function modelShort(model) {
  const m = /(opus|sonnet|haiku|fable)/i.exec(model || '');
  return m ? m[1].toLowerCase() : String(model || '').replace(/^claude-/, '').replace(/-\d{8}$/, '').slice(0, 14);
}

module.exports = { newState, update, summary, feed, fmtNum, modelShort };
