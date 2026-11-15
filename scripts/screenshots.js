#!/usr/bin/env node
'use strict';
// Regenera las capturas del README (docs/screenshots/*.svg) con DATOS DE EJEMPLO: nunca usa tu historial real.
// Abre el hub en un terminal simulado (PTY + xterm), lo maneja como lo haría una persona y guarda lo que se ve.
const fs = require('fs');
const path = require('path');
const { tmp, makeFixture, makePNG, launchHub } = require('../test/helpers');
const { termToSvg } = require('./term2svg');

const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
const COLS = 124, ROWS = 26;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// imagen de ejemplo para el hover: atardecer con montañas
const paisaje = makePNG(112, 64, (x, y) => {
  const t = y / 64, sol = Math.hypot(x - 78, y - 30) < 11;
  if (sol) return [255, 214, 120, 255];
  const monte = 44 + 9 * Math.sin(x / 9) + 6 * Math.sin(x / 4.3) + (x > 50 ? (x - 50) * 0.18 : 0);
  if (y > monte) return [Math.round(34 - t * 12), Math.round(46 - t * 14), Math.round(78 - t * 20), 255];
  return [Math.round(60 + t * 190), Math.round(70 + t * 90), Math.round(150 - t * 60), 255];
}).toString('base64');

const DEMO = [
  { name: 'tienda-online', sessions: [
    { id: 'a1', ai: 'Carrito de compras con cupones', first: 'Agrega cupones de descuento al carrito de compras', assistant: 'Listo. Agregué el modelo Cupon (código, porcentaje y vencimiento), CarritoService.aplicarCupon() con validación de límites y 6 pruebas nuevas que pasan.', ageH: 0.5 },
    { id: 'a2', ai: 'Corregir error en el checkout', first: 'El checkout falla cuando el carrito está vacío', assistant: 'Encontré la causa: el total se calculaba sin comprobar items.length. Añadí la validación y una prueba de regresión.', ageH: 3 },
    { id: 'a3', ai: 'Integrar pasarela de pagos', first: 'Integra la pasarela de pagos en modo sandbox', assistant: 'La integración está lista detrás de un adaptador, así que cambiar de proveedor no toca el resto del código.', ageH: 26 },
    { id: 'a4', ai: 'Optimizar consultas del catálogo', first: 'La página del catálogo tarda mucho en cargar', assistant: 'Había un N+1 en las categorías. Con una sola consulta y un índice, la carga bajó de 1,8 s a 120 ms.', ageH: 70 },
  ] },
  { name: 'blog-personal', sessions: [
    { id: 'b1', ai: 'Migrar posts de Markdown', first: 'Migra los posts a archivos Markdown con front matter', assistant: 'Migré 48 posts. Conservé las fechas y generé redirecciones desde las URLs antiguas.', ageH: 5 },
    { id: 'b2', ai: 'Modo oscuro con variables CSS', first: 'Añade un modo oscuro con variables CSS', assistant: 'Listo: variables en :root, preferencia guardada y respeto de prefers-color-scheme.', ageH: 48 },
  ] },
  { name: 'api-reservas', sessions: [
    { id: 'c1', ai: 'Validar solapamiento de reservas', first: 'Evita que dos reservas se solapen en la misma sala', assistant: 'Añadí una restricción de exclusión en la base de datos y un mensaje de error claro en la API.', ageH: 8 },
    { id: 'c2', ai: 'Documentar endpoints con OpenAPI', first: 'Documenta los endpoints con OpenAPI', assistant: 'Generé la especificación y una página de documentación interactiva.', ageH: 100 },
  ] },
  { name: 'app-recetas', sessions: [{ id: 'd1', ai: 'Buscador por ingredientes', first: 'Quiero buscar recetas por los ingredientes que tengo', assistant: 'Hecho: el buscador acepta varios ingredientes y ordena por coincidencias.', ageH: 30 }] },
  { name: 'landing-cafe', sessions: [{ id: 'e1', ai: 'Animaciones al hacer scroll', first: 'Anima las secciones al hacer scroll', assistant: 'Usé IntersectionObserver, sin librerías, y respeté prefers-reduced-motion.', ageH: 200 }] },
];
const CONVERSACION = [
  '', '> Agrega cupones de descuento al carrito de compras', '',
  'Listo. Esto es lo que hice:',
  '  - Modelo Cupon con código, porcentaje y vencimiento',
  '  - CarritoService.aplicarCupon() con validación de límites',
  '  - 6 pruebas nuevas (todas pasan)', '',
  '¿Quieres que también muestre el descuento en el resumen del pedido?',
].join('\r\n');

async function shot(name, title, opts, drive) {
  const root = tmp('hopdeck-shot-');
  const fx = makeFixture(root, opts.spec || DEMO.map((p) => ({ ...p, sessions: p.sessions.map((s) => ({ ...s, ...(opts.image && s.id === 'a1' ? { first: '[Image #1] ' + s.first, image: paisaje } : {}) })) })));
  fs.writeFileSync(path.join(root, 'cfg.json'), JSON.stringify({ sidebar: 54 })); // lista más ancha para que se lean los títulos
  if (opts.setup) opts.setup(root);
  const h = launchHub({ root, fx, home: opts.home || root, cwd: fx.cwds['tienda-online'], cols: COLS, rows: ROWS,
    env: { HOPDECK_LANG: 'es', FAKE_BANNER: 'chat de ejemplo', COLORTERM: 'truecolor', ...(opts.env || {}) } });
  if (!h) throw new Error('Hace falta node-pty y @xterm/headless (npm install).');
  try {
    await h.waitFor(/tienda-online/, 'lista');
    await drive(h, root);
    await sleep(500);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, name + '.svg'), termToSvg(h.term, { title }));
    console.log('✓', name);
  } finally { await h.close(); }
}

(async () => {
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
  await shot('05-salto-rapido', 'Ctrl+P: salto rápido entre todas las conversaciones', {}, async (h) => {
    h.write('\x10'); await h.waitFor(/⌕/, 'salto rápido'); h.write('cupones'); await h.waitFor(/cupones/i, 'resultado');
    await sleep(300);
  });
})().catch((e) => { console.error(e); process.exit(1); });
