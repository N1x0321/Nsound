# Fase 1 — Auditoría (rama experimental, solo lectura)

Auditado sobre el repositorio real (rama `claude/experimento-motores-ios-f23fb5`, desde `main`). La descripción «habitual» del encargo no coincide del todo con Nsound: lo indicado abajo es lo que **existe**.

## Archivos encontrados
| Pieza | Dónde | Notas |
|---|---|---|
| Página única | `app/src/index.template.html` → `app/dist/index.html` | `app/build.mjs` une CSS y JS en un solo HTML. No hay `index.html` ni `manifest` web en la raíz (no es PWA instalable). |
| Service worker | `app/src/sw.js` | Cachea solo la navegación (`./`); nunca llamadas a YouTube. |
| Reproductor actual | `app/src/js/03-player.js` | YouTube IFrame API oficial en `#yt` + `<audio/video id="html5">` para catálogo libre. Ya usa `loadVideoById` sobre una instancia. |
| UI, cola, aleatorio/repetir | `app/src/js/04-app.js`, `00-queue.js` | `LS.pickNextIndex`; reanudación automática al bloquear. |
| Origen musical (YouTube Music) | `00-core.js` (`LS.MUSIC_*_URL`, parsers), `04-app.js` (`src:'yt'`) | Búsqueda de YT Music por la API interna de la web; **reproducción siempre con el reproductor oficial incrustado**. |
| «Vídeos normales» | mismo `03-player.js`/`04-app.js` (`audioOnly`, `showVideo`, `videoMode`) | **No es un apartado con almacenamiento ni reproductor propios**: comparte reproductor y cola con la música; solo cambia `audioOnly`. |
| Almacenamiento | `01-stores.js` (`localStorage`, claves `ls.*`) | Ajustes, biblioteca (favoritos), listas, historial, descargas, caché. **No hay usuarios ni cuentas.** |
| Catálogo | `00-catalog.js`, `catalog/catalog.json` | Independiente; no se toca. |
| iPhone | `ios/` (Swift, WKWebView), `ios/project.yml` | Experimento con id `…LibreStream.motores`. |
| Experimento previo (esta rama) | `03-router.js`, `03-covers.js`, `test/engines.test.mjs` | EngineRouter y `proxifyCover` (apagados salvo en la app de pruebas). |

## Archivos modificables / modificados en este bloque
- **Nuevos**, todos en `app/src/experimental/`: `playerManager.js`, `stateManager.js`, `networkManager.js`, `index.js`, este informe; test `app/test/experimental.test.mjs`.
- **Tocados (mínimo):** `app/build.mjs` (incrusta `experimental/*.js` tras el JS normal) y `ios/LibreStream/Shell/WebShell.swift` (inyecta `ENABLE_EXPERIMENTAL_PLAYER = true` solo si el bundle id acaba en `.motores`).
- **Intactos:** catálogo, `01-stores.js`, `03-player.js`, `04-app.js` (en este bloque), `sw.js`, Android, Windows.

## Aislamiento
- Flag `ENABLE_EXPERIMENTAL_PLAYER`: solo `=== true` lo activa; sin él `NSoundExperimental.create()` devuelve `null` y el código incrustado es inerte. Navegador, Android y Windows no lo reciben nunca.
- Claves propias `nsound_experimental_state` y `nsound_experimental_state_backup`; no se lee ni escribe `ls.*`.
- Contenedor propio: `PlayerManager` rechaza el id `yt` (el del reproductor actual).

## Dependencias
Solo la API oficial `https://www.youtube.com/iframe_api` (la misma que ya usa la app) y `localStorage`. Sin librerías nuevas. CSP: ya permitido por la app actual.

## Riesgos y conflictos
1. **Dos reproductores a la vez.** Si el experimental y el actual suenan juntos se oyen dos pistas. Mitigación pendiente (fuera de este bloque): al integrar, parar uno antes de arrancar el otro.
2. **Vídeos normales comparten reproductor con la música** (ver arriba). El experimental solo acepta pistas sin `kind:'video'`, pero el código actual no marca ese campo: al integrar habrá que marcar los vídeos o filtrar por `audioOnly`/origen.
3. **Segundo plano en iPhone.** Un `<iframe>` de YouTube sigue dentro de un WebView: iOS puede pausarlo al bloquear. El experimental reintenta (Fase 4) pero **no lo evita**.
4. **Reintento con `loadVideoById`** reinicia la carga de la pista (breve silencio); es inevitable sin motor nativo.
5. **`localStorage` en WKWebView** puede vaciarse bajo presión de espacio; hay copia de seguridad pero vive en el mismo almacén.
6. **El 5 s de guardado** coincide con otros temporizadores de la app (medio segundo del reproductor actual): coste de escritura bajo (una clave), sin impacto medible esperado, no medido en un iPhone.
7. **Duplicación de lógica** con `03-player.js`/`00-queue.js` (cola, aleatorio, repetir): deliberada para no alterar lo publicado.

## Qué NO está hecho
- La UI no usa todavía los gestores (no hay botones ni cableado en `04-app.js`): integrarlo es una fase posterior.
- Nada se ha probado en un iPhone real; solo tests automáticos con un reproductor YouTube simulado.
