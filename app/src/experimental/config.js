/* EXPERIMENTAL: configuración. Interruptor general del modo experimental. */
(function (root) {
  'use strict';
  const NS = root.NSoundExperimental = root.NSoundExperimental || {};

  // Interruptor maestro. Con false, NSound funciona exactamente igual que ahora: no se inyecta nada, no se registra ningún service worker
  // y no se intercepta ninguna reproducción.
  const ENABLE_EXPERIMENTAL_PLAYER = true;

  NS.config = {
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
