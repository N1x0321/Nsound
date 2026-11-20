/* EXPERIMENTAL: navigator.mediaSession para el reproductor experimental (pantalla de bloqueo, AirPods/Bluetooth, Centro de control,
   Apple Watch y Dynamic Island cuando iOS lo permite: todos leen esta misma sesión). La miniatura es la de la pista; no se extrae audio. */
(function (root) {
  'use strict';
  const NS = root.NSoundExperimental = root.NSoundExperimental || {};

  class MediaSessionManager {
    /** opts: { player (PlayerManager), env?, seekOffset?=10, positionEveryMs?=1000, now? } */
    constructor(opts) {
      opts = opts || {};
      this.player = opts.player;
      this.env = opts.env || root;
      this.seekOffset = opts.seekOffset || 10;
      this.positionEveryMs = opts.positionEveryMs || 1000;
      this.now = opts.now || (() => Date.now());
      this.lastPosAt = 0; this.active = false; this._off = []; this.failed = [];
    }

    get supported() { return !!(this.env.navigator && this.env.navigator.mediaSession && typeof this.env.MediaMetadata === 'function'); }
    get _ms() { return this.env.navigator.mediaSession; }

    start() {
      if (this.active || !this.supported) return this.supported;
      this.active = true;
      this._handlers();
      this._off.push(this.player.on('track', () => this.sync()));
      this._off.push(this.player.on('state', (s) => this._onState(s)));
      this._off.push(this.player.on('rate', () => this._position(true)));         // el audio puro avisa de los cambios de velocidad y de los saltos
      this._off.push(this.player.on('seeked', () => this._position(true)));
      this.sync();
      return true;
    }
    stop() {
      this.active = false;
      this._off.forEach((f) => f()); this._off = [];
      if (!this.supported) return;
      ['play', 'pause', 'stop', 'nexttrack', 'previoustrack', 'seekbackward', 'seekforward', 'seekto'].forEach((a) => { try { this._ms.setActionHandler(a, null); } catch (e) { /* no admitida */ } });
    }

    _handlers() {
      const p = this.player;
      const map = {
        play: () => p.play(),
        pause: () => p.pause(),
        nexttrack: () => p.next({ auto: false }),
        previoustrack: () => p.prev(),
        stop: () => p.pause(),
        seekbackward: (d) => p.seek(Math.max(0, p.getTime() - ((d && d.seekOffset) || this.seekOffset))),
        seekforward: (d) => { const dur = p.getDuration(); const t = p.getTime() + ((d && d.seekOffset) || this.seekOffset); p.seek(dur > 0 ? Math.min(dur, t) : t); },
        seekto: (d) => { if (d && Number.isFinite(d.seekTime)) p.seek(d.seekTime); },
      };
      Object.keys(map).forEach((a) => {
        try { this._ms.setActionHandler(a, (d) => { try { map[a](d); } catch (e) { /* un fallo del reproductor no debe romper la sesión */ } this._position(true); }); }
        catch (e) { this.failed.push(a); }                  // acción no admitida por este navegador
      });
    }

    _metadata() {
      const it = this.player.current();
      if (!it) return null;
      // Carátula de la pista; la miniatura de YouTube solo para ids de YouTube (11 caracteres). El audio puro usa los ids de su servicio.
      const thumb = it.art || (/^[A-Za-z0-9_-]{11}$/.test(it.id || '') ? `https://i.ytimg.com/vi/${it.id}/hqdefault.jpg` : '');
      const meta = { title: it.title || '', artist: it.artist || '', album: this.player.playlist || '' };
      if (thumb) meta.artwork = [{ src: thumb, sizes: '480x360', type: 'image/jpeg' }, { src: thumb, sizes: '512x512', type: 'image/jpeg' }];
      return new this.env.MediaMetadata(meta);
    }

    _position(force) {
      const t = this.now();
      if (!force && t - this.lastPosAt < this.positionEveryMs) return;
      this.lastPosAt = t;
      const d = this.player.getDuration();
      if (!(d > 0) || typeof this._ms.setPositionState !== 'function') return;
      const rate = typeof this.player.getPlaybackRate === 'function' ? this.player.getPlaybackRate() : 1;   // HTMLAudioElement: velocidad real; YouTube: 1
      try { this._ms.setPositionState({ duration: d, playbackRate: rate > 0 ? rate : 1, position: Math.min(d, Math.max(0, this.player.getTime())) }); } catch (e) { /* valores no válidos */ }
    }

    _onState(s) {
      if (!this.supported) return;
      this._ms.playbackState = s.state === 'playing' || s.state === 'buffering' ? 'playing' : (this.player.current() ? 'paused' : 'none');
      this._position(s.state !== 'playing');
    }

    /** Vuelve a aplicar todo (al cambiar de pista y al volver a primer plano, cuando iOS puede haber soltado la sesión). */
    sync() {
      if (!this.supported) return false;
      try { this._ms.metadata = this._metadata(); } catch (e) { /* formato no admitido */ }
      this._ms.playbackState = this.player.state === 'playing' || this.player.state === 'buffering' ? 'playing' : (this.player.current() ? 'paused' : 'none');
      this._position(true);
      return true;
    }
  }

  NS.MediaSessionManager = MediaSessionManager;
})(globalThis);
if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.NSoundExperimental;
