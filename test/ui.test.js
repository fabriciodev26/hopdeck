'use strict';
// Pruebas de interfaz en un PTY real: selector de carpetas, cajas de texto con cursor, hover, rueda del ratón y chats nuevos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmp, makeFixture, makePNG, launchHub } = require('./helpers');

let available = true;
try { require('@lydell/node-pty'); require('@xterm/headless'); } catch { available = false; }
const opts = { skip: !available && 'node-pty/xterm no disponibles', timeout: 90000 };

const alpha = (extra = {}) => ({ name: 'alpha', sessions: [
  { id: 'e1', first: 'primer mensaje de alfa', ai: 'Sesión uno', ageH: 1, ...extra },
  { id: 'e2', first: 'otro mensaje', ai: 'Sesión dos', ageH: 2 },
] });

test('selector de carpetas: navegar, ocultas, filtro, cursor al escribir y crear carpeta nueva', opts, async () => {
  const root = tmp('hopdeck-ui-fb-'); const home = path.join(root, 'home');
  for (const d of ['Documentos', 'Proyectos/uno', 'Proyectos/dos', '.oculta']) fs.mkdirSync(path.join(home, d), { recursive: true });
  const fx = makeFixture(root, [alpha()]);
  const h = launchHub({ root, fx, home, cwd: fx.cwds.alpha });
  try {
    await h.waitFor(/alpha/, 'lista de proyectos');
    h.write('o');
    await h.waitFor(/Elegir carpeta/, 'selector abierto');
    await h.waitFor(/Documentos/, 'carpetas de ~'); assert.match(h.screen(), /Proyectos/);
    assert.doesNotMatch(h.screen(), /\.oculta/, 'las carpetas ocultas no se muestran');
    h.write('.'); await h.waitFor(/\.oculta/, 'con "." se muestran las ocultas');
    h.write('.'); await h.waitGone(/\.oculta/, 'otro "." las oculta');

    h.write('/'); h.write('proy');
    await h.waitFor(/ \/ proy▏/, 'caja de filtro');
    await h.waitGone(/Documentos/, 'el filtro deja solo lo que coincide');
    h.write('\r');                                    // termina de escribir el filtro
    h.write('\r');                                    // entra a Proyectos
    await h.waitFor(/~\\Proyectos|~\/Proyectos/, 'ruta actual: ~/Proyectos');
    await h.waitFor(/uno/, 'subcarpetas'); assert.match(h.screen(), /dos/);

    h.write('n'); h.write('abde');                    // cursor: ←← y escribir en medio
    await h.waitFor(/abde▏/, 'texto escrito');
    h.write('\x1b[D\x1b[D'); h.write('c');
    await h.waitFor(/abc▏de/, 'las flechas mueven el cursor al escribir el nombre');
    for (let i = 0; i < 5; i++) h.write('\x7f');
    h.write('\x1b[F'); for (let i = 0; i < 5; i++) h.write('\x7f');
    h.write('nuevo\r');
    await h.waitFor(/otra vez para crear/, 'pide confirmar antes de crear');
    assert.ok(!fs.existsSync(path.join(home, 'Proyectos', 'nuevo')), 'todavía no se creó');
    h.write('\r');
    await h.waitFor(/FAKE CLAUDE/, 'chat abierto en la carpeta nueva');
    assert.ok(fs.existsSync(path.join(home, 'Proyectos', 'nuevo')), 'la carpeta se creó');
    await h.waitFor(/nuevo › /, 'cabecera con el proyecto nuevo');

    // el chat nuevo (aún sin historial) aparece en la lista, bajo su proyecto
    h.write('\x1bOP');
    await h.waitFor(/● Nueva conversac/, 'el chat vivo aparece en la lista');
    assert.match(h.screen(), /nuevo/);
    h.write('q');
  } finally { await h.close(); }
});

test('buscadores con cursor: / y Ctrl+P aceptan flechas, Inicio/Fin y Supr', opts, async () => {
  const root = tmp('hopdeck-ui-search-');
  const fx = makeFixture(root, [alpha(), { name: 'beta', sessions: [{ id: 'b1', first: 'hola beta', ai: 'Cosa beta', ageH: 3 }] }]);
  const h = launchHub({ root, fx, cwd: fx.cwds.alpha });
  try {
    await h.waitFor(/alpha/, 'lista');
    h.write('/'); h.write('apha');
    h.write('\x1b[D\x1b[D\x1b[D'); h.write('l');      // a|pha → al|pha
    await h.waitFor(/⌕ al▏pha/, 'cursor en medio del texto de búsqueda (arriba, en el lugar del título)');
    assert.doesNotMatch(h.screen(), /beta/, 'el filtro "alpha" oculta beta');
    h.write('\x1b'); await h.waitGone(/⌕ al/, 'Esc limpia la búsqueda');

    h.write('\x10');                                  // Ctrl+P
    await h.waitFor(/saltar a cualquier conversación/, 'salto rápido');
    h.write('xyz'); h.write('\x1b[H'); h.write('b');
    await h.waitFor(/⌕ ▏?b▏?xyz|⌕ b▏xyz/, 'Inicio mueve el cursor al principio');
    h.write('\x1b[3~'); h.write('\x1b[3~'); h.write('\x1b[3~');
    await h.waitFor(/⌕ b▏ /, 'Supr borra hacia la derecha');
    h.write('\x1b[15~');                              // F5 en medio: una tecla desconocida no mete basura
    assert.doesNotMatch(h.screen(), /\[15~/);
    h.write('\x1b');
  } finally { await h.close(); }
});

test('hover: pasar el cursor por la lista previsualiza la conversación y por [Image #N] muestra la imagen', opts, async () => {
  const root = tmp('hopdeck-ui-hover-');
  const png = makePNG(16, 8, (x, y) => [x * 15, y * 30, 200, 255]).toString('base64');
  const fx = makeFixture(root, [alpha({ first: '[Image #1] mira esta imagen', image: png })]);
  const h = launchHub({ root, fx, cwd: fx.cwds.alpha, env: { FAKE_PRINT: 'aquí va [Image #1] y [Image #7]' } });
  try {
    await h.waitFor(/Sesión dos/, 'lista con las sesiones');
    const dos = h.find('Sesión dos'), uno = h.find('Sesión uno');
    h.mouse(35, 5, dos.y);
    await h.waitFor(/otro mensaje/, 'hover sobre "Sesión dos" → vista previa');
    h.mouse(35, 5, uno.y);
    await h.waitFor(/mira esta imagen/, 'hover sobre "Sesión uno" → su vista previa');
    assert.doesNotMatch(h.screen(), /otro mensaje/);

    h.mouse(0, 5, uno.y); h.mouse(0, 5, uno.y, 'm');  // clic: abre el chat
    await h.waitFor(/FAKE CLAUDE/, 'chat abierto');
    await h.waitFor(/\[Image #1\] y/, 'texto con la marca de imagen en el chat');
    const m1 = h.find('[Image #1]'); assert.ok(m1);
    h.mouse(35, m1.x + 3, m1.y);
    await h.waitFor(/╭─ \[Image #1\] ─*╮/, 'hover sobre [Image #1] abre un cuadro con la imagen');
    await h.waitFor(/clic: abrir en grande/, 'el cuadro avisa de que un clic la abre en grande');
    await h.waitFor(/▀/, 'la imagen se dibuja con medios bloques (primero el cuadro muestra un marcador mientras se decodifica)');
    assert.match(h.screen(), /FAKE CLAUDE/, 'el cuadro es flotante: el chat sigue visible alrededor');
    assert.match(h.screen(), /aquí va \[Image #1\]/, 'la línea de la marca no se tapa');
    const caja = h.lines().filter((l) => /[╭│╰]/.test(l.slice(37)));
    assert.ok(caja.length >= 3 && caja.length <= 20, 'el cuadro es pequeño (no ocupa todo el panel)');
    h.mouse(35, 3, 5);                                // el cursor sale de la marca
    await h.waitGone(/╭─ \[Image #1\]/, 'el cuadro desaparece al apartar el cursor');
    await h.waitFor(/FAKE CLAUDE/, 'vuelve el chat');

    const m7 = h.find('[Image #7]'); assert.ok(m7);
    h.mouse(35, m7.x + 3, m7.y);                      // una imagen que no está en el historial
    await h.waitFor(/no está en el historial/, 'aviso para una imagen que no existe aún');
    h.write('q');
  } finally { await h.close(); }
});

for (const [mode, wheelUp, wheelDown] of [['mouse', 'WHEEL-UP', 'WHEEL-DOWN'], ['alt', 'ARROW-UP', 'ARROW-DOWN']]) {
  // ConPTY (Windows) no deja pasar los avisos de "captura de ratón" (DECSET 1000) del hijo, así que ese modo solo se prueba en Linux/macOS.
  const skip = opts.skip || (mode === 'mouse' && process.platform === 'win32' && 'ConPTY filtra DECSET 1000');
  test(`rueda del ratón sobre el chat: Claude en modo "${mode}" la recibe`, { ...opts, skip }, async () => {
    const root = tmp('hopdeck-ui-wheel-');
    const fx = makeFixture(root, [alpha()]);
    const h = launchHub({ root, fx, cwd: fx.cwds.alpha, env: { FAKE_MODE: mode } });
    try {
      await h.waitFor(/Sesión dos/, 'lista');
      h.write('\x10'); await h.waitFor(/⌕/, 'salto rápido'); h.write('dos'); await h.waitFor(/Sesión dos/, 'resultado'); h.write('\r');
      await h.waitFor(mode === 'alt' ? /ALT SCREEN/ : /FAKE CLAUDE/, 'chat abierto');
      await h.sleep(300);
      h.mouse(64, 70, 10); await h.waitFor(new RegExp(wheelUp), 'rueda arriba llega al chat');
      h.mouse(65, 70, 10); await h.waitFor(new RegExp(wheelDown), 'rueda abajo llega al chat');
      h.write('\x1bOP'); await h.sleep(200);          // F1 y salir
      h.write('c');
    } finally { await h.close(); }
  });
}

test('scroll del historial del chat: la rueda lo recorre y la barra muestra la posición', opts, async () => {
  const root = tmp('hopdeck-ui-scroll-');
  const fx = makeFixture(root, [alpha()]);
  const lines = Array.from({ length: 80 }, (_, i) => `linea-${String(i).padStart(2, '0')}`).join('\\r\\n');
  const h = launchHub({ root, fx, cwd: fx.cwds.alpha, env: { FAKE_PRINT: lines.replace(/\\r\\n/g, '\r\n') } });
  try {
    await h.waitFor(/Sesión dos/, 'lista');
    h.write('\x10'); await h.waitFor(/⌕/, 'salto rápido'); h.write('dos'); await h.waitFor(/Sesión dos/, 'resultado'); h.write('\r');
    await h.waitFor(/linea-79/, 'el chat llegó al final');
    for (let i = 0; i < 4; i++) { h.mouse(64, 70, 10); await h.sleep(60); }
    await h.waitFor(/↑ \d+ líneas \(\d+%\)/, 'indicador de posición al hacer scroll');
    h.write('\x1b[F');                                // End: vuelve al final
    await h.waitGone(/↑ \d+ líneas/, 'End vuelve al final');
    h.write('\x1bOP'); await h.sleep(200); h.write('c');
  } finally { await h.close(); }
});

test('primer arranque: pregunta si `claude` debe abrir Hopdeck, recuerda "No" y no toca el perfil', opts, async () => {
  const root = tmp('hopdeck-ui-offer-'); const fx = makeFixture(root, [alpha()]);
  const cfgFile = path.join(root, 'cfg.json');
  // HOPDECK_PROFILES fija un perfil de shell de prueba: así la prueba no depende de si TU perfil ya tiene el atajo instalado
  const h = launchHub({ root, fx, cwd: fx.cwds.alpha, env: { HOPDECK_NOPROMPT: '', HOPDECK_PROFILES: path.join(root, 'perfil-de-prueba.sh') } });
  try {
    await h.waitFor(/abrir Hopdeck escribiendo claude/, 'pregunta del primer arranque', 40000);
    assert.match(h.screen(), /\[Enter\] Sí/, 'muestra las opciones');
    assert.match(h.screen(), /copia de seguridad/, 'avisa de la copia de seguridad');
    assert.match(h.screen(), /Hopdeck se abre igualmente/, 'aclara que responder que no no impide abrir Hopdeck');
    h.write('n');
    await h.waitFor(/Sesión dos/, 'después de responder se abre la lista');
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    assert.equal(cfg.shortcutAsked, true, 'queda guardado que ya se preguntó');
    h.write('q');
    // al salir se ve la pantalla normal de la terminal: la pregunta ya no debe seguir escrita (parecía pendiente) y hay un resumen de una línea
    await h.waitFor(/Atajo no instalado/, 'resumen de la respuesta en la pantalla normal', 15000);
    assert.doesNotMatch(h.screen(), /¿Quieres poder abrir|\[Enter\] Sí/, 'la pregunta se borró de la pantalla');
    assert.ok(!fs.existsSync(path.join(root, 'perfil-de-prueba.sh')), 'responder que no no escribe en ningún perfil');
  } finally { await h.close(); }
});

// ───────────── modo tmux: el ratón de la lista ─────────────
const cp = require('child_process');
const tmuxOk = (() => { try { return cp.spawnSync('tmux', ['-V'], { stdio: 'ignore' }).status === 0; } catch { return false; } })();
test('modo tmux: la rueda mueve la lista y un clic abre la conversación', { ...opts, skip: opts.skip || (process.platform === 'win32' && 'tmux no existe en Windows') || (!tmuxOk && 'tmux no está instalado') }, async () => {
  const root = tmp('hopdeck-ui-tmux-'); const fx = makeFixture(root, [alpha()]);
  // sockets de tmux aislados (no tocan una sesión tuya abierta) y en una ruta corta: en macOS el socket admite ~104 caracteres
  const tmuxDir = fs.mkdtempSync(path.join('/tmp', 'hdt-'));
  const h = launchHub({ root, fx, cwd: fx.cwds.alpha, env: { HOPDECK_EMBED: '', HOPDECK_TMUX: '1', TMUX_TMPDIR: tmuxDir } });
  const marked = () => (h.lines().find((l) => l.includes('▌')) || '').slice(0, 40);
  try {
    await h.waitFor(/Sesión dos/, 'la lista en modo tmux', 40000);
    assert.match(marked(), /alpha/, 'al empezar está marcado el proyecto');
    const dos = h.find('Sesión dos'), uno = h.find('Sesión uno');
    h.mouse(65, 6, dos.y);                            // rueda abajo sobre la lista
    for (let i = 0; i < 100 && !/Sesión dos/.test(marked()); i++) await h.sleep(50);
    assert.match(marked(), /Sesión dos/, 'la rueda baja la selección tres filas');
    h.mouse(0, 6, uno.y); h.mouse(0, 6, uno.y, 'm');  // clic en "Sesión uno"
    await h.waitFor(/FAKE CLAUDE/, 'el clic abre la conversación en el panel derecho', 20000);
  } finally {
    cp.spawnSync('tmux', ['-L', 'hopdeck', 'kill-server'], { stdio: 'ignore', env: { ...process.env, TMUX_TMPDIR: tmuxDir } });
    await h.close();
    fs.rmSync(tmuxDir, { recursive: true, force: true });
  }
});

// ───────────── desinstalar: la pregunta en una terminal real ─────────────
test('hopdeck uninstall en una terminal: pregunta, Enter cancela sin tocar nada y "s" desinstala', opts, async () => {
  const ptyMod = require('@lydell/node-pty');
  const root = tmp('hopdeck-ui-un-'); const perfil = path.join(root, 'perfil.sh'), cfg = path.join(root, 'cfg.json'), cache = path.join(root, 'cache.json');
  const crear = () => { fs.writeFileSync(perfil, 'export A=1\n# >>> hopdeck >>>\nclaude() { :; }\n# <<< hopdeck <<<\n'); fs.writeFileSync(cfg, '{"pinned":["/x"]}'); fs.writeFileSync(cache, '{"v":2,"files":{}}'); };
  const env = { ...process.env, HOPDECK_CONFIG: cfg, HOPDECK_CACHE: cache, HOPDECK_PROFILES: perfil, HOPDECK_LANG: 'es', HOPDECK_NOPROMPT: '1', HOPDECK_NO_NPM: '1', COLORTERM: 'truecolor' };
  const strip = (x) => x.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
  const ejecutar = (respuesta) => new Promise((resolve) => {
    const p = ptyMod.spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'hopdeck.js'), 'uninstall'], { name: 'xterm-256color', cols: 110, rows: 30, cwd: root, env });
    let out = '', enviada = false;
    p.onData((d) => { out += d; if (!enviada && /\[s\] Sí, desinstalar/.test(strip(out))) { enviada = true; setTimeout(() => { try { p.write(respuesta); } catch { /* */ } }, 100); } });
    p.onExit(() => resolve(strip(out)));
    setTimeout(() => { try { p.kill(); } catch { /* */ } resolve('TIEMPO AGOTADO\n' + strip(out)); }, 25000);
  });

  crear();
  const cancelado = await ejecutar('\r');                         // Enter = no
  assert.match(cancelado, /¿Desinstalar Hopdeck por completo\?/, 'hace la pregunta');
  assert.match(cancelado, /Se quitará el atajo/, 'explica qué se quita');
  assert.match(cancelado, /Cancelado: no se ha quitado nada/, 'Enter cancela');
  assert.ok(fs.readFileSync(perfil, 'utf8').includes('>>> hopdeck >>>') && fs.existsSync(cfg) && fs.existsSync(cache), 'y no toca nada');

  const hecho = await ejecutar('s');                              // s = sí
  assert.match(hecho, /Atajo quitado/); assert.match(hecho, /Preferencias y caché borradas/); assert.match(hecho, /Hopdeck se ha desinstalado/);
  assert.ok(!fs.readFileSync(perfil, 'utf8').includes('>>> hopdeck >>>'), 'quita el atajo');
  assert.ok(fs.readFileSync(perfil, 'utf8').startsWith('export A=1'), 'sin tocar el resto del perfil');
  assert.ok(!fs.existsSync(cfg) && !fs.existsSync(cache), 'y borra las preferencias y la caché');
});

// ───────────── clic en [Image #N]: abrir la imagen en grande ─────────────
test('clic en [Image #N] abre la imagen en el visor; arrastrar o hacer clic en otro texto no abre nada', opts, async () => {
  const root = tmp('hopdeck-ui-click-'); const log = path.join(root, 'abiertos.log');
  const png = makePNG(16, 8, (x, y) => [x * 15, y * 30, 200, 255]).toString('base64');
  const fx = makeFixture(root, [alpha({ first: '[Image #1] mira esta imagen', image: png })]);
  const h = launchHub({ root, fx, cwd: fx.cwds.alpha, env: { FAKE_PRINT: 'aquí va [Image #1] y fin', HOPDECK_OPEN_LOG: log } });
  const abiertos = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
  try {
    await h.waitFor(/Sesión dos/, 'lista');
    const uno = h.find('Sesión uno'); h.mouse(0, 5, uno.y); h.mouse(0, 5, uno.y, 'm');
    await h.waitFor(/aquí va \[Image #1\]/, 'chat con la marca', 20000);
    const m = h.find('[Image #1]', 40);
    const dentro = (dx) => m.x + dx;

    // una selección arrastrada sobre la marca copia texto, no abre la imagen
    h.mouse(0, dentro(0), m.y); h.mouse(32, dentro(6), m.y); h.mouse(0, dentro(6), m.y, 'm');
    await h.sleep(700); assert.equal(abiertos().length, 0, 'arrastrar no abre nada');
    // un clic en texto que no es una marca tampoco
    const otro = h.find('FAKE CLAUDE'); h.mouse(0, otro.x + 2, otro.y); h.mouse(0, otro.x + 2, otro.y, 'm');
    await h.sleep(700); assert.equal(abiertos().length, 0, 'clic en otro texto no abre nada');

    // un clic sobre la marca abre la imagen, a su tamaño real
    h.mouse(0, dentro(3), m.y); h.mouse(0, dentro(3), m.y, 'm');
    for (let i = 0; i < 100 && !abiertos().length; i++) await h.sleep(50);
    assert.equal(abiertos().length, 1, 'el clic sobre [Image #1] abre la imagen');
    const f = abiertos()[0];
    assert.match(f, /imagen-1\.png$/, 'con extensión de imagen');
    assert.ok(fs.existsSync(f) && fs.readFileSync(f).subarray(1, 4).toString() === 'PNG', 'es la imagen original, no una vista reducida');
    await h.waitFor(/\[Image #1\] abierta en el visor/, 'aviso en la barra');
  } finally { await h.close(); }
});

// ───────────── imágenes reales (Sixel) en el hover ─────────────
const sixelFixture = () => {
  const root = tmp('hopdeck-ui-sixel-');
  const png = makePNG(80, 40, (x, y) => [x * 3, y * 6, 120, 255]).toString('base64');
  const fx = makeFixture(root, [alpha({ first: '[Image #1] mira esta imagen', image: png })]);
  const lineas = ['M [Image #1] marca', 'a'.repeat(70), 'b'.repeat(70), 'c'.repeat(70), 'd'.repeat(70), 'e'.repeat(70), 'f'.repeat(70)].join('\r\n');
  return { root, fx, lineas, log: path.join(root, 'sixel.log') };
};
const leerSixel = (log) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const abrirChatConImagen = async (h) => {
  await h.waitFor(/Sesión dos/, 'lista');
  const uno = h.find('Sesión uno'); h.mouse(0, 5, uno.y); h.mouse(0, 5, uno.y, 'm');
  await h.waitFor(/M \[Image #1\] marca/, 'chat con la marca', 20000);
  return h.find('[Image #1]', 37);
};

test('Sixel: la imagen se dibuja justo en el hueco del cuadro, tapa el texto de debajo y al quitar el cursor el chat se repinta', opts, async () => {
  const { root, fx, lineas, log } = sixelFixture();
  const h = launchHub({ root, fx, cwd: fx.cwds.alpha, env: { HOPDECK_SIXEL: '1', HOPDECK_SIXEL_LOG: log, FAKE_PRINT: lineas } });
  try {
    const m = await abrirChatConImagen(h);
    await h.waitFor(/a{70}/, 'el texto completo del chat');
    assert.equal(leerSixel(log).length, 0, 'sin cursor sobre la marca no se dibuja nada');

    h.mouse(35, m.x + 2, m.y);
    await h.waitFor(/╭─ \[Image #1\]/, 'el cuadro del hover');
    for (let i = 0; i < 100 && !leerSixel(log).length; i++) await h.sleep(50);
    const dibujos = leerSixel(log); assert.equal(dibujos.length, 1, 'la imagen se dibuja una sola vez');
    const { row, col, data } = dibujos[0];
    const [, , , W, H] = data.match(/^\x1bP[0-9;]*q"(\d+);(\d+);(\d+);(\d+)/);
    assert.deepEqual([+W, +H], [240, 120], 'una imagen de 80×40 se amplía hasta 24×6 celdas de 10×20 píxeles');

    await h.waitFor(/╭─ \[Image #1\] ─{8,}╮/, 'el cuadro con el ancho de la imagen (ya no el aviso de carga)');
    const borde = h.find('╭─ [Image #1]'); const ancho = h.lines()[borde.y - 1].slice(borde.x - 1).match(/^╭[^╮]*╮/)[0].length - 2;
    assert.equal(ancho, +W / 10, 'el cuadro tiene exactamente el ancho de la imagen en celdas');
    assert.equal(row, borde.y + 1, 'la imagen empieza en la fila justo debajo del borde superior');
    assert.equal(col, borde.x + 1, 'y en la columna justo después del borde izquierdo');
    assert.doesNotMatch(h.screen(), /a{70}/, 'el hueco tapa el texto del chat que había debajo');
    assert.doesNotMatch(h.screen(), /▀/, 'sin imagen de bloques: es la imagen real');

    h.mouse(35, 3, 5);                                 // el cursor sale de la marca
    await h.waitGone(/╭─ \[Image #1\]/, 'el cuadro desaparece');
    await h.waitFor(/a{70}/, 'el texto del chat vuelve a pintarse donde estaba la imagen');
    await h.waitFor(/f{70}/, 'y también el de más abajo');
    assert.equal(leerSixel(log).length, 1, 'y no se dibuja nada más');
  } finally { await h.close(); }
});

test('Sixel: se activa si el terminal contesta que lo admite, y HOPDECK_SIXEL=0 lo apaga', opts, async () => {
  for (const apagado of [false, true]) {
    const { root, fx, lineas, log } = sixelFixture();
    const h = launchHub({ root, fx, cwd: fx.cwds.alpha, env: { HOPDECK_SIXEL_LOG: log, FAKE_PRINT: lineas, ...(apagado ? { HOPDECK_SIXEL: '0' } : {}) } });
    try {
      await h.waitFor(/Sesión dos/, 'lista');
      h.write('\x1b[?62;4;22c\x1b[6;20;10t');          // lo que contestaría Windows Terminal: "admito Sixel" y "una celda mide 10×20"
      await h.sleep(300);
      assert.doesNotMatch(h.screen(), /62;4;22c|6;20;10t/, 'la respuesta del terminal no llega a la pantalla como si fueran teclas');
      const m = await abrirChatConImagen(h);
      h.mouse(35, m.x + 2, m.y);
      await h.waitFor(/╭─ \[Image #1\]/, 'el cuadro del hover');
      await h.sleep(600);
      if (apagado) { assert.equal(leerSixel(log).length, 0, 'con HOPDECK_SIXEL=0 no hay Sixel aunque el terminal lo admita'); assert.match(h.screen(), /▀/, 'se usa la vista de bloques'); }
      else { assert.equal(leerSixel(log).length, 1, 'tras la respuesta del terminal se usa la imagen real'); assert.doesNotMatch(h.screen(), /▀/); }
    } finally { await h.close(); }
  }
});

// ───────────── panel de git (F8) ─────────────
const cpUi = require('child_process');
const gitUi = (() => { try { return cpUi.spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0; } catch { return false; } })();
test('panel de git: F8 lo abre con la rama, los cambios y los cambios de rama; F8 lo cierra', { ...opts, skip: opts.skip || (!gitUi && 'git no instalado') }, async () => {
  const root = tmp('hopdeck-ui-git-');
  const fx = makeFixture(root, [alpha()]);
  const repo = fx.cwds.alpha, nul = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const genv = { ...process.env, GIT_CONFIG_GLOBAL: nul, GIT_CONFIG_SYSTEM: nul };
  const g = (...a) => cpUi.execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...a], { cwd: repo, env: genv, stdio: 'ignore' });
  g('init', '-q'); g('commit', '-q', '--allow-empty', '-m', 'uno'); g('checkout', '-q', '-b', 'rama-de-prueba');
  fs.writeFileSync(path.join(repo, 'cambiado.txt'), 'x');
  const h = launchHub({ root, fx, cwd: repo, cols: 160, rows: 30, env: { FAKE_PRINT: 'hola desde el chat' } });
  try {
    await h.waitFor(/Sesión dos/, 'lista');
    const uno = h.find('Sesión uno'); h.mouse(0, 5, uno.y); h.mouse(0, 5, uno.y, 'm');
    await h.waitFor(/hola desde el chat/, 'chat', 20000);
    assert.doesNotMatch(h.screen(), /Ramas recientes/, 'sin pulsar nada no hay tercer panel');
    h.write('\x1b[19~');                               // F8
    await h.waitFor(/Ramas recientes/, 'el panel de git', 20000);
    await h.waitFor(/1 cambio sin guardar/, 'cambios sin guardar');
    const s = h.screen();
    assert.match(s, /⎇ rama-de-prueba/, 'rama actual'); assert.match(s, /cambiado\.txt/, 'archivo cambiado');
    assert.match(s, /main → rama-de-prueba/, 'el cambio de rama aparece en la actividad'); assert.match(s, /\+ rama-de-prueba/, 'y la rama creada'); assert.doesNotMatch(s, /desde HEAD/, 'sin el «desde HEAD», que no aporta nada');
    assert.match(s, /hola desde el chat/, 'el chat sigue a la izquierda del panel');
    h.write('\x1b[19~');                               // F8 otra vez
    await h.waitGone(/Ramas recientes/, 'el panel se cierra');
    assert.match(h.screen(), /hola desde el chat/);
    h.write('\x1bOP'); await h.sleep(300);                // F1: foco en la lista
    h.write('b');                                      // la letra `b` hace lo mismo que F8 (en macOS F8 suele necesitar Fn)
    await h.waitFor(/Ramas recientes/, 'la tecla b abre el panel');
  } finally { await h.close(); }
});

// ───────────── tema claro/oscuro en caliente (t / F9) ─────────────
test('tema: t y F9 cambian entre claro y oscuro sin reiniciar, repintan todo y lo recuerdan', opts, async () => {
  const root = tmp('hopdeck-ui-theme-');
  const fx = makeFixture(root, [alpha()]);
  const h = launchHub({ root, fx, cwd: fx.cwds.alpha, env: { FAKE_PRINT: 'hola desde el chat' } });
  const color = (needle) => { // color de primer plano (RGB) del texto `needle` en pantalla
    const pos = h.find(needle); assert.ok(pos, 'hay texto: ' + needle);
    const b = h.term.buffer.active, cell = b.getLine(b.viewportY + pos.y - 1).getCell(pos.x - 1);
    return cell.isFgRGB() ? cell.getFgColor().toString(16).padStart(6, '0') : 'paleta-' + cell.getFgColor();
  };
  const saved = () => { try { return JSON.parse(fs.readFileSync(path.join(root, 'cfg.json'), 'utf8')).theme; } catch { return undefined; } };
  try {
    await h.waitFor(/Sesión dos/, 'lista');
    assert.equal(color('Sesión dos'), 'e8e6e3', 'empieza en oscuro (texto claro)');
    h.write('t');                                        // desde la lista
    await h.waitFor(/Tema claro/, 'aviso del cambio');
    await h.sleep(200);
    assert.equal(color('Sesión dos'), '26262c', 'el texto de la lista pasa a los colores del tema claro');
    assert.equal(saved(), 'light', 'queda guardado');
    h.write('\x1b[20~');                                // F9, funciona igual
    await h.waitFor(/Tema oscuro/, 'aviso al volver');
    await h.sleep(200);
    assert.equal(color('Sesión dos'), 'e8e6e3', 'vuelve al oscuro');
    assert.equal(saved(), 'dark');
    // con un chat abierto también se repinta todo (la lista, el cuadro de abajo y el chat siguen visibles)
    const uno = h.find('Sesión uno'); h.mouse(0, 5, uno.y); h.mouse(0, 5, uno.y, 'm');
    await h.waitFor(/hola desde el chat/, 'chat');
    h.write('\x1b[20~');                                // F9 con el foco en el chat
    await h.waitFor(/Tema claro/, 'aviso con el chat abierto');
    assert.match(h.screen(), /hola desde el chat/, 'el chat sigue ahí');
  } finally { await h.close(); }
});

// ───────────── seleccionar texto del chat ─────────────
const muchas = Array.from({ length: 80 }, (_, i) => 'linea ' + String(i + 1).padStart(2, '0')).join('\r\n'); // más de lo que cabe en pantalla
const copiado = (log) => { try { return fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

test('seleccionar en el chat no copia solo: se copia con Ctrl+C o con el clic derecho', opts, async () => {
  const root = tmp('hopdeck-ui-sel-'); const log = path.join(root, 'copiado.log');
  const fx = makeFixture(root, [alpha()]);
  const h = launchHub({ root, fx, cwd: fx.cwds.alpha, env: { FAKE_PRINT: muchas, HOPDECK_COPY_LOG: log } });
  try {
    await h.waitFor(/Sesión dos/, 'lista');
    const uno = h.find('Sesión uno'); h.mouse(0, 5, uno.y); h.mouse(0, 5, uno.y, 'm');
    await h.waitFor(/linea 80/, 'chat con mucho texto');
    const y = h.find('linea 80').y;
    const arrastrar = async () => { h.mouse(0, 39, y); h.mouse(32, 45, y); h.mouse(32, 50, y); h.mouse(0, 50, y, 'm'); await h.sleep(400); };
    await arrastrar();
    assert.deepEqual(copiado(log), [], 'al soltar la selección no se copia nada');
    await h.waitFor(/Ctrl\+C o clic derecho/, 'avisa de cómo copiar');
    h.write('\x03');
    await h.waitFor(/Copiado/, 'Ctrl+C copia lo seleccionado');
    assert.equal(copiado(log).length, 1);
    assert.match(copiado(log)[0], /inea 80/, 'lo marcado (de la 2.ª letra en adelante, donde se pulsó)');
    await arrastrar();                                       // otra selección: ahora con el clic derecho
    assert.equal(copiado(log).length, 1, 'tampoco se copió sola esta vez');
    h.mouse(2, 48, y); h.mouse(2, 48, y, 'm');
    await h.sleep(500); assert.equal(copiado(log).length, 2, 'el clic derecho copia');
  } finally { await h.close(); }
});

test('seleccionar en el chat: arrastrar contra el borde desplaza el chat y la selección sigue (se puede marcar más de una pantalla)', opts, async () => {
  const root = tmp('hopdeck-ui-selscroll-'); const log = path.join(root, 'copiado.log');
  const fx = makeFixture(root, [alpha()]);
  const h = launchHub({ root, fx, cwd: fx.cwds.alpha, env: { FAKE_PRINT: muchas, HOPDECK_COPY_LOG: log } });
  try {
    await h.waitFor(/Sesión dos/, 'lista');
    const uno = h.find('Sesión uno'); h.mouse(0, 5, uno.y); h.mouse(0, 5, uno.y, 'm');
    await h.waitFor(/linea 80/, 'chat con mucho texto');
    assert.doesNotMatch(h.screen(), /linea 40/, 'al principio solo se ve el final');
    const y = h.find('linea 80').y;
    h.mouse(0, 80, y);                                       // empieza abajo, pasado el final de la línea (así entra entera)...
    h.mouse(32, 50, y - 3);
    h.mouse(32, 50, 1);                                      // ...y arrastra por encima del chat, y se queda quieto ahí
    await h.waitFor(/linea 3\d/, 'el chat se desplaza solo hacia arriba', 6000);
    h.mouse(0, 50, 1, 'm');
    await h.sleep(300);
    h.write('\x03');
    await h.waitFor(/Copiado/, 'copia la selección');
    const t = copiado(log)[0];
    assert.match(t, /linea 80/, 'incluye lo que se veía al empezar');
    assert.match(t, /linea 50/, 'y lo que estaba fuera de la pantalla');
    assert.ok(t.split('\n').length > 30, 'más líneas de las que caben en pantalla');
  } finally { await h.close(); }
});

// ───────────── indicador «trabajando» (el spinner de la lista) ─────────────
const SPIN = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;
const listaIzq = (h) => h.lines().map((l) => l.slice(0, 36)).join('\n'); // la lista ocupa las primeras columnas

test('indicador de trabajo: un chat que solo repinta (sin «esc to interrupt») no aparece como trabajando', opts, async () => {
  const root = tmp('hopdeck-ui-noise-');
  const fx = makeFixture(root, [alpha()]);
  const h = launchHub({ root, fx, cwd: fx.cwds.alpha, env: { FAKE_NOISE: '1' } });
  try {
    await h.waitFor(/Sesión dos/, 'lista');
    const uno = h.find('Sesión uno'); h.mouse(0, 5, uno.y); h.mouse(0, 5, uno.y, 'm'); // abre el chat
    await h.waitFor(/FAKE CLAUDE/, 'chat abierto');
    h.write('\x1bOP'); await h.sleep(2500);                                          // F1: foco en la lista; el chat escribe cada 300 ms
    for (let i = 0; i < 6; i++) { assert.doesNotMatch(listaIzq(h), SPIN, 'sin spinner en la lista'); await h.sleep(250); }
    assert.match(listaIzq(h), /●/, 'solo la marca de chat abierto');
  } finally { await h.close(); }
});

test('indicador de trabajo: mientras el chat muestra «esc to interrupt» sale el spinner, y al terminar vuelve la marca', opts, async () => {
  const root = tmp('hopdeck-ui-busy-');
  const fx = makeFixture(root, [alpha()]);
  const h = launchHub({ root, fx, cwd: fx.cwds.alpha, env: { FAKE_BUSY: '1' } });
  try {
    await h.waitFor(/Sesión dos/, 'lista');
    const uno = h.find('Sesión uno'); h.mouse(0, 5, uno.y); h.mouse(0, 5, uno.y, 'm');
    await h.waitFor(/FAKE CLAUDE/, 'chat abierto');
    h.write('\x1bOP');
    let visto = false; const t0 = Date.now();
    while (Date.now() - t0 < 3500 && !visto) { visto = SPIN.test(listaIzq(h)); if (!visto) await h.sleep(100); }
    assert.ok(visto, 'el spinner aparece mientras trabaja');
    await h.waitFor(/listo/, 'termina de generar', 8000);
    const t1 = Date.now(); let aun = true;
    while (Date.now() - t1 < 5000 && aun) { aun = SPIN.test(listaIzq(h)); if (aun) await h.sleep(100); }
    assert.ok(!aun, 'el spinner se apaga al terminar');
  } finally { await h.close(); }
});

// ───────────── búsqueda dentro del contenido (Tab) ─────────────
test('búsqueda en el contenido: si ningún título coincide, se busca sola dentro de las conversaciones (y Tab la fuerza)', opts, async () => {
  const root = tmp('hopdeck-ui-deep-');
  const fx = makeFixture(root, [{ name: 'alpha', sessions: [
    { id: 'e1', first: 'primer mensaje', ai: 'Sesión uno', assistant: 'Usé la zanahoria-mágica para resolverlo', ageH: 1 },
    { id: 'e2', first: 'otro mensaje', ai: 'Sesión dos', assistant: 'Nada especial aquí', ageH: 2 },
  ] }]);
  const h = launchHub({ root, fx, cwd: fx.cwds.alpha });
  try {
    await h.waitFor(/Sesión dos/, 'lista');
    h.write('/'); await h.sleep(150);
    h.write('zanahoria');                             // ningún título lo contiene: sin pedirlo, se busca en el contenido
    await h.waitFor(/1 resultado/, 'dice cuántos hay: la conversación que menciona la palabra aparece sola', 15000);
    await h.waitFor(/en el contenido/, 'y que se buscó dentro del contenido');
    assert.match(h.lines().slice(2, 12).join('\n'), /Sesión uno/);
    assert.doesNotMatch(h.lines().slice(2, 12).join('\n'), /Sesión dos/, 'y la que no la menciona, no');
    assert.match(h.lines().slice(2, 12).join('\n'), /⌕/, 'marcada con ⌕: coincide dentro del texto, no en el título');
    h.write('\x1b');
    // con coincidencias en los títulos no se rastrea el contenido; Tab sí lo pide
    h.write('/'); await h.sleep(150); h.write('sesion');
    await h.waitFor(/2 resultados/, '«sesion» (sin tilde) encuentra «Sesión uno» y «Sesión dos»');
    h.write('\t');
    await h.waitFor(/◉ contenido/, 'Tab activa la búsqueda en el contenido');
  } finally { await h.close(); }
});

test('búsqueda: palabras en cualquier orden, sin importar acentos; ⏎ abre el primer resultado; sin resultados se explica', opts, async () => {
  const root = tmp('hopdeck-ui-find-');
  const fx = makeFixture(root, [alpha(), { name: 'beta', sessions: [{ id: 'b1', first: 'hola beta', ai: 'Cosa beta', ageH: 3 }] }]);
  const h = launchHub({ root, fx, cwd: fx.cwds.alpha });
  try {
    await h.waitFor(/Sesión dos/, 'lista');
    assert.match(h.lines()[0], /⌕ \/ buscar/, 'el aviso de cómo buscar está siempre arriba a la derecha');
    h.write('/'); await h.sleep(150);
    h.write('dos sesion');                            // al revés y sin tilde
    await h.waitFor(/1 resultado/, 'encuentra «Sesión dos»');
    assert.doesNotMatch(h.screen(), /Sesión uno/);
    h.write('\r');                                    // ⏎ abre la conversación marcada, sin un segundo ⏎
    await h.waitFor(/FAKE CLAUDE/, 'el chat se abre directamente');
    h.write('\x1bOP'); await h.sleep(200);            // F1: vuelve a la lista
    h.write('\x1b'); await h.sleep(150);              // esc: limpia el filtro
    h.write('/'); await h.sleep(150);
    h.write('qqqqzzzz');
    await h.waitFor(/Sin resultados para «qqqqzzzz»/, 'si no hay nada, se dice');
    await h.waitFor(/en el contenido/, 'y se rastreó el contenido sin pedirlo');
  } finally { await h.close(); }
});

test('búsqueda: un clic en la fila de arriba de la lista empieza a buscar', opts, async () => {
  const root = tmp('hopdeck-ui-findclick-');
  const fx = makeFixture(root, [alpha()]);
  const h = launchHub({ root, fx, cwd: fx.cwds.alpha });
  try {
    await h.waitFor(/Sesión dos/, 'lista');
    h.mouse(0, 8, 1); h.mouse(0, 8, 1, 'm');          // clic en el título de la lista
    await h.waitFor(/⌕ ▏/, 'caja de búsqueda abierta, con el cursor');
    h.write('uno');
    await h.waitFor(/1 resultado/, 'se escribe directamente');
  } finally { await h.close(); }
});
