/* EXPERIMENTAL: configuración. Interruptor general del modo experimental. */
(function (root) {
  'use strict';
  const NS = root.NSoundExperimental = root.NSoundExperimental || {};

  // Interruptor maestro. Con false, NSound funciona exactamente igual que ahora: no se inyecta nada, no se registra ningún service worker
  // y no se intercepta ninguna reproducción.
  const ENABLE_EXPERIMENTAL_PLAYER = true;

  // Reproductor de AUDIO PURO (HTMLAudioElement, sin iframe de vídeo). Apagado por defecto: con false NSound funciona exactamente igual que ahora.
  // Necesita además ENABLE_EXPERIMENTAL_PLAYER activo y un AUDIO_STREAM_RESOLVER_URL (ver README_EXPERIMENTAL_AUDIO.md). Sin conector no hace nada.
  const ENABLE_EXPERIMENTAL_AUDIO_PLAYER = false;
  // Servicio PROPIO que recibe ?trackId=… y devuelve la URL de audio autorizada (con cabeceras Range). Vacío = sin conector.
  const AUDIO_STREAM_RESOLVER_URL = '';

  // Motor OFICIAL de Spotify (Web Playback SDK; solo escritorio/navegador, Premium, el usuario inicia sesión). APAGADO y sin registrarse solo: ver spotifyEngine.js.
  const ENABLE_SPOTIFY_ENGINE = false;

  NS.config = {
    ENABLE_SPOTIFY_ENGINE,
    ENABLE_EXPERIMENTAL_AUDIO_PLAYER,
    AUDIO_STREAM_RESOLVER_URL,
    AUDIO_STORAGE_PREFIX: 'nsound_exp_audio_',
    ENABLE_EXPERIMENTAL_PLAYER,
    // Con true (recomendado), además del interruptor maestro hace falta que la app de pruebas lo declare (en iPhone, ios/ define
    // window.ENABLE_EXPERIMENTAL_PLAYER = true solo si el bundle id acaba en «.motores»). Así Android, Windows, la web publicada y la app
    // buena de iPhone no activan nada aunque el interruptor maestro sea true. Pon false solo para probar en un navegador de escritorio.
    REQUIRE_NATIVE_FLAG: true,
    CONTAINER_ID: 'exp-player',
    VERSION_URL: 'experimental/version.json',
    SW_URL: 'sw-experimental.js',
    MANIFEST_URL: 'experimental/manifest.webmanifest',
    UPDATE_INTERVAL_MS: 60000,
  };
})(globalThis);
if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.NSoundExperimental;
