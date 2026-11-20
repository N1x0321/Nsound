# Reproductor experimental de AUDIO PURO (HTMLAudioElement) · NSound

Motor alternativo y opcional que reproduce con un `new Audio()` en lugar del iframe de YouTube. iOS trata un `<audio>` como una sesión de audio
de verdad (sigue con la pantalla bloqueada y en segundo plano) y lo integra con Media Session (pantalla de bloqueo, Dynamic Island, AirPods).

> **Lo que NO está verificado.** Las pruebas son unitarias, con un `<audio>`, un conector y un almacenamiento simulados (`app/test/audioPlayer.test.mjs`).
> **No se ha probado en un iPhone ni con un conector real.** Que iOS mantenga el audio en segundo plano con `<audio>` es el comportamiento documentado
> del sistema, pero aquí no está demostrado.
>
> **Hace falta un conector.** NSound no incluye ningún servicio que dé audio: sin `AUDIO_STREAM_RESOLVER_URL` este modo no hace nada.
> No extrae ni raspa audio de plataformas de terceros. Solo reproduce URLs que **tu** servicio entrega y que tú tienes derecho a servir
> (tu propia música, catálogos con licencia libre como Jamendo o Internet Archive con su licencia verificada, etc.).
> **Con el catálogo de YouTube no funciona**: esas pistas seguirán por el reproductor de YouTube.

## 1. Cómo se activa (tres puertas, todas necesarias)
En `experimental/config.js`:
```js
ENABLE_EXPERIMENTAL_AUDIO_PLAYER = true;                 // por defecto false: NSound funciona exactamente igual que ahora
AUDIO_STREAM_RESOLVER_URL = 'https://tu-servicio.example/audio';   // por defecto '' (sin conector = inactivo)
```
Además tiene que estar activo el modo experimental general (`ENABLE_EXPERIMENTAL_PLAYER` + la marca nativa de la app de pruebas), igual que el resto de
`experimental/`. Con cualquiera apagada no se carga nada nuevo, no se crea ningún `Audio` y se usa el reproductor de siempre.

## 2. Qué toma y qué no
| Pista | Reproductor |
|---|---|
| Vídeo normal (`kind: 'video'`, o reproducción con vídeo) | El de siempre (no pasa por aquí) |
| Música (`audioOnly`) **con audio autorizado** en el conector | `audioPlayerManager.js` (`<audio>`) |
| Música **sin** audio autorizado (el conector responde 404/403/410, no responde o devuelve algo no válido) | **Cede** al reproductor habitual (YouTube/HTML5) |

Un 404/403/410 se recuerda 5 minutos para no repetir la consulta en cada pista. No se tocan el catálogo, los vídeos normales, favoritos, historial,
listas ni ajustes: el estado propio vive solo en claves `nsound_exp_audio_*` (la migración y el candado de almacenamiento las tratan como propias y
comprueban que nada más cambia).

## 3. Contrato del conector (`AUDIO_STREAM_RESOLVER_URL`)
**Petición:** `GET <URL>?trackId=<id>` (o, si la URL contiene `{trackId}`, esa parte se sustituye). Sin cookies (`credentials: 'omit'`), `Accept: application/json`.
El `trackId` es el id de la pista de NSound (`[A-Za-z0-9_.:-]`, hasta 200 caracteres). Tiempo máximo de espera: 6 s.

**Respuesta 200** (`application/json`):
```json
{
  "url": "https://cdn.tu-servicio.example/audio/abc123.mp3",
  "expiresAt": 1893456000,
  "mimeType": "audio/mpeg",
  "duration": 215,
  "title": "Título",
  "artist": "Artista",
  "art": "https://cdn.tu-servicio.example/art/abc123.jpg"
}
```
- `url` (obligatorio): **https** (http solo en red local: localhost, `.local`, 192.168.x, 10.x, 172.16-31.x). Se rechaza `javascript:`, `data:`, `blob:`, `file:` y http público.
- `expiresAt` (opcional): segundos Unix, milisegundos o fecha ISO. Se vuelve a pedir 30 s antes. Sin dato: 10 minutos. Si una URL caduca a mitad de pista, el error se recupera pidiendo una nueva.
- `duration`, `title`, `artist`, `art` (opcionales): `art` solo si es https.
- **Errores:** `404` (o 403/410) = «no tengo audio autorizado para esta pista» → NSound cede al reproductor habitual.

**Requisitos de la URL de audio** (los exige iOS y el seek instantáneo):
1. **Cabeceras `Range`:** responder `Accept-Ranges: bytes` y `206 Partial Content` a `Range: bytes=…`. Sin esto Safari ni siquiera reproduce bien y no se puede saltar a un segundo.
2. **CORS:** el elemento usa `crossOrigin = 'anonymous'`, así que el servidor de audio debe enviar `Access-Control-Allow-Origin` (con el origen de NSound o `*`) y exponer `Content-Range`, `Accept-Ranges` y `Content-Length`.
3. `Content-Type` correcto (`audio/mpeg`, `audio/mp4`, `audio/aac`…). iOS reproduce MP3, AAC/M4A y WAV; **no** OGG/Opus en Safari antiguo.

Servidor mínimo de referencia (Node, sirve tus propios MP3 de una carpeta; `serve-static` ya atiende `Range` y CORS lo pones tú):
```js
import http from 'node:http'; import { createReadStream, statSync } from 'node:fs'; import { join } from 'node:path';
const DIR = './musica', BASE = 'https://tu-servicio.example';
http.createServer((req, res) => {
  const u = new URL(req.url, BASE); res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
  if (u.pathname === '/audio') {                                      // el conector
    const id = (u.searchParams.get('trackId') || '').replace(/[^\w.-]/g, '');
    try { statSync(join(DIR, id + '.mp3')); } catch { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ url: `${BASE}/f/${id}.mp3`, mimeType: 'audio/mpeg' }));
  }
  if (u.pathname.startsWith('/f/')) {                                 // el audio, con Range
    const f = join(DIR, u.pathname.slice(3).replace(/[^\w.-]/g, '')), size = statSync(f).size, m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    res.setHeader('Content-Type', 'audio/mpeg'); res.setHeader('Accept-Ranges', 'bytes');
    if (!m) { res.setHeader('Content-Length', size); return createReadStream(f).pipe(res); }
    const a = m[1] ? +m[1] : 0, b = m[2] ? +m[2] : size - 1; res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${a}-${b}/${size}`); res.setHeader('Content-Length', b - a + 1); return createReadStream(f, { start: a, end: b }).pipe(res);
  }
  res.statusCode = 404; res.end();
}).listen(8080);
```
(Es solo un ejemplo del contrato. Un servicio real necesita HTTPS, autenticación y sus propias reglas de derechos.)

## 4. Archivos
| Archivo | Para qué |
|---|---|
| `audioPlayerManager.js` | `AudioPlayerManager` (motor `<audio>`, cola, precarga, recuperación) y `StreamResolver` (conector con caché) |
| `mediaSession.js` | Estado, `setPositionState` con la velocidad real, metadatos y `play/pause/stop/nexttrack/previoustrack/seekto/seekbackward/seekforward` |
| `stateManager.js` / `iosManager.js` | Mismo código que el modo YouTube, con prefijo `nsound_exp_audio_` (guardado cada 5 s, `visibilitychange`/`pagehide`/`pageshow`) |
| `migration.js` | También copia y protege las claves `nsound_exp_audio_*` |
| `experimentalBootstrap.js` / `config.js` | `NS.audioEnabled()`, motor `exp-audio` con cesión al reproductor habitual |
| `app/test/audioPlayer.test.mjs` | 23 pruebas unitarias (viven en `app/test/` porque `run-all.mjs` solo lee esa carpeta y `core.test.mjs` queda intacto) |

## 5. Comportamiento
- **Elementos:** `audio` (suena) y `nextAudioBuffer` (oculto, `muted`, solo precarga). Ambos con `preload = 'auto'` y `crossOrigin = 'anonymous'`.
- **Cola propia:** `next`, `previous`, `ended`, `shuffle` y `repeat` (`off`/`all`/`one`). Integrado en la app, la cola la lleva la app y el motor reproduce una pista cada vez.
- **Precarga (`prepareNext()`):** al empezar cada pista y otra vez cuando faltan ≤ 20 s, se resuelve la siguiente y se carga en `nextAudioBuffer`. Al sonar la actual, el buffer se suelta.
  *Matiz:* la pista siguiente se reproduce **con el mismo elemento** `audio` (cambia `src`), no intercambiando elementos: en iOS un `<audio>` nuevo puede exigir un toque del usuario y el elemento vivo mantiene la sesión en segundo plano. El buffer deja la descarga en la caché HTTP, así que el cambio es casi inmediato, pero **un hueco de silencio muy corto es posible**; no es gapless garantizado.
- **Recuperación (`stalled`, `waiting`, `error`, pausa del sistema):** guarda el segundo exacto, espera 1 s (hasta 3 s en intentos sucesivos), pide una URL nueva por si caducó y continúa desde ese segundo. Máximo 5 intentos; después avisa (`error` no recuperable) y, con cola propia, salta a la siguiente. La pausa del usuario cancela cualquier reintento. Ante una pausa del sistema (llamada, auriculares) lo primero es volver a pedir `play()` a los 0,3 s sin recargar.
- **`NotAllowedError` (iOS exige un toque):** no se reintenta en bucle; se avisa y se espera al siguiente toque.
- **Volumen:** iOS ignora `audio.volume` (usa los botones del teléfono); el valor se guarda igualmente.
- **Media Session:** la web publica sus metadatos y `setPositionState`; en el contenedor nativo de `ios-wrapper/` el sistema mezcla la sesión web con la nativa.

## 6. Depuración y reversión
- Consola de Safari (iPhone conectado a un Mac): `NSoundExperimental.debug()` → `audio: true` y el registro del reproductor (`trouble`, `retry`, `recovered`, `soft-resume`, `resolve-failed`…).
- Apagar: `ENABLE_EXPERIMENTAL_AUDIO_PLAYER = false` y recompilar. No hay datos que limpiar fuera de las claves `nsound_exp_audio_*`.
- Probar: `node app/test/run-all.mjs` (133 pruebas, incluidas las 23 de audio puro).
