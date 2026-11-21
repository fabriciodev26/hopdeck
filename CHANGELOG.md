# Cambios

## Sin publicar

### Arreglado
- Imágenes en el modo Codex: galería con `i` / `F7`, vista previa al pasar el cursor por `[Image #N]` y apertura con clic. Se leen adjuntos del historial y archivos locales, con soporte para la API anterior de Codex y para la numeración que vuelve a empezar en cada mensaje. Los mensajes que solo contienen imágenes también aparecen en la vista previa de la conversación.

## 1.5.4

### Nuevo
- La mascota adopta rasgos de mono más claros: orejas redondas, mechón y hocico, conservando los auriculares y los colores de Hopdeck. El dibujo también se actualiza en la terminal.
- Bienvenida al abrir cada modo de Hopdeck por primera vez, con la marca, la versión y los comandos para Claude/Codex y los atajos. Se recuerda al continuar, con español/inglés y respeto de `NO_COLOR`; no aparece en comandos informativos ni en automatizaciones.

## 1.5.3

### Arreglado
- En macOS, la selección del chat reconoce Command+C cuando el terminal lo reenvía como CSI u. Control+C y el clic derecho siguen disponibles. Se documenta la configuración de iTerm2 y Ghostty y la selección nativa para Terminal de Apple.

## 1.5.2

### Arreglado
- En Windows, al salir de Hopdeck se detienen los chats abiertos en el terminal integrado, evitando que procesos de Codex queden ejecutándose.

## 1.5.1

### Arreglado
- El historial de Codex se filtra por cliente de origen: solo Codex CLI, la aplicación de Codex y su extensión. Se excluyen las sesiones de Work y los orígenes desconocidos antes de agrupar proyectos, contar conversaciones o buscar.
- En Windows, al cerrar Hopdeck también se detiene el servidor de historial que inicia el lanzador npm de Codex, evitando que su proceso auxiliar mantenga abierto el terminal.

## 1.5.0

### Nuevo
- Primer soporte para Codex CLI: `hopdeck --provider codex`, proyectos y conversaciones mediante `codex app-server`, vistas previas, chats nuevos y reanudados con `codex resume`, y varios chats abiertos en el panel integrado.
- `hopdeck shortcut on` instala o actualiza los atajos de Claude y Codex. Con argumentos se ejecuta directamente la CLI correspondiente.
- Preferencias e historial separados por proveedor; los títulos y archivados de Codex se gestionan localmente en `~/.hopdeck-codex.json`.

### Límites de la primera versión
- Imágenes, estadísticas y búsqueda en el contenido completo permanecen en el modo Claude. Los indicadores de actividad de Codex dependen de su terminal.

## 1.4.3

### Arreglado
- **Teclas repetidas al pie de la lista.** La fila de la lista repetía `n nueva`, `/ buscar` y `? ayuda`, que ya dice la barra de abajo (`[/] buscar  [n] nueva …`). Ahora esa fila solo dice lo propio de la fila marcada: sobre un proyecto, `⏎ desplegar  p fijar  x ocultar`; sobre una conversación, `⏎ reanudar  R renombrar  a archivar`. También se quitaron los espacios que sobraban tras la última tecla y que hacían que se cortara con «…» aunque cupiera.

## 1.4.2

### Nuevo
- **Estadísticas de cada conversación en la fila del título**, a la derecha: `MSGS 2324 │ TOK 206.9M │ TOOLS 1249 │ opus`. Mensajes, tokens (entrada, salida y caché de cada mensaje de Claude), herramientas usadas y modelo; la rama de git sigue a la izquierda, junto al título. Salen en la vista previa al pasar el cursor y con el chat abierto. Si el panel es estrecho se quitan primero los campos menos importantes (TOOLS, luego el modelo). Se calculan en segundo plano (una conversación de 79 MB tarda unos 250 ms) y después solo se lee lo que Claude añade, como mucho cada 3 s.
- **Barra inferior con las teclas entre corchetes**, como `[/] buscar  [n] nueva  [Ctrl+P] saltar`. Cambia con el foco: con la lista activa muestra las teclas de letra, y con un chat abierto solo las F (`[F1] lista  [F3] copiar texto  [F4] ocultar lista  [F5] saltar  [F8] git  [F9] tema`), porque las letras son de Claude. A la derecha, los chats abiertos y cuántos proyectos y chats hay; ese resumen se omite si no caben las teclas enteras.
- **La mascota de Hopdeck, un sapo naranja con auriculares.** Sale en la pantalla de inicio (el panel derecho cuando no hay ningún chat abierto), encima del texto y del mayor tamaño que quepa; si el terminal es pequeño o usas `NO_COLOR`, se queda el texto de siempre. También en la pantalla de carga y en el panel de tmux. Y con el comando `hopdeck mascot` (`--size small|normal|large`, `--plain` para dibujarla sin colores). Va dentro del programa, sin archivos de imagen ni Python; en el README hay una imagen (`docs/mascot.png`).

## 1.4.1

### Cambiado
- **Seleccionar texto del chat ya no lo copia solo.** Al soltar, la selección se queda marcada y se copia con `Ctrl+C` o con el clic derecho; `Esc` o un clic en otro sitio la quitan (`Esc` no llega a Claude mientras hay algo seleccionado, porque lo interrumpiría). Quien prefiera el comportamiento anterior puede poner `"copyOnSelect": true` en `~/.hopdeck.json`.

### Arreglado
- **No se podía seleccionar más de lo que cabía en pantalla.** Al arrastrar contra el borde de arriba o de abajo del chat, este se desplaza solo (aunque el ratón se quede quieto) y la selección sigue. La selección ahora se ancla a las líneas del historial, no a las filas de la pantalla, así que también sigue en su sitio si usas la rueda mientras seleccionas.
- **El spinner de «trabajando» salía sin que Claude estuviera haciendo nada**, a veces en chats donde ni estabas. Hopdeck marcaba un chat como trabajando si escribía cualquier cosa en el último segundo, y eso también ocurre al mover o redimensionar los paneles (todos los chats se repintan), al cambiar de ventana o al actualizarse la barra de estado. Ahora solo cuenta como trabajando cuando la pantalla de Claude muestra «esc to interrupt», y el repintado justo después de redimensionar se ignora. Si una versión de Claude cambiara ese texto, `HOPDECK_BUSY=output` devuelve el criterio anterior.

## 1.4.0

### Nuevo
- **Ancho de los paneles con el ratón.** Agarra con el cursor la línea `│` que separa la lista del chat, o el chat del panel de git, y arrástrala a izquierda o derecha. Cada panel puede medir entre el 15 % y el 50 % del ancho del terminal (nunca menos de 20 columnas), el chat siempre conserva su ancho mínimo y el ancho se recuerda para la próxima vez. Solo en el terminal integrado (en tmux, arrastra el borde del panel como siempre).

### Mejorado
- **La búsqueda es más fácil de encontrar y falla menos.**
  - **Se ve de dónde parte:** arriba a la derecha de la lista hay siempre un `⌕ / buscar`; pulsando `/` (o haciendo clic en esa fila) el cuadro de búsqueda ocupa el lugar del título, arriba, y no en la última fila. El pie dice cuántos resultados hay, dónde se busca y qué teclas valen.
  - **`⏎` abre la conversación marcada en el momento:** al escribir se marca el primer resultado y `⏎` lo abre, sin tener que pulsar `⏎` dos veces como antes (el salto rápido `Ctrl+P` ya funcionaba así).
  - **Encuentra más:** las palabras valen en cualquier orden y sin importar mayúsculas ni acentos («vision roles» encuentra «Roles y visión»), y se comparan con el proyecto, el título y el primer mensaje. El salto rápido tampoco distingue acentos.
  - **Si no coincide ningún título, se busca sola dentro del contenido** de las conversaciones (ya no hace falta saber que `Tab` lo activa). Con `Tab` se fuerza también cuando sí hay coincidencias.
  - **Sin resultados lo dice:** «Sin resultados para …» y qué hacer, en lugar de una lista vacía.

### Arreglado
- **Una misma conversación aparecía varias veces** (con el mismo título y un `#xxxx` distinto). Cada vez que reanudas una conversación, o Claude Code la continúa tras agotar el contexto, crea un archivo nuevo que copia todo el historial anterior. Hopdeck ahora reconoce que comparten el primer mensaje, los junta en una sola fila y abre la que tiene el último mensaje, que ya contiene todo lo anterior. La fila lleva `↻N` (continuada N veces). El `#xxxx` queda solo para conversaciones realmente distintas con el mismo título. La fecha del archivo no sirve para elegir: también cambia al abrir una conversación vieja.
- **macOS: el cuadro del hover salía sin la imagen** cuando el formato no lo entendía el decodificador propio (WebP, GIF, HEIC, TIFF, PNG entrelazado o imágenes enormes). Ahora esas imágenes se convierten con `sips`, que viene con macOS. Y si aun así no se puede leer, el cuadro indica el formato («No se puede previsualizar este formato (image/webp)») para saber por qué.

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
