'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { strip, tmp, makeFixture, makePNG } = require('./helpers');

// El entorno debe quedar fijado ANTES de cargar el módulo.
const root = tmp('hopdeck-unit-');
const fx = makeFixture(root, [
  { name: 'alpha', sessions: [
    { id: 'a1', first: 'hola alfa', ai: 'Título IA', custom: 'Título propio', ageH: 1 },
    { id: 'a2', first: 'segundo mensaje', ai: 'Solo IA', ageH: 2 },
    { id: 'a3', first: 'solo primer mensaje', ageH: 3 },
    { id: 'a4', meta: true, ageH: 4 },                         // vacía: solo metadatos → se ignora
    { id: 'a5', first: '<system-reminder>ruido', ageH: 5 },   // el primer mensaje real no existe → se ignora
  ] },
  { name: 'beta', sessions: [
    { id: 'b1', first: 'igual', ai: 'Repetida', ageH: 6 },
    { id: 'b2', first: 'igual', ai: 'Repetida', ageH: 7 },
  ] },
  { name: 'imgs', sessions: [
    { id: 'i1', first: 'con imagen', ai: 'Con imágenes', ageH: 2, image: makePNG(4, 2, () => [255, 0, 0, 255]).toString('base64'),
      toolImage: makePNG(2, 2, () => [0, 0, 255, 255]).toString('base64') },
    { id: 'i2', first: 'sin imagen', ai: 'Sin imágenes', ageH: 3 },
  ] },
  { name: 'gamma', sessions: Array.from({ length: 12 }, (_, i) => ({ id: 'g' + i, first: 'msg ' + i, ai: 'Caso ' + i, ageH: 10 + i })) },
]);
process.env.CLAUDE_CONFIG_DIR = fx.cfg;
process.env.HOPDECK_CONFIG = path.join(root, 'cfg.json');
process.env.HOPDECK_CACHE = path.join(root, 'cache.json');
process.env.HOPDECK_LANG = 'es';
process.env.NO_COLOR = '1';
const hd = require('../bin/hopdeck.js');
const real = () => hd.scan().filter((p) => p.key !== '__cwd');

test('cw/strW: ancho visual', () => {
  assert.equal(hd.strW('hola'), 4);
  assert.equal(hd.strW('日本'), 4);
  assert.equal(hd.strW('á'), 1); // combinante = 0
  assert.equal(hd.strW('🙂'), 2);
});

test('fit: siempre ocupa exactamente el ancho pedido', () => {
  for (const w of [1, 5, 12, 40]) {
    for (const text of ['hola', 'una frase bastante más larga que el ancho', '日本語のテキスト', '🙂🙂🙂']) {
      assert.equal(hd.strW(strip(hd.fit([[text, '']], w))), w, `${text} @ ${w}`);
    }
  }
  assert.ok(strip(hd.fit([['abcdefghij', '']], 5)).includes('…'));
  assert.equal(hd.strW(strip(hd.fit([['ab', ''], ['cd', ''], ['efghijkl', '']], 6))), 6);
});

test('ago: tramos de tiempo', () => {
  const now = Date.now();
  assert.equal(hd.ago(now), 'ahora');
  assert.equal(hd.ago(now - 5 * 60e3), '5 min');
  assert.equal(hd.ago(now - 3 * 3600e3), '3 h');
  assert.equal(hd.ago(now - 2 * 86400e3), '2 d');
  assert.equal(hd.ago(now - 30 * 86400e3), '4 sem');
  assert.equal(hd.ago(now - 90 * 86400e3), '3 mes');
});

test('fuzzy: subsecuencias, orden y rechazo', () => {
  assert.ok(hd.fuzzy('fct', 'Facturas del mes') >= 0);
  assert.equal(hd.fuzzy('xyz', 'Facturas'), -1);
  assert.ok(hd.fuzzy('factura', 'Facturas del mes') > hd.fuzzy('fctr', 'Facturas del mes'), 'la subcadena exacta puntúa más');
  assert.ok(hd.fuzzy('mes fact', 'Facturas del mes') >= 0, 'varias palabras en cualquier orden');
});

test('wrapText: respeta el ancho y parte palabras largas', () => {
  for (const line of hd.wrapText('uno dos tres cuatro cinco seis siete ocho', 12)) assert.ok(hd.strW(line) <= 12, line);
  const long = hd.wrapText('x'.repeat(30), 10);
  assert.deepEqual(long.map((l) => l.length), [10, 10, 10]);
});

test('readSession: prioridad de títulos y filtros', () => {
  const alpha = real().find((p) => p.key === 'alpha');
  const by = Object.fromEntries(alpha.sessions.map((s) => [s.id, s]));
  assert.equal(by.a1.title, 'Título propio');   // custom > ai > primer mensaje
  assert.equal(by.a2.title, 'Solo IA');
  assert.equal(by.a3.title, 'solo primer mensaje');
  assert.equal(by.a4, undefined, 'sesión vacía ignorada');
  assert.equal(by.a5, undefined, 'mensajes de sistema ignorados');
  assert.equal(by.a1.cwd, fx.cwds.alpha);
});

test('proyectos: cwd, orden por reciente y marca de duplicadas', () => {
  const ps = real();
  assert.deepEqual(ps.map((p) => p.key).sort(), ['alpha', 'beta', 'gamma', 'imgs']);
  const beta = ps.find((p) => p.key === 'beta');
  assert.ok(beta.sessions.every((s) => s.dup), 'b1 y b2 comparten título y primer mensaje');
  assert.ok(!ps.find((p) => p.key === 'alpha').sessions.some((s) => s.dup));
  assert.equal(beta.name, 'beta');
});

test('continuaciones: las sesiones que copian el mismo historial son una sola conversación (gana la del mensaje más reciente)', () => {
  const d = tmp('hopdeck-cont-');
  const msg = (type, uuid, parent, ts, text) => JSON.stringify({ type, uuid, parentUuid: parent, cwd: '/proy', timestamp: ts, message: { role: type, content: text } });
  const w = (id, lines) => fs.writeFileSync(path.join(d, id + '.jsonl'), lines.join('\n') + '\n');
  const base = [msg('user', 'r1', null, '2026-01-01T10:00:00Z', 'Vistas disponibles'), msg('assistant', 'r2', 'r1', '2026-01-01T10:01:00Z', 'ok')];
  w('vieja', base);
  w('media', [...base, msg('user', 'r3', 'r2', '2026-01-02T10:00:00Z', 'seguimos')]);
  w('nueva', [...base, msg('user', 'r3', 'r2', '2026-01-02T10:00:00Z', 'seguimos'), msg('assistant', 'r4', 'r3', '2026-01-03T10:00:00Z', 'listo')]);
  // otras dos conversaciones distintas con el mismo primer mensaje (no comparten ningún uuid): siguen apareciendo, con su #id
  w('otra1', [msg('user', 'x1', null, '2026-01-01T09:00:00Z', 'hola mundo')]);
  w('otra2', [msg('user', 'y1', null, '2026-01-01T09:30:00Z', 'hola mundo')]);
  // abrir la conversación vieja modifica su archivo (queda como la más reciente por fecha), pero no tiene mensajes nuevos
  const ahora = new Date(); fs.utimesSync(path.join(d, 'vieja.jsonl'), ahora, ahora);
  const p = hd.buildProject(d), ids = p.sessions.map((s) => s.id).sort();
  assert.deepEqual(ids, ['nueva', 'otra1', 'otra2'], 'vieja y media se pliegan en nueva');
  const nueva = p.sessions.find((s) => s.id === 'nueva');
  assert.equal(nueva.parts, 2); assert.deepEqual(nueva.prior.sort(), ['media', 'vieja']);
  assert.ok(p.sessions.filter((s) => s.id.startsWith('otra')).every((s) => s.dup && !s.parts), 'las distintas siguen marcadas con #id');
  assert.ok(!nueva.dup);
  assert.equal(hd.sessTag(nueva), '↻2');
  assert.equal(hd.sessTag(p.sessions.find((s) => s.id === 'otra1')), '#otra');
});

test('caché: se escribe y detecta cambios (renombrar = añadir custom-title)', () => {
  assert.ok(fs.existsSync(process.env.HOPDECK_CACHE));
  const before = Object.keys(JSON.parse(fs.readFileSync(process.env.HOPDECK_CACHE, 'utf8')).files).length;
  assert.ok(before >= 8);
  const f = path.join(fx.cfg, 'projects', 'alpha', 'a2.jsonl');
  fs.appendFileSync(f, JSON.stringify({ type: 'custom-title', customTitle: 'Renombrada', sessionId: 'a2' }) + '\n');
  const a2 = real().find((p) => p.key === 'alpha').sessions.find((s) => s.id === 'a2');
  assert.equal(a2.title, 'Renombrada');
});

test('fijar / ocultar / archivar', () => {
  hd.S.projects = hd.scan();
  const beta = hd.S.projects.find((p) => p.key === 'beta');
  hd.toggleProject(beta, 'pinned');
  assert.equal(hd.S.projects[0].key, 'beta', 'los fijados van primero (tras la carpeta actual si existe)');
  hd.toggleProject(beta, 'pinned');
  hd.toggleProject(beta, 'hidden');
  hd.S.showHidden = false;
  assert.ok(!hd.view().some((v) => v.p.key === 'beta'));
  hd.S.showHidden = true;
  assert.ok(hd.view().some((v) => v.p.key === 'beta'));
  hd.toggleProject(beta, 'hidden');
  hd.CFG.archived.push('g0');
  hd.S.showHidden = false;
  assert.ok(!hd.view().find((v) => v.p.key === 'gamma').ss.some((s) => s.id === 'g0'));
  hd.S.showHidden = true;
  assert.ok(hd.view().find((v) => v.p.key === 'gamma').ss.some((s) => s.id === 'g0'));
  hd.CFG.archived.length = 0; hd.S.showHidden = false;
});

test('búsqueda y lista plana (límite de 8 sesiones + "mostrar más")', () => {
  hd.S.projects = hd.scan();
  hd.S.query = 'caso 3';
  assert.deepEqual(hd.view().map((v) => v.p.key), ['gamma']);
  assert.equal(hd.view()[0].ss.length, 1);
  hd.S.query = '';
  hd.S.open = 'gamma';
  const flat = hd.flatList();
  const gi = flat.findIndex((e) => e.t === 'p' && e.p.key === 'gamma');
  assert.equal(flat[gi + 1].t, 'n');
  assert.equal(flat.filter((e) => e.t === 's' && e.p.key === 'gamma').length, 8);
  const more = flat.find((e) => e.t === 'm');
  assert.equal(more.n, 4);
  hd.S.more.add('gamma');
  assert.equal(hd.flatList().filter((e) => e.t === 's' && e.p.key === 'gamma').length, 12);
  assert.ok(!hd.flatList().some((e) => e.t === 'm'));
  hd.S.more.clear();
});

test('teclado: parseKeys', () => {
  assert.deepEqual(hd.parseKeys('\x1b[A\x1b[B\r'), ['\x1b[A', '\x1b[B', '\r']);
  assert.deepEqual(hd.parseKeys('a\x1b'), ['a', '\x1b']);
  assert.deepEqual(hd.parseKeys('ñ🙂'), ['ñ', '🙂']);
  assert.equal(hd.KEYMAP['\x1b[A'], 'up');
});

test('atajo del shell: bloque idempotente y reversible', () => {
  const base = 'export A=1\n';
  const once = base + '\n' + hd.SNIP.posix;
  assert.ok(once.includes(hd.MARK_A));
  assert.equal(hd.stripBlock(once).trim(), base.trim());
  assert.equal(hd.stripBlock(base), base, 'sin bloque no cambia nada');
  for (const kind of ['posix', 'fish', 'pwsh']) {
    assert.ok(hd.SNIP[kind].includes('hopdeck') && hd.SNIP[kind].includes(hd.MARK_B), kind);
  }
});

test('selección: normaliza el orden', () => {
  const [a, b] = hd.selNorm({ a: { x: 9, y: 3 }, b: { x: 2, y: 1 } });
  assert.deepEqual([a.y, b.y], [1, 3]);
});

test('PNG: decodifica con los 5 filtros (RGBA y RGB)', () => {
  const px = (x, y) => [x * 30, y * 40, (x + y) * 10, 255 - x * 5];
  for (const ctype of [6, 2]) {
    const png = makePNG(7, 6, px, ctype);
    const d = hd.decodePNG(png);
    assert.equal(d.w, 7); assert.equal(d.h, 6);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 7; x++) {
      const o = (y * 7 + x) * 4, e = px(x, y);
      assert.deepEqual([d.rgba[o], d.rgba[o + 1], d.rgba[o + 2]], e.slice(0, 3), `rgb @${x},${y} tipo ${ctype}`);
      assert.equal(d.rgba[o + 3], ctype === 6 ? e[3] : 255);
    }
  }
  assert.equal(hd.decodePNG(Buffer.from('no soy un png, de verdad que no')), null);
  assert.equal(hd.decodeImage({ data: Buffer.from('basura').toString('base64') }), null);
});

test('imágenes en macOS: lo que el decodificador propio no entiende se convierte con sips', () => {
  const imgs = require('../lib/images');
  assert.equal(imgs.sniffExt(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1')), 'webp');
  assert.equal(imgs.sniffExt(Buffer.from('GIF89a..........', 'latin1')), 'gif');
  assert.equal(imgs.sniffExt(Buffer.from('\x00\x00\x00\x18ftypheic....', 'latin1')), 'heic');
  const webp = Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1');
  const llamadas = [];
  const falso = (cmd, args) => { // hace de sips: deja un PNG de 3×2 donde se le pide
    llamadas.push([cmd, args]);
    fs.writeFileSync(args[args.indexOf('--out') + 1], makePNG(3, 2, () => [10, 20, 30, 255]));
    return { status: 0 };
  };
  const d = imgs.decodeViaSips(webp, falso);
  assert.deepEqual([d.w, d.h], [3, 2], 'devuelve la imagen convertida');
  assert.equal(llamadas[0][0], 'sips');
  assert.ok(llamadas[0][1].includes('-Z') && /in\.webp$/.test(llamadas[0][1][llamadas[0][1].indexOf('-Z') + 2]), 'reduce y conserva la extensión del original');
  assert.ok(!fs.existsSync(path.dirname(llamadas[0][1][llamadas[0][1].indexOf('--out') + 1])), 'borra los archivos temporales');
  assert.equal(imgs.decodeViaSips(webp, () => ({ status: 1 })), null, 'si sips falla, no hay imagen');
  assert.equal(imgs.decodeViaSips(webp, () => { throw new Error('no existe'); }), null, 'si no existe sips, tampoco');
});

test('imágenes: reducir, componer sobre fondo y dibujar con medios bloques', () => {
  const red = new Uint8Array(4 * 2 * 4); for (let i = 0; i < 8; i++) red.set([255, 0, 0, 255], i * 4);
  const out = hd.scaleBox(red, 4, 2, 2, 1);
  assert.deepEqual([...out], [255, 0, 0, 255, 0, 0]);
  const clear = hd.scaleBox(new Uint8Array([0, 255, 0, 0]), 1, 1, 1, 1); // totalmente transparente
  assert.deepEqual([...clear], [28, 28, 30]);
  const { tw, th } = hd.fitSize(100, 50, 20, 20);
  assert.ok(tw <= 20 && th <= 20 && th % 2 === 0);
  assert.ok(Math.abs(tw / th - 2) < 0.4, 'conserva la proporción');
  const rows = hd.halfBlocks(new Uint8Array(3 * 4 * 3).fill(120), 3, 4);
  assert.equal(rows.length, 2);
  assert.equal(strip(rows[0]), '▀▀▀');
});

test('imágenes del historial: base64 directo y dentro de resultados de herramientas', async () => {
  const x = real().find((p) => p.key === 'imgs').sessions.find((q) => q.id === 'i1');
  const imgs = await hd.extractImages(x.file);
  assert.equal(imgs.length, 2);
  assert.ok(imgs.every((i) => i.media === 'image/png'));
  const d = hd.decodeImage(imgs[0]);
  assert.equal(d.w, 4); assert.equal(d.h, 2);
  assert.deepEqual([...d.rgba.slice(0, 4)], [255, 0, 0, 255]);
  const none = real().find((p) => p.key === 'imgs').sessions.find((q) => q.id === 'i2');
  assert.equal((await hd.extractImages(none.file)).length, 0);
  const out = []; hd.collectImages([{ type: 'text', text: 'x' }, { type: 'image', source: { type: 'url' } }], out);
  assert.equal(out.length, 0, 'solo se aceptan imágenes en base64');
});

// ───────────── edición de texto con cursor ─────────────
test('editBuf: cursor, insertar, borrar, Supr, Inicio/Fin y teclas desconocidas', () => {
  const run = (s, pos, ...keys) => { for (const raw of keys) { const k = hd.KEYMAP[raw] || raw; const r = hd.editBuf(s, pos, k, raw); if (r) { s = r.s; pos = r.pos; } } return { s, pos }; };
  assert.deepEqual(run('', 0, 'a', 'b', 'd', 'e'), { s: 'abde', pos: 4 });
  assert.deepEqual(run('abde', 4, '\x1b[D', '\x1b[D', 'c'), { s: 'abcde', pos: 3 });          // ← ← c
  assert.deepEqual(run('abcde', 3, '\x1b[3~'), { s: 'abce', pos: 3 });                        // Supr
  assert.deepEqual(run('abce', 3, '\x1b[H', 'X'), { s: 'Xabce', pos: 1 });                    // Inicio
  assert.deepEqual(run('Xabce', 1, '\x1b[F', 'Z'), { s: 'XabceZ', pos: 6 });                  // Fin
  assert.deepEqual(run('abc', 2, '\x7f'), { s: 'ac', pos: 1 });                                // Retroceso a mitad
  assert.deepEqual(run('abc', 0, '\x7f'), { s: 'abc', pos: 0 });                               // Retroceso al inicio: no hace nada
  assert.deepEqual(run('abc', 2, '\x15'), { s: 'c', pos: 0 });                                 // Ctrl+U
  assert.deepEqual(run('áé🙂', 3, '\x1b[D', '\x7f'), { s: 'á🙂', pos: 1 });                      // caracteres de varios bytes
  assert.equal(hd.editBuf('abc', 1, '\x1b[15~', '\x1b[15~'), null, 'las F-teclas no se insertan como texto');
  assert.equal(hd.editBuf('abc', 1, '\x1b[2~', '\x1b[2~'), null, 'otras secuencias de escape tampoco');
});

// ───────────── Windows Terminal: Ctrl+V ─────────────
test('wtCtrlV: detecta si Ctrl+V solo pega texto o está reasignado (JSON con comentarios)', () => {
  assert.equal(hd.wtCtrlV('{ "actions": [] }'), 'paste', 'por defecto Ctrl+V pega');
  assert.equal(hd.wtCtrlV('{ // comentario\n "actions": [ { "command": "paste", "keys": "ctrl+v" }, ], }'), 'paste', 'comentarios y comas finales');
  assert.equal(hd.wtCtrlV('{ "actions": [ { "command": { "action": "sendInput", "input": "\\u001bv" }, "keys": "ctrl+v" } ] }'), 'custom');
  assert.equal(hd.wtCtrlV('{ "keybindings": [ { "command": null, "keys": ["Ctrl+V"] } ] }'), 'custom', 'desasignado también cuenta');
  assert.equal(hd.wtCtrlV('{ "a": "http://x.y/*no es comentario*/" , "actions": [] }'), 'paste', 'no rompe cadenas con // o /*');
  assert.equal(hd.wtCtrlV('{ "actions": [ { "id": "Terminal.PasteFromClipboard", "keys": "ctrl+v" } ] }'), 'paste', 'formato nuevo: tecla → id de la acción');
  assert.equal(hd.wtCtrlV('{ "actions": [ { "command": { "action": "sendInput", "input": "x" }, "id": "User.imagen" }, { "id": "User.imagen", "keys": "ctrl+v" } ] }'), 'custom', 'formato nuevo con acción propia');
  assert.equal(hd.wtCtrlV('esto no es json'), null);
  assert.equal(hd.stripJsonc('{"u":"a//b" /* x */, "v":1,}'), '{"u":"a//b" , "v":1}');
});

// ───────────── selector de carpetas ─────────────
test('fbNames: oculta carpetas con punto y de sistema salvo que se pidan', () => {
  const d = tmp('hopdeck-fb-');
  for (const n of ['zeta', 'Alfa', '.git', 'node_modules', 'beta']) fs.mkdirSync(path.join(d, n));
  fs.writeFileSync(path.join(d, 'archivo.txt'), 'x');
  assert.deepEqual(hd.fbNames(d, false), ['Alfa', 'beta', 'zeta'], 'solo carpetas visibles, ordenadas');
  assert.deepEqual(hd.fbNames(d, true), ['.git', 'Alfa', 'beta', 'node_modules', 'zeta'], 'con ocultas');
  assert.deepEqual(hd.fbNames(path.join(d, 'no-existe'), false), [], 'una ruta inválida no rompe');
});

// ───────────── imágenes: numeración y límites ─────────────
test('extractImages: empareja "[Image #N]" con la imagen de ese mensaje y respeta el límite', async () => {
  const d = tmp('hopdeck-img-'); const f = path.join(d, 's.jsonl');
  const png = (c) => makePNG(2, 2, () => c).toString('base64');
  const msg = (content) => JSON.stringify({ type: 'user', message: { role: 'user', content } });
  fs.writeFileSync(f, [
    msg([{ type: 'text', text: '[Image #1] mira' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png([255, 0, 0, 255]) } }]),
    msg([{ type: 'text', text: '[Image #5] y [Image #6]' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png([0, 255, 0, 255]) } }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png([0, 0, 255, 255]) } }]),
    msg([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png([9, 9, 9, 255]) } }]), // sin marca → sin número
  ].join('\n') + '\n');
  const imgs = await hd.extractImages(f);
  assert.deepEqual(imgs.map((i) => i.n), [1, 5, 6, undefined]);
  const prev = hd.CFG.maxImages; hd.CFG.maxImages = 2;
  assert.equal((await hd.extractImages(f)).length, 3, 'el límite se aplica por mensaje completo (los números no se desalinean)');
  hd.CFG.maxImages = prev;
});

// ───────────── chats nuevos sin historial ─────────────
test('finishScan: carpetas recientes y chats vivos sin historial aparecen en la lista', () => {
  const d = tmp('hopdeck-new-'); const carpeta = path.join(d, 'proyecto-nuevo'); fs.mkdirSync(carpeta);
  const viva = path.join(d, 'chat-vivo'); fs.mkdirSync(viva);
  hd.CFG.recent = [{ dir: carpeta, t: Date.now() }, { dir: path.join(d, 'borrada'), t: 1 }];
  hd.E.sessions.set('new-1', { cwd: viva, sid: null, t0: Date.now(), title: 'Nueva' });
  try {
    const names = hd.finishScan([]).map((p) => p.cwd);
    assert.ok(names.includes(carpeta), 'carpeta reciente sin historial');
    assert.ok(names.includes(viva), 'carpeta con un chat vivo');
    assert.ok(!names.includes(path.join(d, 'borrada')), 'una carpeta que ya no existe no se lista');
  } finally { hd.E.sessions.clear(); hd.CFG.recent = []; }
});

test('linkChats: un chat nuevo se enlaza con su historial cuando Claude lo escribe', () => {
  const t0 = Date.now() - 1000;
  const chat = { cwd: '/x/y', sid: null, t0, title: 'Nueva' }; const otro = { cwd: '/x/z', sid: null, t0, title: 'Otra' };
  hd.E.sessions.set('new-a', chat); hd.E.sessions.set('new-b', otro);
  try {
    hd.linkChats([{ cwd: '/x/y', sessions: [{ id: 'vieja', mtime: t0 - 60e3, title: 'Antigua' }, { id: 'nueva', mtime: t0 + 500, title: 'Hola mundo' }] },
                   { cwd: '/x/z', sessions: [{ id: 'vieja2', mtime: t0 - 60e3, title: 'Antigua' }] }]);
    assert.equal(chat.sid, 'nueva', 'toma la sesión creada después de abrir el chat');
    assert.equal(chat.title, 'Hola mundo');
    assert.equal(otro.sid, null, 'sin historial nuevo se queda como chat nuevo');
  } finally { hd.E.sessions.clear(); }
});

test('findImageByNumber: encuentra imágenes más allá del límite de la galería', async () => {
  const d = tmp('hopdeck-find-'); const f = path.join(d, 's.jsonl');
  const png = makePNG(2, 2, () => [1, 2, 3, 255]).toString('base64');
  const lines = [];
  for (let i = 1; i <= 205; i++) lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: `[Image #${i}]` }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }] } }));
  fs.writeFileSync(f, lines.join('\n') + '\n');
  const all = await hd.extractImages(f);
  assert.equal(all.length, 200, 'la galería se limita a 200');
  assert.ok(!all.some((i) => i.n === 203), 'la #203 no está en la galería');
  const im = await hd.findImageByNumber(f, 203);
  assert.ok(im && im.data === png, 'pero se encuentra recorriendo el archivo');
  assert.equal(await hd.findImageByNumber(f, 999), null, 'una que no existe devuelve null');
});

// ───────────── seguridad ─────────────
test('seguridad: el texto del historial no puede meter secuencias de escape en el terminal', () => {
  const malo = 'Título\x1b]52;c;aGFja2Vk\x07\x1b[2J\x1b]0;pwn\x07 \u202eoculto\x00fin';
  const salida = hd.fit([[malo, '']], 80);
  const sinColor = salida.replace(/\x1b\[[0-9;]*m/g, ''); // solo se admiten los colores que pone el propio hub
  assert.ok(!/[\x00-\x08\x0b-\x1a\x1c-\x1f\x7f]/.test(sinColor), 'sin caracteres de control');
  assert.ok(!sinColor.includes('\x1b'), 'sin ESC');
  assert.ok(!sinColor.includes('\u202e'), 'sin controles de dirección Unicode');
  assert.equal(hd.strW(strip(salida)), 80, 'sigue ocupando el ancho exacto');
  assert.equal(hd.clean('a\x1b[31mb\x07c'), 'a[31mbc');
});

test('seguridad: la extensión de una imagen sale de sus bytes, nunca del media_type del historial', () => {
  const b64 = (buf) => buf.toString('base64');
  const png = makePNG(2, 2, () => [0, 0, 0, 255]);
  assert.equal(hd.imageExt({ media: 'image/exe', data: b64(png) }), 'png', 'un PNG es PNG aunque diga "image/exe"');
  assert.equal(hd.imageExt({ media: 'image/png', data: b64(Buffer.from('MZ\x90\x00programa', 'latin1')) }), null, 'un ejecutable no es imagen aunque diga "image/png"');
  assert.equal(hd.imageExt({ data: b64(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])) }), 'jpg');
  assert.equal(hd.imageExt({ data: b64(Buffer.from('GIF89a....', 'latin1')) }), 'gif');
  assert.equal(hd.imageExt({ data: b64(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1')) }), 'webp');
  const { dir, files } = hd.exportImages([{ media: 'image/bat', data: b64(Buffer.from('@echo off\r\ncalc', 'latin1')) }, { media: 'image/png', data: b64(png) }]);
  try {
    assert.equal(files[0], null, 'lo que no es una imagen no se devuelve para abrir');
    assert.ok(files[1].endsWith('.png'));
    assert.ok(fs.readdirSync(dir).every((f) => /\.(png|bin)$/.test(f)), 'solo se escriben .png o .bin');
    assert.ok(!/hopdeck-images-[a-z0-9]{1,12}$/i.test(path.basename(dir)) || path.basename(dir).length > 'hopdeck-images-'.length, 'carpeta con nombre aleatorio');
    if (process.platform !== 'win32') assert.equal(fs.statSync(dir).mode & 0o077, 0, 'carpeta privada (0700)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const a = hd.exportImages([]).dir, b = hd.exportImages([]).dir;
  try { assert.notEqual(a, b, 'cada exportación usa una carpeta distinta'); } finally { fs.rmSync(a, { recursive: true, force: true }); fs.rmSync(b, { recursive: true, force: true }); }
});

test('seguridad: solo se reanudan sesiones con identificador normal', () => {
  for (const ok of ['3e96a3b6-b6ee-49fb-8406-d9ba8d66a5c4', 'abc_DEF.1']) assert.ok(hd.safeId(ok), ok);
  for (const mal of ['', 'a b', 'a&calc', 'a;rm -rf', '../x', '$(id)', 'x'.repeat(200), null]) assert.ok(!hd.safeId(mal), String(mal));
});

// ───────────── instalación del atajo: copia de seguridad ─────────────
test('install: guarda una copia del perfil antes de tocarlo, no la sobrescribe y desinstalar restaura el contenido', () => {
  const d = tmp('hopdeck-install-'); const rc = path.join(d, '.bashrc'); const bak = rc + '.hopdeck-backup';
  const original = '# mi perfil\nexport EDITOR=vim\nalias ll="ls -l"\n';
  fs.writeFileSync(rc, original);
  const t = [{ file: rc, kind: 'posix' }];

  const r1 = hd.install(false, t, true);
  assert.deepEqual(r1.baks, [bak], 'avisa de la copia que creó');
  assert.equal(fs.readFileSync(bak, 'utf8'), original, 'la copia es idéntica al perfil original');
  const tras = fs.readFileSync(rc, 'utf8');
  assert.ok(tras.startsWith(original) && tras.includes(hd.MARK_A) && tras.includes('claude()'), 'conserva tu contenido y añade el bloque');

  const r2 = hd.install(false, t, true);                     // instalar otra vez
  assert.deepEqual(r2.baks, [], 'no crea otra copia');
  assert.equal(fs.readFileSync(bak, 'utf8'), original, 'la copia original no se sobrescribe');
  assert.equal(fs.readFileSync(rc, 'utf8').split(hd.MARK_A).length, 2, 'un solo bloque (idempotente)');

  hd.install(true, t, true);                                 // desinstalar
  assert.equal(fs.readFileSync(rc, 'utf8').trim(), original.trim(), 'queda como estaba');
});

test('install: un perfil que no existe se crea sin copia, y desinstalar no toca archivos sin el atajo', () => {
  const d = tmp('hopdeck-install2-'); const nuevo = path.join(d, 'sub', 'perfil.ps1'); const ajeno = path.join(d, '.zshrc');
  fs.writeFileSync(ajeno, 'export A=1\n');
  const r = hd.install(false, [{ file: nuevo, kind: 'pwsh' }], true);
  assert.deepEqual(r.baks, [], 'no hay nada que copiar');
  assert.ok(fs.readFileSync(nuevo, 'utf8').includes('function claude'));
  const antes = fs.statSync(ajeno).mtimeMs;
  hd.install(true, [{ file: ajeno, kind: 'posix' }, { file: path.join(d, 'no-existe') , kind: 'posix' }], true);
  assert.equal(fs.statSync(ajeno).mtimeMs, antes, 'el archivo sin el atajo no se reescribe');
  assert.ok(!fs.existsSync(ajeno + '.hopdeck-backup'), 'ni se hace copia');
  assert.ok(!fs.existsSync(path.join(d, 'no-existe')), 'ni se crean archivos al desinstalar');
});

test('install: si no se puede hacer la copia, el perfil no se modifica', () => {
  const d = tmp('hopdeck-install3-'); const rc = path.join(d, '.bashrc');
  fs.writeFileSync(rc, 'export A=1\n');
  const original = fs.readFileSync(rc, 'utf8');
  const orig = fs.copyFileSync; fs.copyFileSync = () => { throw new Error('sin permisos'); }; // simula que la copia falla
  try {
    const r = hd.install(false, [{ file: rc, kind: 'posix' }], true);
    assert.deepEqual(r.done, [], 'no se da por instalado');
    assert.equal(fs.readFileSync(rc, 'utf8'), original, 'el perfil queda intacto');
  } finally { fs.copyFileSync = orig; }
});

// ───────────── textos: español e inglés completos ─────────────
test('i18n: español e inglés tienen las mismas claves y todas las funciones devuelven texto', () => {
  const file = require.resolve('../lib/i18n.js'), prev = process.env.HOPDECK_LANG;
  const load = (lang) => { process.env.HOPDECK_LANG = lang; delete require.cache[file]; return require(file).T; };
  try {
    const es = load('es'), en = load('en');
    assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort(), 'no falta ninguna clave en un idioma');
    for (const [lang, T] of [['es', es], ['en', en]]) {
      for (const [k, v] of Object.entries(T)) if (typeof v === 'function') assert.equal(typeof v(3, 'x', 'y'), 'string', `${lang}.${k}()`);
      assert.ok(T.dcHist && T.dcPrefs && T.dcShort, `${lang}: los textos de "doctor" están localizados`);
    }
  } finally {
    if (prev === undefined) delete process.env.HOPDECK_LANG; else process.env.HOPDECK_LANG = prev;
    delete require.cache[file];
  }
});

test('findClaude: encuentra un programa en el PATH por su nombre y no inventa los que faltan', () => {
  const d = tmp('hopdeck-path-'); const prev = process.env.PATH, prevExt = process.env.PATHEXT;
  const exe = process.platform === 'win32' ? 'programa-de-prueba.cmd' : 'programa-de-prueba';
  fs.writeFileSync(path.join(d, exe), process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n'); if (process.platform !== 'win32') fs.chmodSync(path.join(d, exe), 0o755);
  process.env.PATH = d + path.delimiter + prev;
  try {
    assert.ok(hd.findClaude('programa-de-prueba'), 'lo encuentra');
    assert.equal(hd.findClaude('no-existe-este-programa'), null, 'devuelve null si no está');
  } finally { process.env.PATH = prev; if (prevExt === undefined) delete process.env.PATHEXT; else process.env.PATHEXT = prevExt; }
});

// ───────────── primer arranque: ofrecer el atajo ─────────────
test('offerShortcut: pregunta una vez, respeta la respuesta y nunca pregunta si ya está instalado', async () => {
  const d = tmp('hopdeck-offer-'); const rc = path.join(d, '.bashrc'); const bak = rc + '.hopdeck-backup';
  const original = 'export A=1\n'; const list = [{ file: rc, kind: 'posix' }];
  const reset = () => { hd.CFG.shortcutAsked = false; fs.writeFileSync(rc, original); fs.rmSync(bak, { force: true }); };
  const ask = (ans) => { const f = async () => { f.n++; return ans; }; f.n = 0; return f; };
  const prevPrompt = process.env.HOPDECK_NOPROMPT; delete process.env.HOPDECK_NOPROMPT;
  try {
    reset(); let a = ask('later');
    assert.equal(await hd.offerShortcut({ list, ask: a, quiet: true }), 'later');
    assert.ok(!hd.CFG.shortcutAsked, '"Más tarde" no cuenta como respuesta');
    assert.equal(fs.readFileSync(rc, 'utf8'), original, 'no toca el perfil');

    a = ask('no');
    assert.equal(await hd.offerShortcut({ list, ask: a, quiet: true }), 'no');
    assert.ok(hd.CFG.shortcutAsked, 'se acuerda de que dijiste que no');
    assert.equal(fs.readFileSync(rc, 'utf8'), original, 'sigue sin tocar el perfil');
    a = ask('yes');
    assert.equal(await hd.offerShortcut({ list, ask: a, quiet: true }), 'skipped', 'ya no vuelve a preguntar');
    assert.equal(a.n, 0);

    reset(); a = ask('yes');
    assert.equal(await hd.offerShortcut({ list, ask: a, quiet: true }), 'yes');
    assert.ok(fs.readFileSync(rc, 'utf8').includes(hd.MARK_A), 'instala el atajo');
    assert.equal(fs.readFileSync(bak, 'utf8'), original, 'con copia de seguridad del perfil');
    assert.ok(hd.CFG.shortcutAsked);

    reset(); hd.install(false, list, true); hd.CFG.shortcutAsked = false; a = ask('yes');
    assert.equal(await hd.offerShortcut({ list, ask: a, quiet: true }), 'installed', 'si ya estaba instalado, no pregunta');
    assert.equal(a.n, 0);
    assert.ok(hd.CFG.shortcutAsked);

    reset(); process.env.HOPDECK_NOPROMPT = '1'; a = ask('yes');
    assert.equal(await hd.offerShortcut({ list, ask: a, quiet: true }), 'skipped', 'HOPDECK_NOPROMPT lo desactiva');
    assert.equal(a.n, 0);
  } finally { if (prevPrompt === undefined) delete process.env.HOPDECK_NOPROMPT; else process.env.HOPDECK_NOPROMPT = prevPrompt; hd.CFG.shortcutAsked = false; }
});

// ───────────── rendimiento y ratón del modo tmux ─────────────
const silenciar = (f) => { const w = process.stdout.write; process.stdout.write = () => true; try { return f(); } finally { process.stdout.write = w; } }; // la interfaz dibuja en stdout

test('sidebarMouse: la rueda mueve la selección y un clic despliega el proyecto (modo tmux)', () => {
  const saved = { ...hd.S };
  try {
    Object.assign(hd.S, { projects: hd.scan(), c: 0, coff: 0, query: '', fb: null, qs: null, help: false, prompt: null });
    hd.S.open = hd.S.projects[0].key;
    silenciar(() => {
      hd.sidebarMouse(65, 5, 5, 'M', 30); assert.equal(hd.S.c, 3, 'rueda abajo: tres filas');
      hd.sidebarMouse(64, 5, 5, 'M', 30); assert.equal(hd.S.c, 0, 'rueda arriba: vuelve');
      hd.sidebarMouse(64, 5, 5, 'M', 30); assert.equal(hd.S.c, 0, 'no se sale por arriba');
      const L = hd.flatList(), idx = L.findIndex((e) => e.t === 'p' && !e.open);
      hd.sidebarMouse(0, 5, 3 + idx - hd.S.coff, 'M', 30);
      const sel = hd.flatList()[hd.S.c]; // al desplegar este proyecto el que estaba abierto se contrae, y la fila clicada sube de posición
      assert.ok(sel.t === 'p' && sel.p.key === L[idx].p.key, 'el clic deja marcada la fila del proyecto');
      assert.equal(hd.S.open, L[idx].p.key, 'y lo despliega');
      const antes = [hd.S.c, hd.S.open];
      hd.sidebarMouse(0, 5, 4, 'm', 30);   // soltar el botón
      hd.sidebarMouse(32, 5, 4, 'M', 30);  // arrastrar
      hd.sidebarMouse(2, 5, 4, 'M', 30);   // botón derecho
      hd.sidebarMouse(0, 5, 1, 'M', 30);   // cabecera
      hd.sidebarMouse(0, 5, 29, 'M', 30);  // pie
      assert.deepEqual([hd.S.c, hd.S.open], antes, 'todo eso se ignora');
    });
  } finally { Object.assign(hd.S, saved); }
});

test('arrastrar las líneas divisorias cambia el ancho de la lista y del panel de git, con límites', () => {
  const cols = Object.getOwnPropertyDescriptor(process.stdout, 'columns'), rows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
  const saved = { sidebar: hd.CFG.sidebar, gitw: hd.CFG.gitw, git: hd.E.git, hide: hd.E.hideSide, gallery: hd.E.gallery };
  Object.defineProperty(process.stdout, 'columns', { value: 160, configurable: true });
  Object.defineProperty(process.stdout, 'rows', { value: 40, configurable: true });
  try {
    Object.assign(hd.E, { git: true, hideSide: false, gallery: null }); hd.CFG.sidebar = 0; hd.CFG.gitw = 0;
    silenciar(() => {
      const lim = hd.panelLimits(160);
      assert.deepEqual(lim, { min: 24, max: 80 }, '15 % y 50 % de 160 columnas');
      assert.deepEqual(hd.panelLimits(100), { min: 20, max: 50 }, 'piso de 20 columnas');
      let L = hd.embedLayout();
      assert.equal(L.GW, 38, 'git por defecto');
      // lista: la línea está en la columna SW+1; arrastrarla a la 61 deja 60 columnas
      hd.onMouse(0, L.SW + 1, 5, 'M');
      assert.equal(hd.E.drag, 'side', 'pulsar sobre la línea empieza el arrastre');
      hd.onMouse(32, 41, 5, 'M'); assert.equal(hd.embedLayout().SW, 40, 'sigue al ratón');
      hd.onMouse(32, 3, 5, 'M'); assert.equal(hd.embedLayout().SW, lim.min, 'mínimo');
      hd.onMouse(32, 150, 5, 'M'); assert.ok(hd.embedLayout().SW <= lim.max && hd.embedLayout().GW === 38, 'máximo; el git no desaparece');
      hd.onMouse(0, 30, 5, 'm'); assert.equal(hd.E.drag, null, 'soltar termina el arrastre');
      assert.equal(hd.CFG.sidebar, hd.embedLayout().SW, 'el ancho se recuerda');
      // git: la línea está en SW+rw+2; arrastrarla hacia la izquierda ensancha el panel
      hd.CFG.sidebar = 40; L = hd.embedLayout();
      const gx = L.SW + 1 + L.rw + 1;
      hd.onMouse(0, gx, 5, 'M'); assert.equal(hd.E.drag, 'git');
      hd.onMouse(32, 160 - 50, 5, 'M'); assert.equal(hd.embedLayout().GW, 50, 'ancho 50');
      hd.onMouse(32, 159, 5, 'M'); assert.equal(hd.embedLayout().GW, lim.min, 'mínimo');
      hd.onMouse(32, 1, 5, 'M'); assert.ok(hd.embedLayout().GW > 0 && hd.embedLayout().rw >= 60, 'el chat conserva su mínimo');
      hd.onMouse(0, 10, 5, 'm');
      hd.onMouse(0, 20, 5, 'M'); assert.equal(hd.E.drag, null, 'pulsar fuera de una línea no arrastra');
    });
  } finally {
    Object.assign(hd.E, { git: saved.git, hideSide: saved.hide, gallery: saved.gallery, drag: null }); hd.CFG.sidebar = saved.sidebar; hd.CFG.gitw = saved.gitw;
    if (cols) Object.defineProperty(process.stdout, 'columns', cols); else delete process.stdout.columns;
    if (rows) Object.defineProperty(process.stdout, 'rows', rows); else delete process.stdout.rows;
  }
});

test('sidebarMouse: en el selector de carpetas un clic entra en la carpeta', () => {
  const d = tmp('hopdeck-fbm-'); fs.mkdirSync(path.join(d, 'carpeta-a'));
  const saved = { ...hd.S };
  try {
    silenciar(() => {
      hd.fbOpen(d);
      const idx = hd.fbRows().findIndex((r) => r.k === 'dir' && r.n === 'carpeta-a');
      assert.ok(idx >= 0);
      hd.sidebarMouse(0, 5, 3 + idx - hd.S.fb.off, 'M', 30);
      assert.equal(hd.S.fb.dir, path.join(d, 'carpeta-a'), 'el clic entra en la carpeta');
    });
  } finally { Object.assign(hd.S, saved); }
});

test('gitBranch: guarda el resultado unos segundos (en WSL leer /mnt/c cuesta ~4 ms por dibujo)', () => {
  const d = tmp('hopdeck-git-'); fs.mkdirSync(path.join(d, '.git'));
  fs.writeFileSync(path.join(d, '.git', 'HEAD'), 'ref: refs/heads/principal\n');
  assert.equal(hd.gitBranch(d), 'principal');
  fs.writeFileSync(path.join(d, '.git', 'HEAD'), 'ref: refs/heads/otra\n');
  assert.equal(hd.gitBranch(d), 'principal', 'dentro de los 3 s no vuelve a leer el archivo');
  const now = Date.now; Date.now = () => now() + 4000;
  try { assert.equal(hd.gitBranch(d), 'otra', 'pasado el tiempo, sí'); } finally { Date.now = now; }
  assert.equal(hd.gitBranch(path.join(d, 'no-existe')), '', 'sin git devuelve vacío');
});

test('findClaude: recuerda dónde está y vuelve a buscar si el archivo desaparece', () => {
  const prev = process.env.PATH, win = process.platform === 'win32', exe = win ? 'prog-memoria.cmd' : 'prog-memoria';
  const crear = (dir) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, exe), win ? '@echo off\r\n' : '#!/bin/sh\n'); if (!win) fs.chmodSync(path.join(dir, exe), 0o755); return path.join(dir, exe); };
  const d1 = path.join(tmp('hopdeck-fc-'), 'a'), d2 = path.join(tmp('hopdeck-fc-'), 'b');
  try {
    const f1 = crear(d1); process.env.PATH = d1 + path.delimiter + prev;
    assert.equal(hd.findClaude('prog-memoria').toLowerCase(), f1.toLowerCase());
    process.env.PATH = prev; // aunque el PATH cambie, mientras el archivo exista se devuelve el recordado
    assert.equal(hd.findClaude('prog-memoria').toLowerCase(), f1.toLowerCase(), 'lo recuerda');
    fs.rmSync(f1);
    assert.equal(hd.findClaude('prog-memoria'), null, 'si desaparece, busca de nuevo y no inventa');
    const f2 = crear(d2); process.env.PATH = d2 + path.delimiter + prev;
    assert.equal(hd.findClaude('prog-memoria').toLowerCase(), f2.toLowerCase(), 'y lo encuentra en el sitio nuevo');
  } finally { process.env.PATH = prev; }
});

test('normalizeKeys: las teclas F1–F5 de la consola de Linux (Node 18 en Windows) se convierten a las de xterm', () => {
  assert.equal(hd.normalizeKeys('\x1b[[A'), '\x1bOP', 'F1');
  assert.equal(hd.normalizeKeys('\x1b[[B'), '\x1bOQ', 'F2');
  assert.equal(hd.normalizeKeys('\x1b[[C'), '\x1bOR', 'F3');
  assert.equal(hd.normalizeKeys('\x1b[[D'), '\x1bOS', 'F4');
  assert.equal(hd.normalizeKeys('\x1b[[E'), '\x1b[15~', 'F5');
  assert.equal(hd.normalizeKeys('a\x1b[[Ab\x1b[B'), 'a\x1bOPb\x1b[B', 'dentro de un bloque con otras teclas');
  for (const k of ['\x1bOP', '\x1b[11~', '\x1b[A', '\x1b[1;5A', 'hola', '\x1b[[F']) assert.equal(hd.normalizeKeys(k), k, 'lo demás no se toca: ' + JSON.stringify(k));
});

// ───────────── historial real: primer mensaje con imagen, duplicados y marcas ─────────────
const linea = (o) => JSON.stringify(o) + '\n';
const usuario = (texto, extra = {}) => ({ type: 'user', cwd: '/tmp/x', message: { role: 'user', content: texto }, ...extra });

test('readSession: una conversación cuyo primer mensaje lleva una imagen (línea enorme) y sin título SÍ se lista', () => {
  const d = tmp('hopdeck-big-'); const f = path.join(d, 's1.jsonl');
  const imagen = 'A'.repeat(250 * 1024); // un JPEG en base64 de ~250 KB, como en un historial real
  fs.writeFileSync(f, linea({ type: 'mode' }) + linea({ type: 'attachment', pad: 'x'.repeat(2000) }) +
    linea(usuario([{ type: 'text', text: '[Image #1] actualmente la carga al ingresar se demora' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imagen } }])) +
    linea({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }));
  const s = hd.readSession(f);
  assert.ok(s, 'se lista (antes se descartaba: el primer mensaje caía fuera de los primeros 64 KB)');
  assert.match(s.title, /^\[Image #1\] actualmente la carga/);
  assert.equal(s.cwd, '/tmp/x');
});

test('readSession: lee hasta 4 MB de cabecera, y un archivo sin mensajes de usuario no se queda leyendo sin fin', () => {
  const d = tmp('hopdeck-cap-');
  const lejos = path.join(d, 'lejos.jsonl');
  fs.writeFileSync(lejos, Array.from({ length: 30 }, () => linea({ type: 'attachment', pad: 'x'.repeat(100 * 1024) })).join('') + linea(usuario('mensaje tras 3 MB de relleno')));
  assert.equal((hd.readSession(lejos) || {}).title, 'mensaje tras 3 MB de relleno', 'lo encuentra a ~3 MB');
  const vacio = path.join(d, 'vacio.jsonl');
  fs.writeFileSync(vacio, Array.from({ length: 60 }, () => linea({ type: 'attachment', pad: 'x'.repeat(100 * 1024) })).join('')); // ~6 MB, sin usuario
  const t = Date.now();
  assert.equal(hd.readSession(vacio), null, 'sin mensajes de usuario ni títulos: se descarta');
  assert.ok(Date.now() - t < 4000, 'y sin leer el archivo entero');
});

test('readSession: los caracteres de varios bytes no se cortan en el límite de un bloque de lectura', () => {
  const d = tmp('hopdeck-utf-'); const texto = 'ñandú 日本語 🙂 fin';
  for (let relleno = 131072 - 80; relleno <= 131072 - 20; relleno++) { // todas las alineaciones posibles respecto al bloque de 128 KB
    const f = path.join(d, `u${relleno}.jsonl`);
    const meta = JSON.stringify({ type: 'attachment', pad: '' }); const pad = 'x'.repeat(relleno - Buffer.byteLength(meta) - 1);
    fs.writeFileSync(f, JSON.stringify({ type: 'attachment', pad }) + '\n' + linea(usuario(texto)));
    assert.equal((hd.readSession(f) || {}).title, texto, `relleno ${relleno}`);
  }
});

test('caché: una caché de una versión anterior se ignora (el arreglo del lector llega a quien ya tenía caché)', () => {
  const d = tmp('hopdeck-cv-'); const f = path.join(d, 's.jsonl'); const cacheFile = path.join(d, 'cache.json');
  fs.writeFileSync(f, linea(usuario('hola mundo')));
  const st = fs.statSync(f);
  fs.writeFileSync(cacheFile, JSON.stringify({ v: 1, files: { [f]: { m: st.mtimeMs, z: st.size, d: null } } })); // la versión antigua guardó "sin título"
  const prev = process.env.HOPDECK_CACHE, mod = require.resolve('../lib/history.js');
  process.env.HOPDECK_CACHE = cacheFile; delete require.cache[mod];
  try { assert.equal((require(mod).readSession(f) || {}).title, 'hola mundo', 'ignora la caché v1 y vuelve a leer'); }
  finally { if (prev === undefined) delete process.env.HOPDECK_CACHE; else process.env.HOPDECK_CACHE = prev; delete require.cache[mod]; }
});

test('extractImages: cada imagen cuenta una vez aunque Claude la guarde también en líneas internas', async () => {
  const d = tmp('hopdeck-dup-'); const f = path.join(d, 's.jsonl'); const png = makePNG(2, 2, () => [9, 9, 9, 255]).toString('base64');
  const contenido = [{ type: 'text', text: '[Image #1] mira' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }];
  fs.writeFileSync(f, linea(usuario(contenido)) + linea({ type: 'api-request-blob', message: { role: 'user', content: contenido } }));
  const imgs = await hd.extractImages(f);
  assert.equal(imgs.length, 1, 'una sola, sin duplicado');
  assert.equal(imgs[0].n, 1);
  assert.ok(await hd.findImageByNumber(f, 1));
});

test('imageMarkerAt: encuentra la marca [Image #N] bajo el cursor con caracteres anchos delante y espacios no separables', async () => {
  const { Terminal } = require('@xterm/headless');
  const term = new Terminal({ cols: 60, rows: 6, allowProposedApi: true });
  await new Promise((r) => term.write('日本語 [Image #2] fin\r\n[Image #3] nbsp\r\nsin marca [Image] #4\r\n', r));
  assert.deepEqual(hd.imageMarkerAt(term, 0, 8), { n: 2, x: 7 }, 'tras tres caracteres de ancho 2, la marca empieza en la columna 7');
  assert.deepEqual(hd.imageMarkerAt(term, 0, 7), { n: 2, x: 7 }, 'primera celda');
  assert.deepEqual(hd.imageMarkerAt(term, 0, 16), { n: 2, x: 7 }, 'última celda');
  assert.equal(hd.imageMarkerAt(term, 0, 17), null, 'justo después');
  assert.equal(hd.imageMarkerAt(term, 0, 6), null, 'justo antes');
  assert.deepEqual(hd.imageMarkerAt(term, 1, 3), { n: 3, x: 0 }, 'con espacio no separable');
  assert.equal(hd.imageMarkerAt(term, 2, 12), null, 'texto parecido pero no es una marca');
  term.dispose();
});

test('shownSession: un chat nuevo sin enlazar solo toma una conversación creada después de abrirlo', async () => {
  const saved = { ...hd.S };
  try {
    const cwd = fx.cwds.alpha;
    // t0 en el futuro: ninguna conversación puede ser posterior, aunque otra prueba haya tocado la fecha de alguna hace un instante
    assert.equal(await hd.shownSession({ sid: null, cwd, t0: Date.now() + 3600e3 }), undefined, 'si no hay ninguna posterior, no inventa una (podría ser otra conversación con la misma numeración de imágenes)');
    const s = await hd.shownSession({ sid: null, cwd, t0: Date.now() - 10 * 3600e3 });
    assert.ok(s && s.id, 'con una conversación posterior a la apertura, la toma');
  } finally { Object.assign(hd.S, saved); }
});

// ───────────── comandos: una sola forma para cada uno; lo demás da error con sugerencia ─────────────
test('commandName / suggestCommand: solo cuenta la forma exacta, y las variantes y erratas sugieren el comando', () => {
  for (const [entrada, esperado] of [['shortcut', 'shortcut'], ['uninstall', 'uninstall'], ['UNINSTALL', 'uninstall'], ['doctor', 'doctor'], ['help', 'help']])
    assert.equal(hd.commandName(entrada), esperado, entrada);
  for (const no of ['install', '--uninstall', '--install', 'desinstalar', 'remove', 'version', 'unistall', '--model', '', undefined]) assert.equal(hd.commandName(no), null, `no es un comando: ${no}`);
  for (const [entrada, sugerido] of [['unistall', 'uninstall'], ['--unistall', 'uninstall'], ['--uninstall', 'uninstall'], ['desinstalar', 'uninstall'], ['remove', 'uninstall'], ['install', 'shortcut on'], ['instalar', 'shortcut on'], ['--install', 'shortcut on'], ['shortcu', 'shortcut'], ['doctr', 'doctor'], ['ayuda', 'help']])
    assert.equal(hd.suggestCommand(entrada), sugerido, entrada);
  assert.equal(hd.suggestCommand('xyzxyzxyz'), null, 'si no se parece a nada, no inventa');
  // las opciones de claude no pueden confundirse con un comando: se pasan tal cual
  for (const flag of ['--model', '--resume', '--continue', '-c', '-p', '--print', '--verbose', '--debug', '--add-dir', '--permission-mode', '--dangerously-skip-permissions', '--allowedTools', '--mcp-config', '--settings', '--append-system-prompt', '--ide', '--chrome', '--fork-session', '--session-id', '--output-format', '--max-turns'])
    assert.equal(hd.suggestCommand(flag), null, `opción de claude: ${flag}`);
});

// entorno aislado para ejecutar la línea de comandos real sin tocar tus perfiles, tus preferencias ni tu npm
const cli = () => {
  const cp = require('child_process'); const d = tmp('hopdeck-cli-');
  const perfil = path.join(d, 'perfil.sh'), cfg = path.join(d, 'cfg.json'), cache = path.join(d, 'cache.json');
  fs.writeFileSync(perfil, 'export A=1\n'); fs.writeFileSync(cfg, '{"pinned":["/x"]}'); fs.writeFileSync(cache, '{"v":2,"files":{}}');
  const env = { ...process.env, HOPDECK_CONFIG: cfg, HOPDECK_CACHE: cache, HOPDECK_PROFILES: perfil, HOPDECK_LANG: 'es', HOPDECK_NOPROMPT: '1', HOPDECK_NO_NPM: '1', NO_COLOR: '1' };
  const run = (...args) => cp.spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'hopdeck.js'), ...args], { env, encoding: 'utf8', timeout: 30000 });
  return { d, perfil, cfg, cache, env, run, conBloque: () => fs.readFileSync(perfil, 'utf8').includes(hd.MARK_A) };
};

test('línea de comandos: "theme light|dark|auto" guarda el tema; sin argumento lo muestra; otra forma da error', () => {
  const { cfg, run, env } = cli();
  const quiet = (...a) => require('child_process').spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'hopdeck.js'), ...a], { env: { ...env, HOPDECK_THEME: '' }, encoding: 'utf8', timeout: 30000 });
  let r = quiet('theme'); assert.equal(r.status, 0); assert.match(r.stdout, /Tema guardado: automático/);
  r = quiet('theme', 'light'); assert.equal(r.status, 0); assert.match(r.stdout, /Tema guardado: claro/); assert.match(r.stdout, /Se está usando: claro/);
  assert.equal(JSON.parse(fs.readFileSync(cfg, 'utf8')).theme, 'light', 'se guarda en las preferencias');
  assert.deepEqual(JSON.parse(fs.readFileSync(cfg, 'utf8')).pinned, ['/x'], 'sin tocar el resto');
  r = quiet('theme', 'dark'); assert.match(r.stdout, /Tema guardado: oscuro/); assert.equal(JSON.parse(fs.readFileSync(cfg, 'utf8')).theme, 'dark');
  r = quiet('theme', 'auto'); assert.match(r.stdout, /automático/); assert.equal(JSON.parse(fs.readFileSync(cfg, 'utf8')).theme, undefined, 'auto quita la elección');
  for (const mal of [['theme', 'rojo'], ['theme', 'light', 'dark']]) { r = run(...mal); assert.equal(r.status, 2, mal.join(' ')); assert.match(r.stderr, /Uso: hopdeck theme/); }
  r = run('tema'); assert.equal(r.status, 2); assert.ok(r.stderr.includes('¿Quisiste decir "theme"?'));
  // HOPDECK_THEME manda sobre lo guardado (se prueba con lib/style.js, que es quien decide)
  fs.writeFileSync(cfg, '{"theme":"light"}');
  const luz = (extra) => require('child_process').spawnSync(process.execPath, ['-e', "console.log(require('./lib/style').LIGHT)"], { cwd: path.join(__dirname, '..'), env: { ...env, HOPDECK_THEME: '', ...extra }, encoding: 'utf8' }).stdout.trim();
  assert.equal(luz({}), 'true', 'lo guardado se aplica'); assert.equal(luz({ HOPDECK_THEME: 'dark' }), 'false', 'la variable gana');
});

test('línea de comandos: "shortcut on|off" solo toca el atajo; cualquier otra forma da error con sugerencia y no hace nada', () => {
  const { perfil, cfg, run, conBloque } = cli();
  assert.equal(run('shortcut', 'on').status, 0); assert.ok(conBloque(), 'shortcut on instala el atajo');
  for (const [otra, sug] of [['--uninstall', 'uninstall'], ['desinstalar', 'uninstall'], ['remove', 'uninstall'], ['--unistall', 'uninstall'], ['unistall', 'uninstall'], ['install', 'shortcut on'], ['--install', 'shortcut on'], ['instalar', 'shortcut on']]) {
    const r = run(otra);
    assert.equal(r.status, 2, `${otra}: sale con error`);
    assert.match(r.stderr, new RegExp(`Comando desconocido: "${otra}"`), `${otra}: lo dice`);
    assert.ok(r.stderr.includes(`¿Quisiste decir "${sug}"?`), `${otra}: sugiere "${sug}"`);
    assert.ok(conBloque() && fs.existsSync(cfg), `${otra}: NO toca el perfil ni las preferencias`);
    assert.doesNotMatch(r.stdout, /Hopdeck|Claude/i, `${otra}: no abre ni lista nada`);
  }
  for (const mal of [['shortcut'], ['shortcut', 'encender'], ['shortcut', 'on', 'extra']]) { const r = run(...mal); assert.equal(r.status, 2, mal.join(' ')); assert.match(r.stderr, /Uso: hopdeck shortcut on/); }
  assert.equal(run('shortcut', 'off').status, 0); assert.ok(!conBloque(), 'shortcut off lo quita');
  assert.ok(fs.existsSync(cfg), 'y no borra nada más');
  assert.ok(fs.readFileSync(perfil, 'utf8').startsWith('export A=1'), 'conserva el resto del perfil');

  const flag = run('--model', 'opus'); // lo que empieza por - y no se parece a un comando sigue pasando a claude (sin terminal imprime la lista)
  assert.equal(flag.status, 0, 'las opciones de claude no se rechazan'); assert.doesNotMatch(flag.stderr, /desconocido/);
  assert.match(run('--version').stdout, /^\d+\.\d+\.\d+/, '--version sigue funcionando');
  assert.equal(run('help').status, 0, 'help sigue funcionando');
});

test('hopdeck uninstall: desinstala de verdad (atajo, preferencias y caché) y sin terminal exige --yes', () => {
  const { perfil, cfg, cache, run, conBloque } = cli();
  run('shortcut', 'on'); assert.ok(conBloque());

  const sinYes = run('uninstall');
  assert.equal(sinYes.status, 2, 'sin terminal no puede preguntar');
  assert.match(sinYes.stderr, /--yes/);
  assert.ok(conBloque() && fs.existsSync(cfg) && fs.existsSync(cache), 'y no borra nada');
  const rara = run('uninstall', '--todo'); assert.equal(rara.status, 2, 'un argumento desconocido tampoco'); assert.match(rara.stderr, /desconocido/);

  const r = run('uninstall', '--yes');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Atajo quitado/); assert.match(r.stdout, /Preferencias y caché borradas/); assert.match(r.stdout, /npm uninstall -g hopdeck/);
  assert.ok(!conBloque(), 'quita el atajo'); assert.ok(!fs.existsSync(cfg) && !fs.existsSync(cache), 'y borra las preferencias y la caché');
  assert.ok(fs.readFileSync(perfil, 'utf8').startsWith('export A=1'), 'sin tocar el resto del perfil');
  assert.ok(fs.existsSync(perfil + '.hopdeck-backup'), 'la copia de seguridad del perfil se conserva');
});

// ───────────── Sixel: imágenes reales en el terminal ─────────────
const sixel = require('../lib/sixel.js');
/** Decodificador Sixel mínimo, independiente del codificador, para comprobarlo leyendo su salida de vuelta. */
function decodeSixel(str) {
  const head = str.match(/^\x1bP[0-9;]*q"(\d+);(\d+);(\d+);(\d+)/); assert.ok(head, 'empieza con DCS y atributos del ráster');
  assert.ok(str.endsWith('\x1b\\'), 'termina con ST');
  const w = +head[3], h = +head[4], body = str.slice(head[0].length, -2);
  const pix = new Array(w * h).fill(null), pal = []; let cur = 0, x = 0, band = 0;
  const paint = (ch, n = 1) => { const m = ch.charCodeAt(0) - 63; for (let k = 0; k < n; k++, x++) for (let bit = 0; bit < 6; bit++) if (m & (1 << bit)) { const y = band * 6 + bit; if (y < h && x < w) pix[y * w + x] = pal[cur]; } };
  for (let i = 0; i < body.length;) {
    const c = body[i];
    if (c === '#') { const m = body.slice(i).match(/^#(\d+)(?:;2;(\d+);(\d+);(\d+))?/); if (m[2] !== undefined) pal[+m[1]] = [m[2], m[3], m[4]].map((v) => Math.round((+v * 255) / 100)); else cur = +m[1]; i += m[0].length; }
    else if (c === '!') { const m = body.slice(i).match(/^!(\d+)(.)/); paint(m[2], +m[1]); i += m[0].length; }
    else if (c === '$') { x = 0; i++; }
    else if (c === '-') { x = 0; band++; i++; }
    else { paint(c); i++; }
  }
  return { w, h, pix, palette: pal };
}

test('encodeSixel: una imagen de pocos colores se reproduce fielmente (con alto que no es múltiplo de 6)', () => {
  const w = 13, h = 14, colores = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255], [20, 20, 30]];
  const rgb = new Uint8Array(w * h * 3), esperado = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = colores[(Math.floor(x / 3) + Math.floor(y / 4)) % colores.length]; esperado.push(c); rgb.set(c, (y * w + x) * 3); }
  const s = sixel.encodeSixel(rgb, w, h), d = decodeSixel(s);
  assert.deepEqual([d.w, d.h], [w, h]);
  assert.ok(d.palette.length <= colores.length, 'paleta exacta, sin colores de más');
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) assert.ok(d.pix[i] && Math.abs(d.pix[i][c] - esperado[i][c]) <= 3, `píxel ${i} canal ${c}`); // el sixel guarda los colores en 0-100
});

test('encodeSixel: un degradado con miles de colores se reduce a 256 y queda parecido; repeticiones comprimidas', () => {
  const w = 64, h = 48, rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgb.set([x * 4, y * 5, (x + y) * 2], (y * w + x) * 3);
  const d = decodeSixel(sixel.encodeSixel(rgb, w, h));
  assert.ok(d.palette.length > 1 && d.palette.length <= 256, `paleta de ${d.palette.length} colores`);
  let err = 0, n = 0;
  for (let i = 0; i < w * h; i++) { assert.ok(d.pix[i], `el píxel ${i} se dibuja`); for (let c = 0; c < 3; c++) { err += Math.abs(d.pix[i][c] - rgb[i * 3 + c]); n++; } }
  assert.ok(err / n < 14, `error medio por canal ${(err / n).toFixed(1)} (de 255)`);
  const plano = new Uint8Array(20 * 6 * 3).fill(200), s = sixel.encodeSixel(plano, 20, 6);
  assert.ok(s.includes('!20~'), 'una fila entera del mismo color se escribe como !20~');
});

test('encodeSixel: una imagen de tamaño real se codifica en poco tiempo y con un tamaño razonable', () => {
  const w = 576, h = 288, rgb = new Uint8Array(w * h * 3); // el mayor cuadro del hover (36×9 celdas) con celdas de 16×32 píxeles
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgb.set([(x * 7 + y * 3) & 255, (x * 3) & 255, (y * 5) & 255], (y * w + x) * 3);
  const t = Date.now(), s = sixel.encodeSixel(rgb, w, h);
  assert.ok(Date.now() - t < 2000, `tardó ${Date.now() - t} ms`);
  assert.ok(s.length < 3e6, `${(s.length / 1e6).toFixed(1)} MB`);
  assert.equal(decodeSixel(s).h, h);
});

test('parseTermReplies: lee la respuesta del terminal (¿admite Sixel? ¿tamaño de celda?) y la quita de la entrada', () => {
  const st = { sixelDetected: false, cell: { w: 10, h: 20 } };
  assert.equal(hd.parseTermReplies('\x1b[?62;4;22c\x1b[6;19;9t', st), '', 'solo había respuestas del terminal');
  assert.equal(st.sixelDetected, true, 'el atributo 4 es Sixel'); assert.deepEqual(st.cell, { w: 9, h: 19 }, 'celda de 9×19 píxeles');
  assert.equal(hd.parseTermReplies('ab\x1b[?1;2cde', st), 'abde', 'el resto de la entrada se conserva');
  assert.equal(st.sixelDetected, false, 'sin el 4 no hay Sixel');
  hd.parseTermReplies('\x1b[?61;14;4;7c', st); assert.equal(st.sixelDetected, true, '14 no se confunde con 4, y el 4 se encuentra entre otros');
  hd.parseTermReplies('\x1b[?61;14;7c', st); assert.equal(st.sixelDetected, false, 'ni el 14 ni el 7 son el 4');
  const antes = { ...st.cell };
  hd.parseTermReplies('\x1b[6;0;0t', st); assert.deepEqual(st.cell, antes, 'una celda de 0×0 (terminal que no sabe) se ignora');
  hd.parseTermReplies('\x1b[6;4000;9t', st); assert.deepEqual(st.cell, antes, 'una medida absurda también');
  assert.equal(hd.parseTermReplies('\x1b[A\x1b[B hola', st), '\x1b[A\x1b[B hola', 'las teclas normales no se tocan');
});

test('hl: resalta las coincidencias de la búsqueda sin cambiar el texto', () => {
  const st = 'ESTILO';
  const j = (segs) => segs.map(([t]) => t).join('');
  const a = hd.hl('Corregir error en el checkout', 'err', st);
  assert.equal(j(a), 'Corregir error en el checkout', 'el texto no cambia');
  assert.deepEqual(a.map(([t]) => t), ['Corregir ', 'err', 'or en el checkout'], 'se trocea en antes · coincidencia · después');
  assert.notEqual(a[1][1], st, 'la coincidencia lleva otro estilo'); assert.equal(a[0][1], st, 'el resto conserva el estilo');
  assert.deepEqual(hd.hl('ERROR error', 'error', st).filter(([, s2]) => s2 !== st).map(([t]) => t), ['ERROR', 'error'], 'sin distinguir mayúsculas y con varias coincidencias');
  assert.deepEqual(hd.hl('Hola', '', st), [['Hola', st]], 'sin búsqueda no se resalta');
  assert.deepEqual(hd.hl('Hola', 'xyz', st), [['Hola', st]], 'sin coincidencias, un solo trozo');
  assert.equal(j(hd.hl('İstanbul', 'stan', st)), 'İstanbul', 'letras que cambian de largo al pasar a minúsculas no rompen el texto');
});

// ───────────── panel de git (lib/git.js) ─────────────
const gitlib = require('../lib/git');
const cpSync = require('child_process');
const gitOk = (() => { try { return cpSync.spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0; } catch { return false; } })();

test('git: parseStatus lee rama, remoto, adelanto/retraso y archivos', () => {
  const s = gitlib.parseStatus('## feat/x...origin/feat/x [ahead 2, behind 1]\n M src/a.js\nA  b.txt\n?? nuevo.md\n D viejo.js\n');
  assert.equal(s.branch, 'feat/x'); assert.equal(s.upstream, 'origin/feat/x'); assert.equal(s.ahead, 2); assert.equal(s.behind, 1);
  assert.deepEqual(s.files.map((f) => [f.x, f.y, f.path]), [[' ', 'M', 'src/a.js'], ['A', ' ', 'b.txt'], ['?', '?', 'nuevo.md'], [' ', 'D', 'viejo.js']]);
  assert.equal(gitlib.parseStatus('## main\n').branch, 'main'); assert.equal(gitlib.parseStatus('## main\n').files.length, 0);
  assert.equal(gitlib.parseStatus('## No commits yet on main\n').branch, 'main');
  const d = gitlib.parseStatus('## HEAD (no branch)\n'); assert.equal(d.detached, true);
  assert.equal(gitlib.parseStatus('## main...origin/main\n').upstream, 'origin/main');
});

test('git: parseActivity reconoce cambios de rama, ramas creadas y merges, la más reciente primero', () => {
  const out = [
    'feat-x@{1000}\tcommit: dos', 'feat-x@{1000}\tbranch: Created from HEAD', 'main@{900}\tcommit (initial): uno',
    'other@{1500}\tbranch: Created from main', 'HEAD@{2000}\tcheckout: moving from feat-x to main', 'HEAD@{1000}\tcheckout: moving from main to feat-x',
    'HEAD@{2500}\tmerge feat-x: Fast-forward', 'HEAD@{1000}\tcommit: dos',
  ].join('\n');
  const a = gitlib.parseActivity(out);
  assert.deepEqual(a.map((e) => e.k), ['merge', 'switch', 'create', 'create', 'switch'], 'solo actividad de ramas, ordenada por fecha (a igual segundo, el orden de git)');
  assert.deepEqual(a[1], { k: 'switch', from: 'feat-x', to: 'main', t: 2000 });
  assert.deepEqual(a[2], { k: 'create', name: 'other', from: 'main', t: 1500 });
  assert.equal(a[0].what, 'feat-x');
  assert.deepEqual(gitlib.parseActivity('basura\n\nHEAD@{x}\ty'), [], 'líneas raras se ignoran');
});

test('git: parseBranches', () => {
  assert.deepEqual(gitlib.parseBranches('*\tmain\t200\n \tfeat\t100\n'), [{ cur: true, name: 'main', t: 200 }, { cur: false, name: 'feat', t: 100 }]);
});

test('git: readGit con un repositorio real (ramas, cambios y actividad) y con una carpeta sin git', { skip: !gitOk && 'git no instalado' }, async () => {
  const repo = tmp('hopdeck-git-');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_SYSTEM: process.platform === 'win32' ? 'NUL' : '/dev/null' };
  const g = (...a) => cpSync.execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...a], { cwd: repo, env, stdio: 'ignore' });
  g('init', '-q'); g('commit', '-q', '--allow-empty', '-m', 'uno'); g('checkout', '-q', '-b', 'feat-x'); g('checkout', '-q', 'main'); g('checkout', '-q', 'feat-x');
  fs.writeFileSync(path.join(repo, 'nuevo.txt'), 'x');
  const d = await gitlib.readGit(repo);
  assert.equal(d.ok, true); assert.equal(d.status.branch, 'feat-x');
  assert.deepEqual(d.status.files.map((f) => f.path), ['nuevo.txt'], 'archivo sin seguimiento');
  assert.ok(d.branches.some((b) => b.name === 'main') && d.branches.some((b) => b.name === 'feat-x' && b.cur), 'ramas, con la actual marcada');
  const kinds = d.activity.map((e) => e.k + ':' + (e.to || e.name || ''));
  assert.ok(kinds.includes('create:feat-x'), 'rama creada: ' + kinds);
  assert.ok(kinds.includes('switch:main') && kinds.includes('switch:feat-x'), 'cambios de rama: ' + kinds);
  const sin = await gitlib.readGit(tmp('hopdeck-nogit-'));
  assert.equal(sin.ok, false); assert.equal(sin.repo, false, 'una carpeta sin git no es un error de lectura');
  const noexiste = await gitlib.readGit(path.join(repo, 'no-existe'));
  assert.equal(noexiste.ok, false);
});

// ───────────── búsqueda dentro del contenido (lib/deepsearch.js) ─────────────
const deep = require('../lib/deepsearch');
const mkfile = (name, content) => { const d = tmp('hopdeck-deep-'); const f = path.join(d, name); fs.writeFileSync(f, content); return f; };

test('deepsearch: busca sin distinguir mayúsculas, con acentos y a caballo entre dos bloques de lectura', () => {
  const a = mkfile('a.jsonl', '{"x":"Hola MUNDO"}\n');
  assert.equal(deep.fileHasSync(a, 'mundo'), true, 'mayúsculas del archivo, minúsculas de la búsqueda');
  assert.equal(deep.fileHasSync(a, 'HOLA m'), true, 'y al revés');
  assert.equal(deep.fileHasSync(a, 'zzz'), false);
  const n = mkfile('n.jsonl', '{"x":"La CATEGORÍA nueva"}\n');
  assert.equal(deep.fileHasSync(n, 'categoría'), true, 'letras con acento, con otra capitalización');
  assert.equal(deep.fileHasSync(n, 'categoria'), false, 'sin acento no es lo mismo');
  // la coincidencia empieza justo antes del límite de 1 MB del bloque y termina después
  const pad = 'x'.repeat(1024 * 1024 - 5);
  const b = mkfile('b.jsonl', pad + 'AguJa-Clave' + 'y'.repeat(1000));
  assert.equal(deep.fileHasSync(b, 'aguja-clave'), true, 'coincidencia entre dos bloques');
  assert.equal(deep.fileHasSync(b, 'aguja-claveX'), false);
  const c = mkfile('c.jsonl', 'x'.repeat(1024 * 1024 - 2) + 'ñandú' + 'z');
  assert.equal(deep.fileHasSync(c, 'ñandú'), true, 'un carácter de varios bytes cortado entre bloques no se pierde');
  assert.equal(deep.fileHasSync(path.join(tmp('hopdeck-deep-'), 'no-existe.jsonl'), 'a'), false, 'archivo inexistente');
  assert.equal(deep.fileHasSync(a, ''), false, 'búsqueda vacía');
  assert.equal(deep.fileHasSync(mkfile('r.jsonl', 'a.b*c'), 'a.b*c'), true, 'los símbolos de las expresiones regulares son texto normal');
  assert.equal(deep.fileHasSync(mkfile('r2.jsonl', 'aXb'), 'a.b'), false, 'el punto no es un comodín');
});

test('deepsearch: varios archivos en paralelo, aciertos en directo y cancelación', async () => {
  const files = [];
  for (let i = 0; i < 12; i++) files.push(mkfile(`s${i}.jsonl`, `{"t":"conversación ${i}"}\n` + (i % 4 === 0 ? '{"t":"Palabra-Secreta"}\n' : '') + 'x'.repeat(i * 1000)));
  const hits = [];
  const job = deep.deepSearch(files, 'palabra-secreta', (f) => hits.push(f));
  await job.done;
  assert.deepEqual(hits.map((f) => path.basename(f)).sort(), ['s0.jsonl', 's4.jsonl', 's8.jsonl'], 'solo los archivos que la contienen');
  const none = [], j2 = deep.deepSearch(files, 'no-aparece-nunca', (f) => none.push(f)); await j2.done; assert.equal(none.length, 0);
  await deep.deepSearch([], 'x', () => assert.fail('sin archivos no hay aciertos')).done;
  const late = [], j3 = deep.deepSearch(files, 'palabra-secreta', (f) => late.push(f)); j3.cancel(); await j3.done;
  assert.ok(late.length <= 3, 'tras cancelar no llegan más aciertos');
});
