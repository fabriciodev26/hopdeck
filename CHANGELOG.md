# Cambios

## 1.3.1

### Nuevo
- **Cambiar de tema en caliente: `t` o `F9`.** Alterna entre el tema claro y el oscuro sin reiniciar: se repinta todo al instante (lista, chat, panel de git, cuadros) y se recuerda para la próxima vez. Cambia los colores de Hopdeck, no el fondo de tu terminal: úsalo cuando cambies el tema de tu terminal.
- **`hopdeck theme light|dark|auto`:** lo mismo desde la línea de comandos (`hopdeck theme` solo muestra el actual). La variable `HOPDECK_THEME` sigue mandando sobre lo guardado.

## 1.3.0

### Nuevo
- **Panel de git (F8 o `b`):** un tercer panel de solo lectura a la derecha del chat con la rama actual (y lo que lleva por delante o por detrás del remoto), los cambios sin guardar, las ramas recientes y la **actividad de ramas** (cambios de rama, ramas creadas y merges, desde el reflog de git; los de los últimos 10 minutos se destacan). Se refresca solo, no modifica el repositorio y solo aparece si caben unas 140 columnas. Solo en el terminal integrado. En macOS no se llama a `git` si solo existe el atajo que abre el instalador de Apple.

### Mejorado
- **La búsqueda dentro del contenido (`/` y Tab) es unas 10 veces más rápida:** con 2,2 GB de historial pasó de unos 35 s a unos 3,5 s en el peor caso. Se hace en hilos de trabajo en paralelo, sin decodificar el texto, y las conversaciones aparecen en la lista según se encuentran. Además ya no se saltan los archivos de más de 40 MB (ahora el límite es 256 MB), que suelen ser las conversaciones más largas.
- **La codificación de imágenes Sixel es unas 10 veces más rápida** (el recorte de colores recalculaba todas las cajas en cada paso).
- **La búsqueda resalta las coincidencias** en los nombres de proyecto y en los títulos; si una conversación aparece porque la coincidencia está dentro de su texto, lleva un `⌕`.
- **Resumen de chats abiertos en la cabecera de la lista:** `⠋` trabajando, `✔` terminados sin ver, `●` abiertos. La ayuda (`?`) explica los símbolos.
- **Capturas del README en claro y oscuro:** se muestra la que corresponde al tema de quien lee.

## 1.2.6

### Mejorado
- **Lista más legible:** el número de conversaciones de cada proyecto destaca y se separa de «hace cuánto» con un punto; los proyectos plegados se atenúan y el desplegado lleva la flecha en color.
- **Vista previa más rica:** una fila de resumen («hace 3 h · últimos 6 mensajes»), tus mensajes con `›` en violeta y los de Claude con `●` en naranja.
- **Barra de ayuda contextual:** muestra solo las teclas que sirven para lo seleccionado (proyecto: desplegar y fijar; conversación: reanudar y renombrar).
- **Pantalla de bienvenida** con las teclas principales cuando no hay nada abierto.
- **Icono** del proyecto (`docs/icon.svg` y `docs/icon.png`) para el avatar del repositorio.

## 1.2.5

### Cambiado
- **En Linux y macOS el terminal integrado es ahora el modo por defecto**, también con `tmux` instalado, para que la vista previa al pasar el cursor y las imágenes funcionen igual que en Windows. El modo tmux sigue disponible con `HOPDECK_TMUX=1` y se usa solo si el terminal integrado no está disponible.
- **La vista previa de imagen es más pequeña** (como mucho 36×9 celdas): es una vista rápida, no un visor. Para verla en grande, clic sobre `[Image #N]`.
- **En Windows Terminal el Sixel se activa sin esperar la respuesta del terminal**, que no siempre atraviesa ConPTY. `HOPDECK_SIXEL=0` lo apaga.
- **Logotipo con el texto convertido a trazados** (Inter 800): se ve igual en cualquier equipo y en la página de npm. Se añaden copias PNG en `docs/`.

## 1.2.4

### Nuevo
- **Imagen real al pasar el cursor por `[Image #N]`** en terminales con Sixel (Windows Terminal 1.22 o posterior, iTerm2, WezTerm, foot, Konsole…). Hopdeck pregunta al terminal si lo admite y, si es así, dibuja la imagen con todos sus píxeles dentro del cuadro del hover; el texto del chat que queda debajo se repinta al apartar el cursor. Si no lo admite se mantiene la vista de bloques. `HOPDECK_SIXEL=1` lo fuerza y `HOPDECK_SIXEL=0` lo desactiva.
- **Clic en `[Image #N]` abre la imagen en grande** en el visor de imágenes del sistema, a su tamaño real. La vista rápida del terminal solo puede dibujar dos píxeles por carácter: una captura de pantalla de 1917 px de ancho quedaba en unos 50 y no se podía leer. Arrastrar para copiar texto y hacer clic en otro texto siguen igual. El cuadro del hover avisa («clic: abrir en grande») y es algo más grande.

## 1.2.3

### Cambiado
- **`hopdeck uninstall` desinstala de verdad.** Antes solo quitaba el atajo de `claude` y Hopdeck seguía instalado (`hopdeck --version` seguía funcionando). Ahora quita el atajo de tu perfil, borra tus preferencias y la caché y desinstala el programa (`npm uninstall -g hopdeck`). Pregunta antes; sin terminal exige `--yes`. No toca tu historial de Claude Code ni las copias de seguridad de tus perfiles.
- **El atajo de `claude` se gestiona con `hopdeck shortcut on` y `hopdeck shortcut off`** (antes `hopdeck install` y `hopdeck uninstall`).
- **Una sola forma para cada comando:** `hopdeck shortcut on|off`, `hopdeck uninstall`, `hopdeck doctor` y `hopdeck help`. Se retiran las variantes que la 1.2.2 aceptaba (`--install`, `--uninstall`, `--doctor` y los alias en español): ahora dan un error que sugiere el comando correcto, en lugar de ejecutarse.
- **Las erratas con guiones también avisan:** `hopdeck --unistall` abría Hopdeck en silencio y le pasaba esa opción a `claude`. Ahora una opción con guiones que se parece a un comando da el mismo error con sugerencia. Las opciones reales de `claude` (`--model`, `--resume`, `-p`…) se siguen pasando tal cual.

## 1.2.2

### Corregido
- **Una errata en un comando ya no abre Hopdeck:** `hopdeck unistall` abría la interfaz y le pasaba la palabra a `claude` como argumento, que se aplicaba a los chats que abrieras. Ahora una palabra que no es un comando da un error con una sugerencia («¿Quisiste decir "uninstall"?»). También se aceptan `--uninstall`, `--install`, `--doctor` y los alias `desinstalar`, `instalar`, `ayuda`, `version` y `list`. Lo que empieza por `-` sigue pasando a `claude`.

## 1.2.1

### Corregido
- **Conversaciones que no aparecían en la lista** (y por tanto tampoco mostraban sus imágenes al pasar el cursor): Hopdeck solo leía los primeros 64 KB de cada archivo para sacar el título. Si el primer mensaje llevaba una imagen (cientos de KB) y Claude aún no había guardado un título, la conversación se descartaba. Ahora lee el principio del archivo por bloques, hasta 4 MB, hasta encontrar el primer mensaje.
- **Las cachés guardadas con la versión anterior se reconstruyen**, para que ese arreglo llegue también a quien ya tenía la lista cacheada.
- **Imágenes duplicadas en la galería:** Claude Code guarda cada imagen otra vez en una línea interna (`api-request-blob`). Ya no se cuentan dos veces.
- **Hover de imagen en un chat nuevo:** si todavía no se había enlazado con su conversación, podía mostrar la imagen de otra conversación del mismo proyecto cuando coincidía el número. Ahora solo toma una conversación creada después de abrir el chat.
- **Detección de `[Image #N]`:** calcula bien la columna con caracteres anchos delante (emoji, CJK) y acepta espacios no separables.
- **Pregunta del primer arranque:** al responder, la pregunta se borra de la pantalla y deja una línea de resumen (antes se quedaba escrita como si siguiera pendiente), y el texto aclara que responder que no no impide abrir Hopdeck: el atajo solo afecta a lo que ocurre al escribir `claude`.
- **Aviso de tamaño mínimo:** decía 60×12 y el programa exige 70×12.

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
