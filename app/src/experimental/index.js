/* EXPERIMENTAL: punto de entrada. Con ENABLE_EXPERIMENTAL_PLAYER distinto de true no hace nada y NSound funciona igual que siempre.
   El flag lo enciende solo la app de iPhone de pruebas («Nsound Motores»): ios/ inyecta window.ENABLE_EXPERIMENTAL_PLAYER = true. */
(function (root) {
  'use strict';
  const NS = root.NSoundExperimental = root.NSoundExperimental || {};
  NS.enabled = () => root.ENABLE_EXPERIMENTAL_PLAYER === true;
  /** Crea todos los gestores ya conectados. Devuelve null si el flag está apagado. */
  NS.create = function (opts) {
    if (!NS.enabled()) return null;
    opts = opts || {};
    const player = new NS.PlayerManager({ container: opts.container, volume: opts.volume });
    const state = new NS.StateManager({ player, storage: opts.storage });
    const network = new NS.NetworkManager({ player, state });
    const media = new NS.MediaSessionManager({ player });
    const ios = new NS.IOSManager({ player, state, media });
    const update = new NS.UpdateManager({ player, state });
    return {
      player, state, network, media, ios, update,
      start() { state.start(); network.start(); media.start(); ios.start(); return update.start(); },
      stop() { update.stop(); ios.stop(); media.stop(); network.stop(); state.stop(); },
    };
  };
})(globalThis);
if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.NSoundExperimental;
