# Integración del modo experimental (Fases 9-12)

## Árbol final (`app/src/experimental/`)
```
config.js                  interruptor maestro: const ENABLE_EXPERIMENTAL_PLAYER = true;
experimentalBootstrap.js   orquesta todo (PWA Apple, rendimiento, motor de música, gestores)
playerManager.js           YouTube IFrame API oficial, una sola instancia
stateManager.js            guardado cada 5 s en nsound_experimental_*
networkManager.js          reconexión (3 s, máx. 5 intentos)
iosManager.js              visibilitychange/pageshow/pagehide/focus/blur
mediaSession.js            navigator.mediaSession
updateManager.js           comprobación cada minuto de version.json
sw-experimental.js         service worker (SWR, sin dominios de YouTube)
version.json               {"version":"1.0.0-beta"}
```
`app/assets-experimental.mjs` (fuera de esa carpeta) genera en `dist/experimental/` los iconos, las 12 pantallas de arranque y el manifest.

## Cómo se activa (nada que editar en `04-app.js`)
1. `node app/build.mjs` junta todo: el JS experimental va dentro de `dist/index.html`; `sw-experimental.js` va en `dist/` y `version.json`, iconos, splash y manifest en `dist/experimental/`.
2. La app de iPhone «Nsound Motores» (bundle id `org.librestream.LibreStream.motores`) inyecta `window.__LS_ENGINES__ = true` (enciende el EngineRouter) y `window.ENABLE_EXPERIMENTAL_PLAYER = true` (marca de la app de pruebas).
3. Al final del paquete, `experimentalBootstrap.js` arranca solo cuando `NSoundExperimental.enabled()` es verdadero:
   `config.ENABLE_EXPERIMENTAL_PLAYER === true` **y** (si `REQUIRE_NATIVE_FLAG` es true) la marca de la app de pruebas.
4. El arranque registra el motor `exp-yt` delante de los de siempre en el router. Solo acepta pistas con `src:'yt'`, `kind !== 'video'` y `audioOnly:true`; el resto (vídeos normales, catálogo libre) sigue por `YouTubeEngine`/`Html5Engine`.

## Apagar
- `const ENABLE_EXPERIMENTAL_PLAYER = false;` en `config.js` y recompilar: no se inyecta nada, no se registra ningún service worker, no se intercepta nada.
- Sin la marca de la app de pruebas (Android, Windows, web publicada, app buena de iPhone) tampoco se activa aunque la constante sea true.

## Probar en un navegador de escritorio
`REQUIRE_NATIVE_FLAG: false` en `config.js`, y abrir con `__LS_ENGINES__` activo (consola: `window.__LS_ENGINES__ = true` antes de cargar, p. ej. con un script de arranque). Sin el router solo se aplican PWA, rendimiento, actualización y service worker.

## Qué no está resuelto
- Los gestores `stateManager`/`iosManager`/`updateManager` guardan una cola de una sola pista cuando van integrados (la cola real es de la app); por eso en modo integrado no restauran ni reanudan por su cuenta.
- La app no avisa al motor de cuál es la siguiente pista, así que la precarga lógica de la siguiente solo precarga su miniatura si algo llama a `prepare()`; hoy nada lo hace.
- Service worker y actualización automática no existen dentro de la app de iPhone (WKWebView sin service workers): solo valen en la web alojada con https.
- Sin probar en iPhone/iPad reales.
