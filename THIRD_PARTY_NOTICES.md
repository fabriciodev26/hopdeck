# Dependencias de terceros

Hopdeck no incluye código de terceros dentro de su carpeta: las dependencias se instalan con npm
y cada una conserva su propia licencia.

| Paquete | Versión | Licencia | Para qué se usa |
|---|---|---|---|
| [@lydell/node-pty](https://github.com/lydell/node-pty) (y su paquete de binarios por plataforma) | 1.2.0-beta.18 | MIT | Abrir `claude` dentro del panel derecho (pseudo-terminal) |
| [@xterm/headless](https://github.com/xtermjs/xterm.js) | 6.0.0 | MIT | Emular el terminal del chat para dibujarlo en el panel |
| [jpeg-js](https://github.com/jpeg-js/jpeg-js) | 0.4.4 | BSD-3-Clause | Decodificar imágenes JPEG para la galería y el hover |

Ninguna dependencia ejecuta scripts de instalación (`npm audit`: 0 vulnerabilidades conocidas a la fecha de la versión 1.2.0).

## Tipografía del logotipo

El texto de `docs/logo-*.svg`, `docs/logo-*.png` y la «H» de `docs/icon.*` están convertido a trazados a partir de la fuente [Inter](https://rsms.me/inter/) (peso 800), con licencia SIL Open Font License 1.1, que permite este uso. No se distribuye la fuente.

## Marcas

"Claude" y "Claude Code" son marcas de Anthropic, PBC. Este proyecto es independiente: **no está afiliado, respaldado ni patrocinado por Anthropic**.
Solo lee el historial local que Claude Code ya guarda en tu equipo y lanza el comando `claude` que tú tengas instalado.
