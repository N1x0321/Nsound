# «Mi servidor» · tu música con audio propio (Navidrome / Subsonic)

Apartado nuevo de la app de iPhone de pruebas («Nsound Motores») que reproduce **tus propios archivos** desde un servidor [Navidrome](https://www.navidrome.org/)
(o cualquier servidor compatible con la API Subsonic). El audio llega como un archivo normal a una etiqueta `<audio>`: iOS lo trata como una sesión de audio
de verdad y **no tiene el corte del reproductor de YouTube**. YouTube sigue como está; esto es un apartado aparte.

> **No verificado.** Las pruebas (`app/test/navidrome.test.mjs`) usan un Navidrome falso y un `<audio>` simulado. **No se ha probado con un Navidrome real ni en un iPhone.**
> Que el audio aguante en segundo plano con `<audio>` es el comportamiento documentado de iOS, pero aquí no está demostrado.
> El catálogo lo pones tú, y con él los derechos: Nsound no trae música ni la busca por ti.

## Qué hay
| Archivo | Para qué |
|---|---|
| `app/src/js/03-subsonic.js` | Cliente Subsonic (`LS.Subsonic`): MD5 propio, token, búsqueda, álbumes, aleatorias, listas, stream y carátulas |
| `app/dev/server.mjs` | Puente `/__nd/…` hacia tu Navidrome (variable `ND_URL`) |
| `app/src/js/04-app.js` | Página «Mi servidor»: entrar, buscar, álbumes, aleatorias, reproducir (solo con `LS.enginesEnabled`) |
| `app/src/js/03-player.js` + `index.template.html` | Elemento `<audio id="audio5">` para las pistas `src: 'nd'` |
| `app/test/navidrome.test.mjs` | 13 pruebas (cliente, puente con servidor real, reproductor, interfaz) |

Solo aparece en la app «Motores» (`__LS_ENGINES__`): Android, Windows, la web publicada y la app buena de iPhone no ven nada nuevo.

## Puesta en marcha
1. **Navidrome** con tu música (por ejemplo con Docker):
   ```bash
   docker run -d --name navidrome -p 4533:4533 -v /ruta/a/tu/musica:/music:ro -v navidrome-data:/data deluan/navidrome:latest
   ```
   Abre `http://localhost:4533`, crea el usuario administrador y espera a que escanee la música.
2. **Servidor de Nsound** apuntando a él:
   ```bash
   node app/build.mjs
   ND_URL=http://127.0.0.1:4533 LS_TOKEN=clave node app/dev/server.mjs 5174
   ```
   (con el túnel de siempre: `cloudflared tunnel --url http://127.0.0.1:5174`; en Render, añade la variable `ND_URL` al servicio).
   Si Navidrome está en otro equipo o en internet, `ND_URL` es su dirección (`https://musica.tudominio.com`).
3. En el iPhone, abre Nsound Motores → **Mi servidor** → usuario y contraseña de Navidrome.

## Reproductor nativo en la app de iPhone (AVQueuePlayer)
En la app «Nsound Motores» el audio de «Mi servidor» **no suena dentro del WebView**: lo reproduce el propio iOS con `AVQueuePlayer`
(`ios/LibreStream/Services/Playback/NativeStreamPlayer.swift`), con `AVAudioSession(.playback)`, `MPRemoteCommandCenter` (play, pausa, siguiente, anterior y barra de tiempo),
`MPNowPlayingInfoCenter` (pantalla de bloqueo con título, artista, carátula y tiempo) y «Audio en segundo plano» (`UIBackgroundModes: audio`).
Así no depende de la página ni de ningún iframe: iOS no lo pausa al bloquear o cambiar de app.
- La interfaz entrega la lista de pistas (toda la cola si es solo de tu servidor; si hay mezcla, el tramo hasta la primera pista de otro origen) y el nativo **avanza solo**, con la siguiente ya cargada.
- El nativo solo acepta direcciones `/__nd/rest/stream` del mismo servidor que la página (y carátulas `/__nd/rest/getCoverArt`); no guarda audio en disco.
- Los botones de la pantalla de bloqueo los atiende el nativo (también con la página dormida) y avisa a la interfaz (pausa del usuario, cambio de pista).
- Con «Aleatorio» activado, o fuera de la app de iPhone (navegador, `ios-wrapper/`), las pistas suenan por `<audio id="audio5">` en el WebView, como se explica abajo.
- Hace falta que la dirección del servidor de Nsound sea **https** (túnel o Render): iOS bloquea `http` en reproducción nativa.
- Si cambias la cola mientras suena el tramo nativo, el cambio se aplica al empezar el siguiente tramo (la lista que está sonando no se reordena).
- **No verificado en un iPhone**: el código Swift solo se ha compilado en CI.

## Cómo funciona (y por qué así)
- **Puente `/__nd`:** Navidrome no envía cabeceras CORS, así que el navegador no puede llamarlo directamente. El servidor de Nsound lo reenvía en `/__nd/rest/<endpoint>`:
  solo **GET/HEAD**, solo una **lista cerrada** de endpoints (`ping`, `search3`, `getAlbumList2`, `getAlbum`, `getArtists`, `getArtist`, `getRandomSongs`, `getPlaylists`, `getPlaylist`, `getSong`, `stream`, `getCoverArt`), con `Range` para saltar en la pista.
  Sin `ND_URL` responde «no configurado». Al ir por tu mismo dominio también se evita el bloqueo de contenido mixto (https → http).
- **Clave de acceso:** con `LS_TOKEN`, todo el puente exige la cookie. Salvo `stream` y `getCoverArt`: los pide la etiqueta `<audio>`/`<img>` y en iOS puede no llevar la cookie, así que
  se autorizan con una **firma derivada** (`HMAC(LS_TOKEN)`, que la página recibe de `/__nd/session`). La clave en bruto no vale como firma y la firma no vale para el resto de llamadas.
- **Contraseña:** no se guarda. La API Subsonic usa un token (`md5(contraseña + sal)`) que se calcula en el dispositivo; se guardan solo usuario, token y sal bajo `nsound_experimental_navidrome`.
  Si cambias la contraseña en Navidrome, el token deja de valer y la app te pide entrar de nuevo.
- **Formatos:** FLAC, MP3, AAC/M4A y WAV se reproducen tal cual. Los que Safari no reproduce (OGG, Opus, WMA…) se piden ya convertidos a MP3 a 320 kbps (lo hace Navidrome).
- **Favoritos y listas:** las pistas guardadas llevan `src: 'nd'` y su `id`; la dirección de audio se calcula al reproducir. La miniatura guardada incluye el token (solo está en tu dispositivo).

## Límites conocidos
- La app necesita **tu servidor de Nsound y tu Navidrome encendidos y alcanzables** (si el PC está apagado o el túnel caído, «Mi servidor» no carga).
- La cola de «Mi servidor» es la de la app, no la del motor experimental (que solo lleva música de YouTube).
- No hay edición de listas ni de la biblioteca de Navidrome: solo lectura y reproducción.
- Para pruebas en un solo equipo basta con `http://127.0.0.1:4533`; para el iPhone, el puente ya va por el mismo dominio de Nsound.
