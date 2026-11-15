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
