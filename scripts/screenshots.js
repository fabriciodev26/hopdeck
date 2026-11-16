#!/usr/bin/env node
'use strict';
// Regenera las capturas del README (docs/screenshots/*.svg) con DATOS DE EJEMPLO: nunca usa tu historial real.
// Abre el hub en un terminal simulado (PTY + xterm), lo maneja como lo haría una persona y guarda lo que se ve.
const fs = require('fs');
const path = require('path');
const { tmp, makeFixture, launchHub } = require('../test/helpers');
const { termToSvg } = require('./term2svg');

const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
// cada captura se genera en oscuro (la de siempre) y en claro (sufijo -light), para el README con <picture>
const THEMES = [
  { suffix: '', theme: 'dark', svg: {} },
  { suffix: '-light', theme: 'light', svg: { bg: '#ffffff', fg: '#26262c', barBg: '#e9e9ee', titleFg: '#6b6b73' } },
];
let TH = THEMES[0];
const COLS = 124, ROWS = 26;
const { demoRepo, paisaje, DEMO, CONVERSACION } = require('./demo-data');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(name, title, opts, drive) {
  const root = tmp('hopdeck-shot-');
  const fx = makeFixture(root, opts.spec || DEMO.map((p) => ({ ...p, sessions: p.sessions.map((s) => ({ ...s, ...(opts.image && s.id === 'a1' ? { first: '[Image #1] ' + s.first, image: paisaje } : {}) })) })));
  fs.writeFileSync(path.join(root, 'cfg.json'), JSON.stringify({ sidebar: 54 })); // lista más ancha para que se lean los títulos
  if (opts.setup) opts.setup(root);
  if (opts.repo) opts.repo(fx.cwds['tienda-online']);
  const h = launchHub({ root, fx, home: opts.home || root, cwd: fx.cwds['tienda-online'], cols: opts.cols || COLS, rows: ROWS,
    env: { HOPDECK_LANG: 'es', HOPDECK_THEME: TH.theme, FAKE_BANNER: 'chat de ejemplo', COLORTERM: 'truecolor', ...(opts.env || {}) } });
  if (!h) throw new Error('Hace falta node-pty y @xterm/headless (npm install).');
  try {
    await h.waitFor(/tienda-online/, 'lista');
    await drive(h, root);
    await sleep(500);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, name + TH.suffix + '.svg'), termToSvg(h.term, { title, ...TH.svg }));
    console.log('✓', name + TH.suffix);
  } finally { await h.close(); }
}

(async () => {
 for (TH of THEMES) {
  await shot('01-lista-y-vista-previa', 'Hopdeck · lista y vista previa', {}, async (h) => {
    await h.waitFor(/Corregir error en el checkout/, 'sesiones');
    const y = h.find('Corregir error en el checkout').y;
    h.mouse(35, 6, y);                                // pasar el cursor: el panel derecho muestra la conversación
    await h.waitFor(/regresión/, 'vista previa');
  });
  await shot('02-vista-dividida', 'Vista dividida: lista a la izquierda, el chat a la derecha', { env: { FAKE_PRINT: CONVERSACION } }, async (h) => {
    await h.waitFor(/Carrito de compras/, 'sesiones');
    const y = h.find('Carrito de compras').y;
    h.mouse(0, 6, y); h.mouse(0, 6, y, 'm');
    await h.waitFor(/Esto es lo que hice/, 'chat abierto');
    h.write('\x1bOP');                                // F1: foco a la lista
    await sleep(1800);                                // deja que el aviso de "trabajando" pase a ●
  });
  await shot('03-selector-de-carpetas', 'Elegir carpeta: navegar, filtrar y crear', {
    home: null, // se define en setup
    setup(root) {
      const home = path.join(root, 'inicio');
      for (const d of ['Documentos', 'Descargas', 'Escritorio', 'Proyectos/tienda-online', 'Proyectos/blog-personal', 'Proyectos/api-reservas', 'Proyectos/app-recetas', 'Música', 'Imágenes']) fs.mkdirSync(path.join(home, d), { recursive: true });
      fs.writeFileSync(path.join(root, 'cfg.json'), JSON.stringify({ sidebar: 54, recent: [{ dir: path.join(home, 'Proyectos', 'blog-personal'), t: Date.now() - 1000 }, { dir: path.join(home, 'Proyectos', 'api-reservas'), t: Date.now() - 2000 }] }));
      this.home = home;
    },
  }, async (h) => { h.write('o'); await h.waitFor(/Elegir carpeta/, 'selector'); await h.waitFor(/Proyectos/, 'carpetas'); });
  await shot('04-hover-imagen', 'Al pasar el cursor por [Image #N] se ve la imagen', { image: true, env: { FAKE_PRINT: ['', '> Mira esta captura: [Image #1]', '', 'Veo un atardecer con montañas. ¿Qué quieres cambiar?'].join('\r\n') } }, async (h) => {
    await h.waitFor(/Carrito de compras/, 'sesiones');
    const y = h.find('Carrito de compras').y;
    h.mouse(0, 6, y); h.mouse(0, 6, y, 'm');
    await h.waitFor(/Mira esta captura/, 'chat');
    const m = h.find('[Image #1]');
    h.mouse(35, m.x + 3, m.y);
    await h.waitFor(/▀/, 'imagen');
  });
  await shot('06-panel-git', 'F8: panel de git con la rama, los cambios y los cambios de rama', { cols: 156, repo: demoRepo, env: { FAKE_PRINT: CONVERSACION } }, async (h) => {
    await h.waitFor(/Carrito de compras/, 'sesiones');
    const y = h.find('Carrito de compras').y;
    h.mouse(0, 6, y); h.mouse(0, 6, y, 'm');
    await h.waitFor(/Esto es lo que hice/, 'chat abierto');
    h.write('\x1b[19~');                              // F8: panel de git
    await h.waitFor(/Actividad de ramas/, 'panel de git');
    await h.waitFor(/cupon\.js/, 'cambios');
    h.write('\x1bOP'); await sleep(1800);
  });
  await shot('05-salto-rapido', 'Ctrl+P: salto rápido entre todas las conversaciones', {}, async (h) => {
    h.write('\x10'); await h.waitFor(/⌕/, 'salto rápido'); h.write('cupones'); await h.waitFor(/cupones/i, 'resultado');
    await sleep(300);
  });
 }
})().catch((e) => { console.error(e); process.exit(1); });
