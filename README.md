<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
    <img alt="Hopdeck" src="docs/logo-light.svg" width="300">
  </picture>
</p>

<p align="center"><b>Salta entre tus proyectos y conversaciones de Claude Code, sin salir de la terminal.</b></p>

**Español** · [English](README.en.md)

[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg)](package.json)

Escribe `claude` en tu terminal y **elige en qué proyecto y conversación seguir**, sin salir y sin hacer `cd`.
La lista de proyectos queda a la izquierda y la conversación a la derecha.

![Vista dividida: lista de proyectos a la izquierda y el chat a la derecha](docs/screenshots/02-vista-dividida.svg)

> **Proyecto independiente de la comunidad.** No está afiliado, respaldado ni patrocinado por Anthropic.
> "Claude" y "Claude Code" son marcas de Anthropic, PBC. Hopdeck solo lee el historial local que Claude Code ya guarda en tu equipo y lanza el comando `claude` que tú tengas instalado.

## Índice

[Por qué](#por-qué) · [Instalación](#instalación) · [Primeros pasos](#primeros-pasos) · [Teclas](#teclas) · [Funciones](#funciones) · [Compatibilidad](#compatibilidad) · [Configuración](#configuración) · [Privacidad](#privacidad) · [Problemas frecuentes](#problemas-frecuentes) · [Colaborar y licencia](#colaborar-y-licencia)

## Por qué

Claude Code guarda cada conversación ligada a una carpeta. Para retomar una hay que acordarse de en qué carpeta estaba, hacer `cd` y abrir `claude --resume`.
Hopdeck te enseña **todos tus proyectos y conversaciones en una sola pantalla**, con vista previa, búsqueda y varios chats abiertos a la vez.

## Instalación

**Necesitas**

- [Node.js](https://nodejs.org) 22 o superior.
- [Claude Code](https://claude.com/claude-code) instalado (el comando `claude` debe funcionar en tu terminal).
- Una terminal con color. En Windows se recomienda **Windows Terminal**.

**Instalar**

```bash
npm install -g hopdeck
hopdeck
```

Listo. También puedes probarlo sin instalar: `npx hopdeck`.

**La primera vez** que lo abras, Hopdeck te pregunta si quieres que escribir `claude` lo abra. Si dices que sí, añade una pequeña función `claude` a tu perfil de shell (bash, zsh, fish o PowerShell), después de guardar una **copia de seguridad** del perfil (en una terminal nueva ya funciona):

- `claude` solo → abre Hopdeck.
- `claude <cualquier argumento>` (`-p`, `--resume`, `--model`…) → funciona exactamente igual que siempre.

Puedes decir que no y usar siempre `hopdeck`. Si cambias de idea: `hopdeck install`.

**Quitarlo:** `hopdeck uninstall`. Para saltarlo una sola vez: `HOPDECK_SKIP=1 claude`.

**¿Algo no va bien?** Ejecuta `hopdeck doctor`: revisa tu instalación y dice cómo arreglar lo que falte.

## Primeros pasos

![Lista de proyectos y vista previa de la conversación seleccionada](docs/screenshots/01-lista-y-vista-previa.svg)

1. Elige un proyecto con `↑` `↓` o pasando el ratón por encima.
2. `→` o `⏎` despliega sus conversaciones. Mientras te mueves, el panel derecho muestra **una vista previa**.
3. `⏎` sobre una conversación la **reanuda**. `＋ Nueva conversación` (o `n`) empieza una nueva en ese proyecto.
4. `F1` vuelve a la lista y `F2` al chat. Las conversaciones abiertas **siguen vivas** mientras cambias de una a otra (llevan un `●`).
5. `q` cierra Hopdeck. El historial queda guardado y se puede reanudar.

## Teclas

| Tecla | Acción |
|---|---|
| `↑` `↓` (o `j` `k`) | Moverte por la lista |
| `→` / `⏎` | Desplegar el proyecto / reanudar la conversación |
| `←` / `esc` | Volver |
| `n` | Nueva conversación en el proyecto seleccionado |
| `o` | **Elegir una carpeta** y abrir un chat ahí ([ver abajo](#elegir-una-carpeta)) |
| `/` | Buscar por proyecto o título (`Tab` busca también dentro del texto) |
| `Ctrl+P` / `F5` | **Salto rápido** entre todas las conversaciones de todos los proyectos |
| `F1` / `F2` | Foco en la lista / en el chat |
| `c` / `F6` | Cerrar el chat abierto |
| `i` / `F7` | Ver las imágenes de la conversación |
| `p` | Fijar el proyecto arriba (★) |
| `x` / `H` | Ocultar el proyecto / mostrar ocultos y archivadas |
| `R` | Renombrar la conversación |
| `a` | Archivar / desarchivar la conversación (no se borra nada) |
| `[` `]` | Estrechar / ensanchar la lista |
| `F3` | Apagar/encender el ratón (para seleccionar texto con el terminal) |
| `F4` | Ocultar/mostrar la lista para dar todo el ancho al chat |
| `r` · `?` · `q` | Recargar · ayuda · salir |

En todas las cajas de texto puedes mover el cursor con `←` `→`, ir al principio/final con `Inicio`/`Fin`, borrar con `Supr` y vaciar hasta el inicio con `Ctrl+U`.

## Funciones

### Vista previa al pasar el cursor

Sin ningún chat abierto, el panel derecho muestra los últimos mensajes de la conversación seleccionada. Con el ratón basta **pasar el cursor** por la lista, sin hacer clic.

### Elegir una carpeta

![Selector de carpetas](docs/screenshots/03-selector-de-carpetas.svg)

Pulsa `o` para abrir un chat en **cualquier carpeta**, tenga o no historial, sin escribir rutas:

| Tecla | Acción |
|---|---|
| `↑` `↓` | Moverte |
| `⏎` / `→` | **Entrar** a la carpeta resaltada (para seguir buscando dentro) |
| `espacio` | **Abrir un chat** en la carpeta resaltada, sin entrar |
| `✔ Abrir chat aquí` | Abrir un chat en la carpeta que estás viendo |
| `←` | Subir un nivel (en Windows, desde la raíz lista las unidades) |
| `/` | Filtrar las carpetas escribiendo |
| `.` | Mostrar / ocultar las carpetas ocultas |
| `~` | Volver a tu carpeta de usuario |
| `n` o `＋ Nueva carpeta aquí…` | Crear una carpeta escribiendo solo el nombre (pide confirmar con un segundo `⏎`) |

Empieza siempre en `~`. Las carpetas que usaste hace poco aparecen arriba (`↻ reciente`).

### Salto rápido

![Salto rápido con Ctrl+P](docs/screenshots/05-salto-rapido.svg)

`Ctrl+P` busca entre **todas** las conversaciones de **todos** los proyectos (título, proyecto y primer mensaje). `⏎` la abre directamente.

### Imágenes del chat

![Cuadro flotante con la imagen al pasar el cursor por [Image #1]](docs/screenshots/04-hover-imagen.svg)

- Si en un chat ves `[Image #3]` (una imagen que ya enviaste), **pasa el cursor por encima** y aparece un cuadro con esa imagen, sin tapar el resto del chat.
- `i` / `F7` abre una **galería** con todas las imágenes de la conversación (`← →` navegan, `o` la abre en el visor del sistema, `Esc` cierra).
- Una imagen recién pegada y aún sin enviar **no** se puede mostrar: todavía no está en el historial.

### Estado de los chats

- Un chat nuevo aparece al instante en la lista (`● Nueva conversación`), aunque la carpeta aún no tenga historial.
- Cada chat muestra su estado: un indicador mientras Claude trabaja, `●` cuando espera y `✔` cuando terminó mientras mirabas otro. Al terminar suena la campanilla y sale un aviso de escritorio (se apaga en la configuración).
- Al volver a abrir Hopdeck recuerda el proyecto y la conversación donde estabas.

### Scroll y copiar

- **Scroll** en el chat: rueda del ratón o `PgUp` / `PgDn`; `End` o escribir algo te devuelve al final.
- **Copiar:** arrastra con el ratón sobre el chat y el texto queda en el portapapeles. `F3` apaga el ratón si prefieres seleccionar con el terminal (o usa `Shift`+arrastrar).

### Otros detalles

- Se muestra la **rama de git** del proyecto y la lista se refresca sola.
- `hopdeck --list` imprime los proyectos en texto plano. `hopdeck <argumentos>` pasa esos argumentos a `claude` al abrir chats (por ejemplo `hopdeck --model opus`).
- Disponible en **español e inglés** (sigue el idioma del sistema).

## Compatibilidad

| Sistema | Funciona con | Notas |
|---|---|---|
| **Windows** | PowerShell, CMD, Windows Terminal | Todas las funciones. Es donde más se ha probado. |
| **macOS / Linux** | Cualquier terminal con color | Con `tmux` instalado usa paneles de tmux (la lista responde a la rueda y al clic, pero sin vista previa al pasar el cursor ni imágenes del chat); sin `tmux`, usa un terminal integrado con todas las funciones. |
| **WSL** | Igual que Linux | Lee el historial de WSL, que es distinto del de Windows (ver [problemas frecuentes](#problemas-frecuentes)). |

## Configuración

Casi nunca hace falta tocar nada. Lo más útil:

| Variable de entorno | Efecto |
|---|---|
| `HOPDECK_LANG` | `es` o `en` (por defecto, el idioma del sistema) |
| `HOPDECK_THEME` | `light` para fondos claros |
| `NO_COLOR` | Quita los colores |
| `CLAUDE_CONFIG_DIR` | Carpeta de Claude Code, si no es `~/.claude` |
| `HOPDECK_SKIP=1` | Salta Hopdeck una vez: `HOPDECK_SKIP=1 claude` |

Tus preferencias (proyectos fijados y ocultos, ancho de la lista, ratón…) se guardan solas en `~/.hopdeck.json`.

<details>
<summary>Opciones avanzadas</summary>

Claves de `~/.hopdeck.json` que puedes editar a mano:

| Clave | Para qué sirve | Por defecto |
|---|---|---|
| `notify` | Aviso de escritorio al terminar un chat | `true` |
| `mouse` | Ratón activado (`F3` lo alterna) | `true` |
| `sidebar` | Ancho de la lista (`[` y `]` lo ajustan) | automático |
| `maxImages` | Imágenes máximas por conversación en la galería | `200` |
| `previewMsgs` | Mensajes mostrados en la vista previa | `12` |

Otras variables: `HOPDECK_EMBED=1` fuerza el terminal integrado, `HOPDECK_NOTMUX=1` evita tmux y `HOPDECK_NOEMBED=1` lo desactiva; `HOPDECK_CONFIG` y `HOPDECK_CACHE` cambian las rutas de tus preferencias y de la caché.

</details>

## Privacidad

- **No envía nada a internet.** Sin telemetría, sin analítica, sin peticiones de red. Todo ocurre en tu equipo.
- Lee tu historial local de Claude Code y lanza el `claude` que ya tienes. No toca tu sesión ni tus credenciales.
- Solo escribe sus preferencias y su caché (en tu carpeta de usuario), el bloque de `hopdeck install` en tu perfil de shell y, si renombras una conversación, el título de esa conversación.

Más detalles, y cómo avisar de un problema de seguridad: [SECURITY.md](SECURITY.md).

## Problemas frecuentes

Empieza siempre por `hopdeck doctor`.

**`Ctrl+V` no pega imágenes (Windows Terminal).** Windows Terminal se queda con `Ctrl+V` para pegar texto. Opciones:
- Usa **`Alt+V`**, que pega la imagen en Claude sin tocar nada.
- O reasigna `Ctrl+V`: en *Configuración → Abrir archivo JSON*, dentro de `"actions"`, añade
  `{ "command": { "action": "sendInput", "input": "\u001bv" }, "keys": "ctrl+v" }`
  y quita `ctrl+v` de la acción de pegar. El texto se sigue pegando con `Ctrl+Shift+V`.

**No veo una conversación que acabo de tener.** Hopdeck lee el historial del sistema donde se ejecuta. Si usas Claude Code en **WSL y en Windows**, cada uno tiene su propio historial, y Hopdeck de Windows no ve lo que hiciste en WSL (ni al revés). Un chat nuevo aparece en la lista enseguida, pero su conversación solo se enlaza cuando Claude la guarda (tras tu primer mensaje).

**La rueda del ratón no mueve el chat.** Funciona con el historial del chat y con Claude en pantalla completa. Si no responde, usa `PgUp` / `PgDn`.

**No puedo seleccionar texto con el ratón.** Pulsa `F3` para apagar el ratón de Hopdeck, o mantén `Shift` mientras arrastras.

**Quiero que `claude` vuelva a ser el de siempre.** `hopdeck uninstall`, o `HOPDECK_SKIP=1 claude` para saltarlo una vez.

**Se ve mal en mi terminal.** Prueba `HOPDECK_THEME=light` (fondo claro) o `NO_COLOR=1`.

## Colaborar y licencia

¿Quieres ayudar o ver cómo está hecho? Mira [CONTRIBUTING.md](CONTRIBUTING.md). Historial de cambios: [CHANGELOG.md](CHANGELOG.md).

[MIT](LICENSE) © 2026 fabriciodev26. Las dependencias conservan sus propias licencias ([detalle](THIRD_PARTY_NOTICES.md)).
