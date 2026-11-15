## Qué cambia · What changes

<!-- Una o dos frases. · One or two sentences. -->

## Por qué · Why

<!-- Enlaza el issue si existe: Closes #123 -->

## Lista de comprobación · Checklist

- [ ] `npm test` pasa en mi equipo · `npm test` passes locally
- [ ] Añadí o actualicé pruebas para el cambio de comportamiento · I added or updated tests
- [ ] Los textos nuevos de la interfaz están en español **y** en inglés (`lib/i18n.js`) · New UI strings in Spanish **and** English
- [ ] Todo texto que viene del historial pasa por `fit()` / `clean()` antes de dibujarse (es entrada no fiable, ver `SECURITY.md`) · Anything coming from the history goes through `fit()` / `clean()`
- [ ] No uso nombres de archivo temporales predecibles ni abro archivos según lo que declare el historial · No predictable temp names
- [ ] Actualicé `CHANGELOG.md` y, si hace falta, el README · I updated the changelog / README
- [ ] Si cambié algo visible, regeneré las capturas (`npm run screenshots`) · I regenerated screenshots if the UI changed
