'use strict';
// Datos de ejemplo (ficticios) compartidos por las capturas del README y por el modo demo. Nunca tocan el historial real.
const fs = require('fs');
const path = require('path');
const { makePNG } = require('../test/helpers');
const cp = require('child_process');
/** Repositorio de ejemplo para el panel de git: una rama de trabajo creada y cambiada, un archivo modificado y otro nuevo. */
function demoRepo(dir) {
  const nul = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const env = { ...process.env, GIT_CONFIG_GLOBAL: nul, GIT_CONFIG_SYSTEM: nul };
  const g = (...a) => cp.execFileSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.com', '-c', 'init.defaultBranch=main', ...a], { cwd: dir, env, stdio: 'ignore' });
  g('init', '-q');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'carrito.js'), 'module.exports = {};\n'); fs.writeFileSync(path.join(dir, 'README.md'), '# tienda\n');
  g('add', '.'); g('commit', '-q', '-m', 'Base de la tienda');
  g('checkout', '-q', '-b', 'fix/checkout-vacio'); g('checkout', '-q', 'main'); g('checkout', '-q', '-b', 'feat/cupones');
  fs.writeFileSync(path.join(dir, 'src', 'carrito.js'), 'module.exports = { cupones: true };\n'); fs.writeFileSync(path.join(dir, 'src', 'cupon.js'), '// nuevo\n');
}
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

module.exports = { demoRepo, paisaje, DEMO, CONVERSACION };
