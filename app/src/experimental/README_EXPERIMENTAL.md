# Nsound · rama experimental (NO PRODUCCIÓN)

Rama: `claude/experimento-motores-ios-f23fb5` (sale de `main`; nada de esto está en `main`, ni publicado, ni etiquetado).
Todo el código nuevo vive en `app/src/experimental/` y solo se activa en la app de iPhone de pruebas **«Nsound Motores»**
(`org.librestream.LibreStream.motores`). Apagado, Nsound funciona exactamente igual que antes.

> **Estado honesto:** probado solo con tests automáticos (97) y un YouTube/DOM simulados. **No** se ha probado en un iPhone, iPad, Safari ni Chrome iOS reales.

## 1. Archivos creados
| Archivo | Para qué |
|---|---|
| `app/src/experimental/config.js` | Interruptor maestro `const ENABLE_EXPERIMENTAL_PLAYER = true;` y ajustes |
| `app/src/experimental/experimentalBootstrap.js` | Orquesta todo; PWA Apple (Fase 9); rendimiento (Fase 10); motor que intercepta solo la música (Fase 12); `NSoundExperimental.debug()` |
| `app/src/experimental/migration.js` | Copia de seguridad y migración segura; almacenamiento con candado (Fase 13) |
| `app/src/experimental/playerManager.js` | Reproductor: YouTube IFrame API oficial, una instancia, `loadVideoById`, cola, aleatorio, repetir, errores |
| `app/src/experimental/stateManager.js` | Guarda cada 5 s en `nsound_experimental_*` y restaura |
| `app/src/experimental/networkManager.js` | Reconexión: guardar → 3 s → reintentar → mismo segundo; máx. 5 |
| `app/src/experimental/iosManager.js` | Ciclo de vida iOS: `visibilitychange`, `pageshow`, `pagehide`, `focus`, `blur` |
| `app/src/experimental/mediaSession.js` | `navigator.mediaSession` (pantalla de bloqueo, AirPods, Watch, Dynamic Island) |
| `app/src/experimental/updateManager.js` | Comprueba `version.json` cada minuto y recarga conservando el estado |
| `app/src/experimental/sw-experimental.js` | Service worker, Stale While Revalidate, sin dominios de YouTube |
| `app/src/experimental/version.json` | `{"version":"1.0.0-beta"}` |
| `app/src/experimental/INFORME-FASE-1.md` | Auditoría del repositorio |
| `app/src/experimental/nativeBridge.js` | Puente opcional con el contenedor iOS `ios-wrapper/` (solo se activa si existe `nsoundAudio`) |
| `ios-wrapper/` | Contenedor nativo Swift opcional (ver `ios-wrapper/README.md`) |
| `app/assets-experimental.mjs` | Genera iconos, 12 pantallas de arranque y manifest en `dist/experimental/` |
| `app/src/js/03-router.js`, `03-covers.js` | EngineRouter y `proxifyCover` (bloque 0; `proxifyCover` apagado y sin conectar) |
| `app/test/*.test.mjs`, `app/test/run-all.mjs` | Pruebas (ver §8) |

## 2. Archivos modificados
| Archivo | Cambio |
|---|---|
| `app/build.mjs` | Incrusta `experimental/*.js` en el HTML (menos `sw-experimental.js`); copia el service worker y `version.json`; genera los recursos PWA |
| `app/src/js/04-app.js` | **Una línea:** `Player` pasa por el router solo si `LS.enginesEnabled`; si no, es `LS.Player` como siempre |
| `ios/project.yml` | Bundle id `org.librestream.LibreStream.motores`, nombre «Nsound Motores» |
| `ios/LibreStream/Shell/WebShell.swift` | Solo con id `…motores`: inyecta `__LS_ENGINES__` y `ENABLE_EXPERIMENTAL_PLAYER`, y hace la web inspeccionable (iOS 16.4+) |

Sin tocar: catálogo (`catalog/`, `00-catalog.js`), `01-stores.js`, `03-player.js`, `sw.js`, Android, Windows, workflows.

## 3. Funciones añadidas (API pública, `window.NSoundExperimental`)
`enabled()`, `bootstrap()`, `create(opts)`, `migrate(storage)`, `debug()`, `injectPwa(doc)`, `createSafeStorage(storage)`; clases `PlayerManager`, `StateManager`, `NetworkManager`, `IOSManager`, `MediaSessionManager`, `UpdateManager`, `Migration`, `Perf`.
Router: `LS.engines.wrap(raw)`, `EngineRouter.register(engine, first)`; `LS.engines.current` guarda la fachada.

## 4. Separación: catálogo / vídeos normales / música experimental
- **Catálogo libre** (`src:'cat'`): `canPlay` del motor experimental devuelve `false` → reproductor HTML5 de siempre.
- **Vídeos normales** (`kind:'video'` o sin `audioOnly`): `false` → reproductor de YouTube de siempre (`#yt`).
- **Música YT Music** (`src:'yt'`, `kind !== 'video'`, `audioOnly:true`): único caso que toma el motor `exp-yt`.
- El motor experimental usa **su propio** iframe (`#exp-player`, 2×2 px invisible, como el modo solo audio actual); nunca toca `#yt`.
- Al cambiar de música a vídeo (o al revés), el router **para** el motor anterior: nunca suenan dos.
- Datos: solo se escriben claves `nsound_experimental_*`. Un candado (`createSafeStorage`) rechaza cualquier otra escritura y una huella comprueba que `ls.*` no cambió.
- La cola, aleatorio y repetir son **de la app**; el motor reproduce la pista que se le pide.

## 5. Instalación (iPhone de pruebas)
1. `node app/test/run-all.mjs` → todo en verde.
2. `node app/build.mjs`.
3. Compilar el IPA sin firmar (no publica nada): `gh workflow run build-ipa.yml -R N1x0321/Nsound --ref claude/experimento-motores-ios-f23fb5`.
4. Descargar el artefacto: `gh run download <id> -R N1x0321/Nsound -n LibreStream-ipa -D <carpeta>`.
5. Instalar con Sideloadly/AltStore/SideStore. Al tener otro bundle id, **convive** con la app buena sin pisarla.

## 6. Reversión
- **Apagar sin desinstalar:** `config.js` → `const ENABLE_EXPERIMENTAL_PLAYER = false;`, recompilar. No se inyecta, registra ni intercepta nada.
- **Quitar la app:** borrar «Nsound Motores» (la app buena no se ve afectada).
- **Limpiar datos propios** (consola de Safari de la web):
  ```js
  Object.keys(localStorage).filter(k => k.startsWith('nsound_experimental_')).forEach(k => localStorage.removeItem(k));
  navigator.serviceWorker && navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
  caches.keys().then(ks => ks.filter(k => k.startsWith('nsound-exp-')).forEach(k => caches.delete(k)));
  ```
- **Restaurar una copia propia:** `new NSoundExperimental.Migration().listBackups()` y `.restore(clave)` (solo devuelve claves `nsound_experimental_*`).
- **Quitar la rama:** no se ha mezclado en `main`; basta con no fusionarla o borrarla.

## 7. Depuración en iOS / Safari
- **Safari en Mac:** iPhone → Ajustes → Safari → Avanzado → *Inspector web*; Mac → Safari → Ajustes → Avanzado → *Mostrar menú Desarrollo*; conectar con cable, menú **Desarrollo → [iPhone] → Nsound Motores**. La app de pruebas es inspeccionable (iOS 16.4+, `isInspectable`); si se firma con un perfil sin `get-task-allow` puede no aparecer: no verificado.
- En la consola: `NSoundExperimental.debug()` devuelve estado del reproductor, versión, migración y los registros de `network`, `ios` y `update`.
- Con `ENABLE_EXPERIMENTAL_PLAYER` apagado `debug()` responde `{running:false}`.
- `NSoundExperimental.lastMigration` explica por qué no arrancó (p. ej. `backup-failed`).
- Chrome iOS usa el mismo WebKit (CriOS): se detecta igual que Safari.

## 8. Pruebas
`node app/test/run-all.mjs` (97 pruebas). `node --test app/test/` a secas falla en Node 22+ (trata la carpeta como un archivo).
| Archivo | Cubre |
|---|---|
| `core.test.mjs` | Núcleo existente (46) |
| `engines.test.mjs` | Router: mismos eventos, cambio de motor, motor desconocido, `proxifyCover` |
| `experimental.test.mjs` | PlayerManager, StateManager, NetworkManager |
| `experimental2.test.mjs` | Media Session, iosManager, service worker, actualización por `version.json` |
| `experimental3.test.mjs` | Config, PWA, rendimiento, interceptación solo de música |
| `experimental4.test.mjs` | Migración y copia previa, candado de datos, restauración de cola/volumen/segundo, reconexión tras corte, ciclo de vida Safari/Chrome iOS/iPad, sesión completa sin tocar `#yt` ni `ls.*` |

Limitación: son simulaciones. No sustituyen la prueba en un dispositivo.

## 9. Publicación en GitHub Pages (no hecha; solo si decides hacerla)
Hoy Pages publica `catalog/*.json`, `schemas/` y `site/` (flujo `validate-catalog.yml`); **la interfaz web de la app no se publica allí** (solo existe en Render). Para publicar la versión web experimental:
1. `node app/build.mjs` y copiar `app/dist/` a una subcarpeta, p. ej. `_site/app-experimental/`, en un paso nuevo del flujo (no está añadido).
2. El service worker se registra con ruta relativa (`sw-experimental.js`), así que su alcance será esa subcarpeta, sin chocar con el resto del sitio.
3. Poner `REQUIRE_NATIVE_FLAG: false` en `config.js` para esa compilación; en la web no hay router, así que solo actúan PWA, rendimiento, service worker y actualizaciones (no el motor de música).
4. Para publicar una versión nueva: subir `version` en `version.json` **y** `BUNDLED_VERSION` en `updateManager.js` (un test comprueba que coinciden).
5. https es obligatorio para service workers. Dentro de la app de iPhone no hay service workers: ahí solo se actualiza con un IPA nuevo.

## 10. Activación / desactivación
| Dónde | Efecto |
|---|---|
| `config.js` → `ENABLE_EXPERIMENTAL_PLAYER` | Interruptor maestro |
| `config.js` → `REQUIRE_NATIVE_FLAG` (true) | Además exige la marca de la app «motores». Mantiene Android, Windows, la web y la app buena fuera del experimento aunque el maestro sea `true` |
| iOS (`WebShell.swift`) | Solo con bundle id `…motores` define `window.__LS_ENGINES__` y `window.ENABLE_EXPERIMENTAL_PLAYER` |

## 11. Limitaciones conocidas
- El audio de YouTube sigue dentro de un iframe en un WebView: iOS puede pausarlo en segundo plano. El modo experimental **lo detecta y reanuda**, con un silencio breve; no lo evita.
- Con el motor integrado, `stateManager` guarda una cola de una sola pista y `iosManager`/`updateManager` no restauran ni reanudan por su cuenta (manda la cola de la app).
- Dos Media Session: integrado, manda la de la app (`mediaSession.js` solo se arranca en modo independiente).
- La precarga lógica de la siguiente pista solo precarga su miniatura si algo llama a `prepare()`; la app hoy no lo hace.
- Los recursos PWA suman ~2 MB al IPA; las pantallas de arranque son fondo liso con el logo.
- Reintentar con `loadVideoById` recarga la pista (breve corte).

## 12. Lista final de verificación
- [ ] `node app/test/run-all.mjs` → 0 fallos.
- [ ] `node app/build.mjs` termina; `dist/sw-experimental.js` y `dist/experimental/{version.json,manifest.webmanifest,icons,splash}` existen.
- [ ] `git diff main --stat` no muestra cambios en `catalog/`, `windows/`, `android/`, `01-stores.js`, `03-player.js`, `sw.js`.
- [ ] `ENABLE_EXPERIMENTAL_PLAYER = false` → la app se comporta como la beta (sin `#exp-player` en el DOM).
- [ ] IPA instalado con otro id; la app buena sigue instalada y con sus datos.
- [ ] En el iPhone: música suena; vídeo normal sigue usando el reproductor de siempre.
- [ ] `NSoundExperimental.debug().migration.ok === true`.
- [ ] Bloquear/desbloquear con música: reanuda; cambiar de app y volver: reanuda en el segundo correcto (anotar cuánto dura el corte).
- [ ] Modo avión 10 s con música: se recupera sola (máx. 5 intentos); `debug().network` lo registra.
- [ ] Favoritos, historial, listas y ajustes idénticos antes y después.
- [ ] Nada publicado: sin tags, sin Releases, sin mezcla en `main`.
