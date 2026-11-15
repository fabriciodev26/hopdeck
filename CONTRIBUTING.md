# Contribuir

¡Gracias por querer ayudar! Algunas pautas breves:

1. **Abre un issue** antes de un cambio grande, para acordar el enfoque.
2. Requisitos: Node.js 18 o superior.
   ```bash
   git clone https://github.com/fabriciodev26/hopdeck.git
   cd hopdeck
   npm install
   npm test        # pruebas unitarias + interfaz y extremo a extremo en un PTY real
   ```
3. Todo cambio de comportamiento lleva su prueba (`test/unit.test.js`, `test/ui.test.js`).
   El "claude" de las pruebas es un programa de mentira (`test/fixtures/fake-claude.js`); no hace falta una cuenta.
4. Estructura: `bin/hopdeck.js` (interfaz y estado) y `lib/` (módulos sin estado compartido: texto, teclas, imágenes, historial…).
5. Textos de la interfaz en español **y** en inglés (`lib/i18n.js`): si añades uno, añade los dos.
6. Seguridad: lo que viene del historial es **entrada no fiable**. Pásalo siempre por `fit()`/`clean()` antes de dibujarlo, y no uses nombres de archivo temporales predecibles. Ver `SECURITY.md`.
7. Capturas del README: `npm run screenshots` las regenera con datos de ejemplo (nunca con tu historial real).

Al contribuir aceptas que tu aportación se publique bajo la licencia MIT del proyecto.
