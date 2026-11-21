# Política de seguridad

## Qué hace (y qué no) este programa con tus datos

- Lee el historial local de Claude Code (`~/.claude/projects`, o `CLAUDE_CONFIG_DIR`). En modo Codex, consulta `thread/list` y las vistas previas mediante `codex app-server` por stdin/stdout; no abre puertos ni modifica sus bases de datos. Hopdeck no añade telemetría, analítica ni peticiones de red propias. Las CLI de Claude y Codex conservan sus conexiones y ajustes habituales.
- Las imágenes de Codex se leen de sus adjuntos en la API local o de los archivos locales referenciados. Solo se aceptan archivos regulares con cabeceras de imagen reconocidas, de hasta 18 MB por imagen; no se descargan URL remotas ni se abren rutas de red.
- Escribe solo en tu equipo:
  - `~/.hopdeck.json` (preferencias: proyectos fijados, ocultos, recientes…) y `~/.hopdeck-cache.json` (índice de títulos y primeros mensajes, con permisos solo para tu usuario).
  - `~/.hopdeck-codex.json` para las preferencias, títulos personalizados y archivados locales del modo Codex. Renombrar o archivar aquí no cambia las conversaciones de Codex.
  - Una carpeta temporal privada con las imágenes cuando abres la galería con `o` (se borra al salir).
  - Con `hopdeck shortcut on`, un bloque marcado en el perfil de tu shell (`~/.bashrc`, `~/.zshrc`, perfil de PowerShell…). Antes guarda una copia `<perfil>.hopdeck-backup` (la primera, sin sobrescribirla). `hopdeck shortcut off` quita el bloque.
  - `hopdeck uninstall` (siempre con tu confirmación, o `--yes`) quita ese bloque, borra tus preferencias y la caché, y ejecuta `npm uninstall -g hopdeck`. No toca tu historial de Claude Code ni las copias de seguridad de los perfiles.
  - Al renombrar una conversación (`R`), añade una línea `custom-title` al final de su archivo `.jsonl`, igual que hace Claude Code.
- Ejecuta el comando `claude` o `codex` que encuentre en tu `PATH`. Si alguien puede cambiar tu `PATH`, puede cambiar qué se ejecuta (como con cualquier programa).
- Lo que se muestra en pantalla procedente del historial (títulos, mensajes, rutas) se limpia de caracteres de control y secuencias de escape antes de dibujarse.
- Un clic sobre una URL del chat abre el navegador predeterminado. Solo se aceptan enlaces HTTP/HTTPS, que se pasan como un argumento al programa del sistema sin usar un intérprete de comandos.

## Versiones con soporte

Se corrigen las vulnerabilidades en la última versión publicada.

## Cómo avisar de una vulnerabilidad

Por favor **no abras un issue público**. Usa el aviso privado de GitHub (*Security → Report a vulnerability*) del repositorio, o escribe al autor por el medio de contacto indicado en el perfil de GitHub.
Intenta incluir: versión (`hopdeck doctor`), sistema operativo y terminal, pasos para reproducirlo y el efecto que observas.
Responderé en cuanto pueda y avisaré cuando haya una versión corregida.
