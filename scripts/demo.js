#!/usr/bin/env node
'use strict';
// Abre Hopdeck con DATOS DE EJEMPLO (proyectos ficticios, una imagen de muestra y un repositorio de juguete) para grabar
// el GIF o hacer capturas sin mostrar tus carpetas reales. No lee ni escribe tu historial ni tu configuración.
//   node scripts/demo.js          →  abre el hub en esta misma terminal (Enter abre un chat de muestra, no el claude real)
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { makeFixture, makePNG } = require('../test/helpers');
const { demoRepo, DEMO } = require('./demo-data');

// Ruta corta y neutra (la ruta de la carpeta se ve en pantalla): C:\hopdeck-demo, /tmp/hopdeck-demo…
const base = process.platform === 'win32' ? path.join(path.parse(os.tmpdir()).root, 'hopdeck-demo') : path.join(os.tmpdir(), 'hopdeck-demo');
let root = base;
try { fs.rmSync(base, { recursive: true, force: true }); fs.mkdirSync(base, { recursive: true }); } catch { root = fs.mkdtempSync(path.join(os.tmpdir(), 'hopdeck-demo-')); }

// imagen de muestra para el hover: la maqueta de una página web (más grande que la de las capturas, se ve mejor en Sixel)
const W = 320, H = 180;
const pagina = makePNG(W, H, (x, y) => {
  if (y < 14) return [24, 28, 40, 255];                                              // barra de navegación
  if (y > 62 && y < 74 && x > 24 && x < 170) return [240, 240, 245, 255];            // titular
  if (y > 80 && y < 86 && x > 24 && x < 210) return [150, 156, 175, 255];            // texto
  if (y > 92 && y < 98 && x > 24 && x < 190) return [110, 116, 135, 255];
  if (y > 112 && y < 128 && x > 24 && x < 84) return [217, 119, 87, 255];            // botón
  if (x > 214 && x < 300 && y > 30 && y < 140) return [48 + (y - 30), 54 + (y - 30) / 2, 86 + (y - 30) / 3, 255]; // tarjeta
  const t = y / H; return [Math.round(20 + t * 14), Math.round(24 + t * 14), Math.round(38 + t * 20), 255];
}).toString('base64');

const spec = DEMO.map((p) => ({ ...p, sessions: p.sessions.map((s) => (s.id === 'a1' ? { ...s, first: '[Image #1] ' + s.first, image: pagina } : s)) }));
const fx = makeFixture(root, spec);
fs.writeFileSync(path.join(root, 'cfg.json'), JSON.stringify({ sidebar: 54 }));
demoRepo(fx.cwds['tienda-online']);

// "claude" de muestra en el PATH: así Enter abre un chat de ejemplo en lugar de tu claude real
const bin = path.join(root, 'bin'); fs.mkdirSync(bin, { recursive: true });
const fake = path.join(__dirname, '..', 'test', 'fixtures', 'fake-claude.js');
if (process.platform === 'win32') fs.writeFileSync(path.join(bin, 'claude.cmd'), `@echo off\r\n"${process.execPath}" "${fake}" %*\r\n`);
else { fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`); fs.chmodSync(path.join(bin, 'claude'), 0o755); }
const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') || 'PATH';
const env = {
  ...process.env, [pathKey]: bin + path.delimiter + process.env[pathKey],
  CLAUDE_CONFIG_DIR: fx.cfg, HOPDECK_CONFIG: path.join(root, 'cfg.json'), HOPDECK_CACHE: path.join(root, 'cache.json'),
  HOPDECK_NOPROMPT: '1', HOPDECK_LANG: process.env.HOPDECK_LANG || 'es', HOPDECK_EMBED: '1', FAKE_BANNER: 'chat de ejemplo',
  HOME: root, USERPROFILE: root,
};
delete env.HOPDECK_INSIDE; delete env.TMUX;
const r = cp.spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'hopdeck.js')], { cwd: fx.cwds['tienda-online'], env, stdio: 'inherit' });
if (!process.env.HOPDECK_DEMO_KEEP) try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* */ }
process.exit(r.status || 0);
