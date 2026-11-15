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
    await h.waitFor(/ \/ al▏pha/, 'cursor en medio del texto de búsqueda');
    assert.doesNotMatch(h.screen(), /beta/, 'el filtro "alpha" oculta beta');
    h.write('\x1b'); await h.waitGone(/ \/ al/, 'Esc limpia la búsqueda');

    h.write('\x10');                                  // Ctrl+P
    await h.waitFor(/⌕/, 'salto rápido');
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
    await h.waitFor(/abra Hopdeck/, 'pregunta del primer arranque', 40000);
    assert.match(h.screen(), /\[Enter\] Sí/, 'muestra las opciones');
    assert.match(h.screen(), /copia de seguridad/, 'avisa de la copia de seguridad');
    h.write('n');
    await h.waitFor(/Sesión dos/, 'después de responder se abre la lista');
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    assert.equal(cfg.shortcutAsked, true, 'queda guardado que ya se preguntó');
    h.write('q');
  } finally { await h.close(); }
});

// ───────────── modo tmux: el ratón de la lista ─────────────
const cp = require('child_process');
const tmuxOk = (() => { try { return cp.spawnSync('tmux', ['-V'], { stdio: 'ignore' }).status === 0; } catch { return false; } })();
test('modo tmux: la rueda mueve la lista y un clic abre la conversación', { ...opts, skip: opts.skip || (process.platform === 'win32' && 'tmux no existe en Windows') || (!tmuxOk && 'tmux no está instalado') }, async () => {
  const root = tmp('hopdeck-ui-tmux-'); const fx = makeFixture(root, [alpha()]);
  // sockets de tmux aislados (no tocan una sesión tuya abierta) y en una ruta corta: en macOS el socket admite ~104 caracteres
  const tmuxDir = fs.mkdtempSync(path.join('/tmp', 'hdt-'));
  const h = launchHub({ root, fx, cwd: fx.cwds.alpha, env: { HOPDECK_EMBED: '', TMUX_TMPDIR: tmuxDir } });
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
