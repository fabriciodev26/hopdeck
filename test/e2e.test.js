'use strict';
// Prueba de extremo a extremo: abre el hub en un PTY real (ConPTY en Windows), navega,
// abre un "claude" falso dentro del panel derecho y comprueba lo que se ve en pantalla.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmp, makeFixture, makePNG } = require('./helpers');

let pty, Terminal;
try { pty = require('@lydell/node-pty'); Terminal = require('@xterm/headless').Terminal; } catch { /* sin dependencias nativas */ }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COLS = 110, ROWS = 26;

test('hub embebido: salto rápido, chat en el panel derecho, foco y salida', { skip: !pty && 'node-pty/xterm no disponibles', timeout: 90000 }, async () => {
  const root = tmp('hopdeck-e2e-');
  const fx = makeFixture(root, [{ name: 'alpha', sessions: [
    { id: 'e1', first: 'primer mensaje de alfa', ai: 'Sesión uno', ageH: 1, image: makePNG(16, 8, (x, y) => [x * 15, y * 30, 200, 255]).toString('base64') },
    { id: 'e2', first: 'otro mensaje', ai: 'Sesión dos', ageH: 2 },
  ] }]);
  // claude de mentira en el PATH
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  const fake = path.join(__dirname, 'fixtures', 'fake-claude.js');
  if (process.platform === 'win32') fs.writeFileSync(path.join(bin, 'claude.cmd'), `@echo off\r\n"${process.execPath}" "${fake}" %*\r\n`);
  else { fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`); fs.chmodSync(path.join(bin, 'claude'), 0o755); }

  // En Windows la variable se llama "Path": añadir otra "PATH" haría que ganara la original y no se viera el claude falso.
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') || 'PATH';
  const env = {
    ...process.env, [pathKey]: bin + path.delimiter + process.env[pathKey],
    CLAUDE_CONFIG_DIR: fx.cfg, HOPDECK_CONFIG: path.join(root, 'cfg.json'), HOPDECK_CACHE: path.join(root, 'cache.json'),
    HOPDECK_NOPROMPT: '1', HOPDECK_LANG: 'es', HOPDECK_EMBED: '1', HOPDECK_THEME: 'dark', COLORTERM: 'truecolor', NO_COLOR: '',
  };
  delete env.HOPDECK_INSIDE; delete env.TMUX; delete env.NO_COLOR;

  const term = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true });
  const p = pty.spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'hopdeck.js')], { name: 'xterm-256color', cols: COLS, rows: ROWS, cwd: root, env });
  term.onData((d) => { try { p.write(d); } catch { /* */ } });
  p.onData((d) => term.write(d));
  let exited = false; p.onExit(() => { exited = true; });
  const screen = () => { const b = term.buffer.active; const out = []; for (let y = 0; y < ROWS; y++) { const l = b.getLine(b.viewportY + y); out.push(l ? l.translateToString(true) : ''); } return out.join('\n'); };
  const waitFor = async (re, label, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (re.test(screen())) return; await sleep(60); }
    throw new Error(`Tiempo agotado esperando: ${label}\n----- pantalla -----\n${screen()}`);
  };

  try {
    await waitFor(/Hopdeck/, 'lista de proyectos');
    await waitFor(/alpha/, 'proyecto alpha en la lista');

    p.write('\x10');                                  // Ctrl+P: salto rápido
    await waitFor(/⌕/, 'selector rápido');
    p.write('dos');
    await waitFor(/Sesión dos/, 'resultado del selector');
    p.write('\r');
    await waitFor(/FAKE CLAUDE/, 'chat abierto en el panel derecho');
    assert.match(screen(), /alpha › Sesión dos/, 'cabecera con proyecto › conversación');
    assert.match(screen(), /args=--resume e2/, 'se reanuda la sesión elegida');

    p.write('hola\r');                                // el texto llega al chat
    await waitFor(/eco: hola/, 'respuesta del chat');

    p.write('\x1bOP');                                // F1: foco a la lista
    await sleep(300);
    p.write('\x1b[B');                                // la lista responde a las flechas
    await sleep(300);
    assert.match(screen(), /eco: hola/, 'el chat sigue vivo y visible');

    // cerrar el chat abierto desde la lista (c). Mientras Claude trabaja pide confirmar, así que se espera a que quede en reposo.
    p.write('\x1bOP'); await sleep(1700);
    p.write('c');
    await waitFor(/Conversación cerrada/, 'aviso de chat cerrado');
    await waitFor(/otro mensaje/, 'sin chat abierto el panel muestra la vista previa de la conversación seleccionada');
    assert.doesNotMatch(screen(), /FAKE CLAUDE/);

    // galería de imágenes (i) de la sesión "uno", que tiene una imagen adjunta
    p.write('\x10'); await waitFor(/⌕/, 'selector rápido');
    p.write('uno'); await waitFor(/Sesión uno/, 'resultado');
    p.write('\r'); await waitFor(/FAKE CLAUDE/, 'chat uno abierto');
    p.write('\x1bOP'); await sleep(300);
    p.write('i');
    await waitFor(/▣ 1\/1/, 'galería con la imagen');
    await waitFor(/16×8/, 'dimensiones de la imagen');
    assert.match(screen(), /▀/, 'la imagen se dibuja con medios bloques');
    p.write('\x1b'); await sleep(300);
    await waitFor(/FAKE CLAUDE/, 'al cerrar la galería se ve el chat otra vez');

    p.write('q');                                     // salir
    for (let i = 0; i < 100 && !exited; i++) await sleep(50);
    assert.ok(exited, 'el hub termina con q');
  } finally {
    try { p.kill(); } catch { /* */ }
  }
});
