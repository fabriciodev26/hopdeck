# Cambios

## 1.2.1

### Corregido
- **Conversaciones que no aparecían en la lista** (y por tanto tampoco mostraban sus imágenes al pasar el cursor): Hopdeck solo leía los primeros 64 KB de cada archivo para sacar el título. Si el primer mensaje llevaba una imagen (cientos de KB) y Claude aún no había guardado un título, la conversación se descartaba. Ahora lee el principio del archivo por bloques, hasta 4 MB, hasta encontrar el primer mensaje.
- **Las cachés guardadas con la versión anterior se reconstruyen**, para que ese arreglo llegue también a quien ya tenía la lista cacheada.
- **Imágenes duplicadas en la galería:** Claude Code guarda cada imagen otra vez en una línea interna (`api-request-blob`). Ya no se cuentan dos veces.
- **Hover de imagen en un chat nuevo:** si todavía no se había enlazado con su conversación, podía mostrar la imagen de otra conversación del mismo proyecto cuando coincidía el número. Ahora solo toma una conversación creada después de abrir el chat.
- **Detección de `[Image #N]`:** calcula bien la columna con caracteres anchos delante (emoji, CJK) y acepta espacios no separables.

## 1.2.0 · primera versión pública

### Nuevo
- **Instalación en un solo comando:** la primera vez que se abre, Hopdeck pregunta si escribir `claude` debe abrirlo (con copia de seguridad del perfil). Responder "No" se recuerda y "Más tarde" no cuenta; no pregunta si el atajo ya está instalado. `HOPDECK_NOPROMPT=1` lo desactiva.
- **Vista previa al pasar el cursor:** con el ratón basta pasar por la lista para ver la conversación; ya no hace falta moverse con las flechas.
- **Imágenes en el chat:** al pasar el cursor sobre un `[Image #N]` de un mensaje ya enviado aparece un cuadro flotante con esa imagen, pegado a la marca y sin tapar el resto del chat. Funciona también con imágenes más allá de las 200 de la galería (se busca en todo el historial).
- **Selector de carpetas (`o`):** se navega desde `~` con flechas (`⏎` entra, `←` sube, `espacio` abre un chat en la carpeta resaltada). `/` filtra, `.` muestra las ocultas, `~` vuelve al inicio, y en Windows `←` desde la raíz lista las unidades. Las carpetas usadas recientemente salen arriba. `＋ Nueva carpeta aquí…` crea una carpeta escribiendo solo el nombre (pide confirmar).
- **Chats nuevos en la lista:** un chat abierto en una carpeta sin historial aparece al instante bajo su proyecto y se enlaza con su conversación cuando Claude la guarda.
- **Cajas de texto con cursor** (`o`, `R`, `/`, `Ctrl+P`): `← →`, `Inicio`/`Fin`, `Supr` y `Ctrl+U`.
- **Rueda del ratón sobre el chat:** si Claude usa pantalla completa o captura el ratón, la rueda se le reenvía (flechas o eventos de ratón). La barra inferior muestra la posición al hacer scroll (`↑ 12 líneas (40%)`).
- **`hopdeck doctor` revisa Windows Terminal:** avisa si `Ctrl+V` solo pega texto (no deja pegar imágenes en Claude) y muestra la línea de `settings.json` que lo arregla.
- **`hopdeck install` guarda una copia de seguridad** del perfil de shell (`<perfil>.hopdeck-backup`) antes de modificarlo por primera vez, y no la sobrescribe. `hopdeck uninstall` ya no toca ni crea archivos que no tengan el atajo.
- Límites ajustables en `~/.hopdeck.json`: `maxImages` (200 por defecto, antes 40) y `previewMsgs` (12, antes 8).

### Seguridad
- **Texto del historial saneado:** títulos, mensajes y rutas procedentes del historial se limpian de caracteres de control y secuencias de escape (cambiar el título del terminal, escribir en el portapapeles con OSC 52, borrar la pantalla…) y de controles de dirección Unicode antes de dibujarse, en las notificaciones y en `hopdeck --list`.
- **Imágenes exportadas:** la extensión del archivo se decide por los bytes reales de la imagen y no por el `media_type` del historial (un resultado de herramienta podía declarar `image/exe` y acabar guardado y abierto con `o`). Lo que no es una imagen reconocible se guarda como `.bin` y no se abre.
- **Carpetas temporales privadas y aleatorias** para las imágenes (se borran al salir) y para la configuración de tmux, en lugar de nombres fijos en `/tmp` que otro usuario del equipo podía anticipar.
- La caché y las preferencias se crean con permisos solo para el usuario.
- Solo se reanudan sesiones con un identificador normal (`[A-Za-z0-9._-]`), porque sale del nombre de un archivo.
- `notify-send` recibe `--` antes del mensaje para que un texto que empiece por `-` no se tome como opción.

### Corregido
- **Requisito: Node.js 22 o superior.** En Windows, Node 18 y 20 no entregan al programa los eventos de ratón (hover, clics y rueda), así que no se pueden soportar. `hopdeck doctor` avisa si tu Node es anterior.
- **Teclas F1–F5 con Node 18 en Windows:** llegaban con la forma de la consola de Linux (`ESC [ [ A`…) y se reenviaban al chat como texto. Ahora se reconocen (también en la consola real de Linux).
- **Ratón en el modo tmux** (el que se usa por defecto en macOS, Linux y WSL con tmux): la lista no respondía a la rueda ni a los clics, porque tmux solo reenvía el ratón a los paneles que lo piden. Ahora la rueda mueve la lista y un clic despliega o abre la conversación (también en el selector de carpetas y en el salto rápido). `F3` lo apaga.
- **Lentitud en WSL:** la rama de git se leía en cada dibujo (unos 4 ms cada vez desde `/mnt/c`) y `claude` se buscaba en todo el `PATH` cada vez que abrías un chat (hasta ~120 ms con las rutas de Windows). Ahora la rama se guarda 3 s y la ubicación de `claude` se recuerda.
- Teclas desconocidas (`Supr`, F-teclas…) ya no insertan caracteres basura en las cajas de texto.
- Los redibujados por movimiento del ratón se agrupan, para que el hover no ralentice en equipos lentos.

### Interno
- CI: job de `npm audit` y de comprobación del contenido del paquete, ejecución semanal programada, permisos mínimos y cancelación de ejecuciones repetidas. Dependabot propone actualizaciones de dependencias y acciones cada semana.
- Plantillas de issues (error e idea, en español e inglés) y de pull request con la lista de comprobación de seguridad.
- El código se divide en módulos (`lib/`): `i18n`, `style`, `text`, `history`, `images`, `keys` y `windows-terminal`. `bin/hopdeck.js` conserva la interfaz y el estado compartido.
- Nuevas pruebas: edición de texto, detección de Windows Terminal, selector de carpetas, imágenes numeradas, chats nuevos y una batería de interfaz en un PTY real (`test/ui.test.js`). La prueba de extremo a extremo ya funciona al ejecutarla desde WSL.
