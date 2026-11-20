# ios-wrapper · contenedor nativo ligero para NSound (EXPERIMENTAL, opcional)

Una app de iOS mínima (Swift, `WKWebView` + `AVAudioSession` en `.playback`) que **carga tu NSound web** y le da una sesión de audio nativa
con pantalla de bloqueo propia. Carpeta aislada: no modifica la web, el catálogo, favoritos, listas, ni el apartado de vídeos normales, y
no descarga ni guarda audio/vídeo en disco (lo único que descarga es la carátula, en memoria, de servidores de imágenes de YouTube/Google).

> **Lo que NO está verificado.** El código se compila en un flujo de macOS (ver §5) pero **no se ha probado en un iPhone/iPad**. Que un
> contenedor con `.playback` elimine los cortes de segundo plano **no está demostrado**: el iframe de YouTube sigue dentro de un
> `WKWebView` y la app de iPhone actual del repositorio (`ios/`) ya usa esa misma sesión de audio. Esto es una alternativa más sencilla
> para probar, no una garantía.

## 1. Arquitectura
```
 iPhone ── NSoundWrapper (Swift) ──────────────────────────────────────────────
           AppDelegate      AVAudioSession(.playback) activa; se reactiva tras llamadas/Siri
           SceneDelegate    ciclo de vida → background / foreground / active
           ViewController   WKWebView (inline, sin gesto para reproducir) ── carga https://TU-NSOUND/
           NowPlayingBridge MPNowPlayingInfoCenter + MPRemoteCommandCenter (pantalla de bloqueo, AirPods…)
                │  ▲
   webkit.messageHandlers.nsoundAudio.postMessage(...)        window.NSoundNativeBridge.onCommand / onLifecycle
                ▼  │
 WebView ── experimental/nativeBridge.js ── playerManager.js (YouTube IFrame API oficial) ── MediaSession web
```
- **Web → nativo** (`postMessage` a `nsoundAudio`): `ready`, `nowPlaying {title, artist, album, artwork, duration, position, playing}`, `state {position, duration, playing}`, `clear`.
- **Nativo → web** (`evaluateJavaScript`): `NSoundNativeBridge.onCommand({cmd: play|pause|toggle|next|previous|seek, position})` y `NSoundNativeBridge.onLifecycle("background"|"foreground"|"active")`.
- **Marca de entorno:** el contenedor inyecta `window.NSOUND_WRAPPER`, `ENABLE_EXPERIMENTAL_PLAYER` y `__LS_ENGINES__` al inicio de la página (desactivable con la clave `NSoundInjectExperimentalFlags = false`). `nativeBridge.js` solo se activa si existe el manejador `nsoundAudio`; en Safari/PWA/Android/Windows no hace nada.
- **Órdenes:** con el motor integrado la cola es de la app, así que `next/previous/seek/play/pause` se entregan como los eventos `remote` que la app ya entiende (`window.__nativeEvent`).
- **Segundo plano:** `UIBackgroundModes → audio` + sesión `.playback` activa; al entrar/volver a primer plano y tras interrupciones se reactiva y se avisa a la web, que reenvía su estado y (con el modo experimental) reanuda con `iosManager`/`networkManager`.
- **Media Session:** la web puede publicar su propia `navigator.mediaSession` y el sistema la mezcla con la nativa. Los datos nativos solo se publican cuando la web usa el puente.

**Requisito importante:** la web que cargue el contenedor debe ser una compilación de esta rama (`node app/build.mjs` incluye `experimental/`) y debe poder buscar canciones (la app necesita su servidor `/__proxy`, p. ej. `app/dev/server.mjs` o el servicio de Render del repositorio). Una web sin el código experimental también carga, pero entonces la pantalla de bloqueo la gestiona solo WebKit.

## 2. Archivos
| Archivo | Para qué |
|---|---|
| `NSoundWrapper/AppDelegate.swift` | Sesión de audio `.playback`, reactivación tras interrupciones |
| `NSoundWrapper/SceneDelegate.swift` | Ventana y reenvío del ciclo de vida |
| `NSoundWrapper/ViewController.swift` | `WKWebView`, dirección de NSound (se guarda), navegación segura, puente |
| `NSoundWrapper/NowPlayingBridge.swift` | Pantalla de bloqueo y botones |
| `NSoundWrapper/Info.plist` | `UIBackgroundModes → audio`, escenas, red local, claves `NSoundStartURL` y `NSoundInjectExperimentalFlags` |
| `NSoundWrapper/Assets.xcassets` | Icono (de `branding/icon-1024.png`) |
| `project.yml` | Proyecto de Xcode generado con XcodeGen |
| `../app/src/experimental/nativeBridge.js` | Lado web del puente |
| `../.github/workflows/build-ios-wrapper.yml` | Compilación sin firmar en macOS (solo en esta rama o a mano) |

## 3. Primera ejecución y ajustes
- Sin `NSoundStartURL` en `Info.plist`, la app pide la dirección al abrir (`https://…`; `http://` solo en red local: localhost, `.local`, 192.168.x, 10.x, 172.16-31.x). Si tu servidor usa clave, escribe la dirección completa con ella (`https://…/?k=CLAVE`). Se guarda en el iPhone.
- **Agitar el teléfono** abre otra vez el cuadro para cambiar la dirección.
- Los enlaces a otros sitios se abren en Safari; el reproductor de YouTube (marco) funciona dentro de la app.

### Nube y local a la vez
El cuadro de dirección tiene **dos campos**: la principal (nube) y una alternativa (tu PC en casa, opcional). Si la principal no responde, la app prueba la alternativa sola.
- **Nube:** el repositorio trae `render.yaml` (servicio gratuito de Render con clave `LS_TOKEN`; se duerme tras 15 min sin uso y tarda ~1 min en despertar). En Render: *New → Blueprint →* este repositorio, **rama `claude/experimento-motores-ios-f23fb5`** → Apply. Dirección: `https://TU-SERVICIO.onrender.com/?k=CLAVE`. No está desplegado: es una cuenta tuya y no la he creado.
- **Local:** `node app/build.mjs` y `LS_TOKEN=clave node app/dev/server.mjs 5174`, más un túnel (`cloudflared tunnel --url http://127.0.0.1:5174`) o la IP de tu red (`http://192.168.x.x:5174/?k=clave`, solo en casa).
- GitHub Pages no sirve: la web necesita el servidor `/__proxy` para buscar canciones.

## 4. Compilar y sacar el `.ipa`
Xcode **solo existe para Mac**. Con Windows tienes dos caminos.

### A) Con un Mac (firma personal, sin cuenta de pago)
1. Instala Xcode (App Store) y XcodeGen: `brew install xcodegen`.
2. `cd ios-wrapper && xcodegen generate` → crea `NSoundWrapper.xcodeproj`.
3. Ábrelo. En **Signing & Capabilities** elige tu **Personal Team** (tu Apple ID, gratis) y cambia el *Bundle Identifier* a uno único tuyo (p. ej. `org.nsound.wrapper.tunombre`).
4. Conecta el iPhone, actívalo en *Ajustes → Privacidad y seguridad → Modo de desarrollador*, elige tu dispositivo y pulsa **Run**. En el iPhone: *Ajustes → General → VPN y gestión de dispositivos* → confiar en tu Apple ID.
5. Para un `.ipa`: Product → Archive → Distribute App → *Custom* → *Development* (o *Debug*) → exporta.
   Con cuenta gratuita el perfil caduca a los **7 días** y hay un máximo de **3 apps** a la vez.

### B) Sin Mac: IPA sin firmar desde GitHub (como el resto del proyecto)
1. En GitHub: **Actions → Build NSound iOS wrapper (experimental) → Run workflow** (o un push a la rama `claude/experimento-motores-ios-*` con cambios en `ios-wrapper/`).
2. Descarga el artefacto `NSoundWrapper-ipa` (`NSoundWrapper-unsigned.ipa` + `.sha256`). No se publica nada ni se crean releases.
3. En el PC: `gh run download <id> -R N1x0321/Nsound -n NSoundWrapper-ipa -D salida`.

### Instalar (sin Mac)
- **Sideloadly** (Windows/Mac): conecta el iPhone, arrastra el `.ipa`, pon tu Apple ID, *Start*. Confía en el perfil como arriba.
- **AltStore / SideStore**: instala AltServer en el PC, instala AltStore en el iPhone, *Mis apps → +* y elige el `.ipa`. AltStore lo renueva a diario por Wi-Fi mientras el PC esté encendido.
- Con ID gratuito: caduca a los 7 días (renovar), máx. 3 apps. El identificador `org.nsound.wrapper` es distinto de la app buena (`org.librestream.LibreStream`) y de la de pruebas (`…motores`): conviven.

## 5. Tests y CI
- Tests web existentes y nuevos, sin tocar el CI: `node app/test/run-all.mjs` (incluye `core.test.mjs`, que sigue igual, y `experimental5.test.mjs` con el puente y comprobaciones del contenedor). `node --test app/test/` a secas falla en Node 22+.
- Los flujos existentes (`build-ipa.yml`, etc.) **no** se han modificado y no ven `ios-wrapper/`. El flujo nuevo no corre en pull requests ni en `main` (solo a mano y en pushes a las ramas experimentales con cambios en `ios-wrapper/`), con permisos de solo lectura.
- `ios-wrapper/` no se empaqueta en `ios/` ni en Android/Windows.

## 6. Depuración
- Safari en Mac → Desarrollo → [iPhone] → NSound (el `WebView` es inspeccionable en iOS 16.4+; hay que activar *Inspector web* en el iPhone).
- Consola web: `NSoundExperimental.debug()` (incluye el registro de `bridge`).
- Registros nativos: Xcode → consola, filtro `NSoundWrapper`.

## 7. Reversión
Borra la app del iPhone. No hay datos que limpiar fuera de la dirección guardada (`UserDefaults`) y de lo que ya tenga tu web. En el repositorio basta con no fusionar la rama o borrar la carpeta `ios-wrapper/` y el flujo `build-ios-wrapper.yml`.

## 8. Lista de verificación
- [ ] `node app/test/run-all.mjs` sin fallos.
- [ ] El flujo «Build NSound iOS wrapper» termina y el `plutil` muestra `UIBackgroundModes` con `audio`.
- [ ] La app abre tu NSound (pide la dirección la primera vez).
- [ ] Música suena con la pantalla bloqueada; anotar si hay corte y cuánto dura.
- [ ] Pantalla de bloqueo: título, artista, carátula y barra de tiempo correctos; botones ⏮ ⏯ ⏭ y arrastrar la barra funcionan; AirPods también.
- [ ] Vídeos normales funcionan como siempre.
- [ ] Favoritos, historial y listas intactos (viven en tu web).
