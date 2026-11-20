/* EXPERIMENTAL (flag ENABLE_EXPERIMENTAL_PLAYER): gestor de reproducción musical con la YouTube IFrame Player API oficial.
   Una única instancia del reproductor; las pistas cambian con loadVideoById(), sin recrear el iframe.
   No descarga ni extrae audio. No toca el reproductor actual (#yt) ni el apartado de vídeos normales. */
(function (root) {
  'use strict';
  const NS = root.NSoundExperimental = root.NSoundExperimental || {};
  const ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const FATAL_CODES = [2, 100, 101, 150];            // pista no válida / no disponible / sin permiso de incrustar: se salta
  const STATE_NAMES = { '-1': 'unstarted', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'cued' };

  function loadYouTubeApi() {
    return new Promise((resolve, reject) => {
      if (root.YT && root.YT.Player) { resolve(root.YT); return; }
      const prev = root.onYouTubeIframeAPIReady;
      root.onYouTubeIframeAPIReady = () => { try { if (typeof prev === 'function') prev(); } finally { resolve(root.YT); } };
      const doc = root.document;
      if (!doc.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const s = doc.createElement('script');
        s.src = 'https://www.youtube.com/iframe_api';
        s.onerror = () => reject(new Error('No se pudo cargar la API oficial de YouTube'));
        doc.head.appendChild(s);
      }
    });
  }

  function shuffled(list, rnd) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  class PlayerManager {
    /** opts: { container (id de un elemento propio, nunca 'yt'), loadApi?, random?, volume?, playerVars? } */
    constructor(opts) {
      opts = opts || {};
      if (!opts.container) throw new Error('PlayerManager: falta container');
      if (opts.container === 'yt') throw new Error('PlayerManager: «yt» es del reproductor actual; usa otro contenedor');
      this.container = opts.container;
      this.loadApi = opts.loadApi || loadYouTubeApi;
      this.random = opts.random || Math.random;
      this.playerVars = opts.playerVars || {};
      this.player = null; this.ready = null;
      this.queue = []; this.order = []; this.pos = -1;
      this.repeat = 'off'; this.shuffle = false; this.autoplay = true;
      this.volume = Number.isFinite(opts.volume) ? opts.volume : 80;
      this.playlist = '';
      this.wantPlay = false; this.userPaused = false;
      this.skipStreak = 0;
      this.nextPreload = null;
      this._subs = {};
      this.state = 'unstarted';
    }

    // ---- eventos ----
    on(evt, fn) { (this._subs[evt] = this._subs[evt] || []).push(fn); return () => { this._subs[evt] = (this._subs[evt] || []).filter((f) => f !== fn); }; }
    _emit(evt, data) { (this._subs[evt] || []).slice().forEach((fn) => { try { fn(data); } catch (e) { /* un oyente roto no afecta a los demás */ } }); }

    // ---- API de YouTube ----
    init() {
      if (this.ready) return this.ready;
      this.ready = this.loadApi().then((YT) => new Promise((resolve, reject) => {
        const vars = Object.assign({ autoplay: 0, playsinline: 1, rel: 0, modestbranding: 1 }, this.playerVars);
        if (root.location && /^https?:/.test(root.location.origin)) vars.origin = root.location.origin;
        try {
          this.player = new YT.Player(this.container, {
            width: '100%', height: '100%', playerVars: vars,
            events: {
              onReady: () => { try { this.player.setVolume(this.volume); } catch (e) { /* sin volumen aún */ } resolve(); },
              onStateChange: (e) => this._onState(e.data),
              onError: (e) => this._onError(e.data),
            },
          });
        } catch (e) { reject(e); }
      })).catch((e) => { this.ready = null; throw e; });
      return this.ready;
    }

    _onState(code) {
      this.state = STATE_NAMES[code] || 'unstarted';
      if (code === 1) this.skipStreak = 0;
      const cur = this.current();
      this._emit('state', { state: this.state, time: this.getTime(), videoId: cur && cur.id });
      if (code === 0) this._onEnded();
    }

    _onError(code) {
      const cur = this.current();
      this._emit('error', { code, videoId: cur && cur.id, recoverable: !FATAL_CODES.includes(code) });
      if (FATAL_CODES.includes(code)) {                     // pista inservible: pasar a la siguiente (sin dar vueltas infinitas)
        this.skipStreak++;
        if (this.skipStreak >= this.queue.length) { this.wantPlay = false; this._emit('queueExhausted', {}); return; }
        this.next({ auto: true });
      }
      // Errores recuperables (p. ej. 5, fallo del HTML5): los gestiona networkManager con resumeFrom()
    }

    _onEnded() {
      if (!this.autoplay) { this.wantPlay = false; this._emit('ended', { auto: false }); return; }
      if (this.repeat === 'one') { this.playIndex(this.currentIndex(), { startSeconds: 0 }); return; }
      this._emit('ended', { auto: true });
      this.next({ auto: true });
    }

    // ---- cola ----
    static normalize(item) {
      if (!item || !ID_RE.test(item.id || '')) return null;
      if (item.kind === 'video') return null;               // los vídeos normales tienen su apartado: no entran aquí
      return { id: item.id, title: String(item.title || ''), artist: String(item.artist || ''), art: item.art || '', duration: Number(item.duration) || 0 };
    }

    setQueue(items, startIndex, playlist) {
      this.queue = (items || []).map(PlayerManager.normalize).filter(Boolean);
      this.playlist = playlist || '';
      const start = Math.min(Math.max(startIndex | 0, 0), Math.max(this.queue.length - 1, 0));
      this._rebuildOrder(start);
      this._emit('queue', { length: this.queue.length, playlist: this.playlist });
      return this.queue.length;
    }

    _rebuildOrder(currentIndex) {
      const idx = this.queue.map((_, i) => i);
      if (this.shuffle && idx.length) {
        const rest = shuffled(idx.filter((i) => i !== currentIndex), this.random);
        this.order = [currentIndex].concat(rest); this.pos = 0;
      } else { this.order = idx; this.pos = idx.length ? currentIndex : -1; }
    }

    current() { return this.pos >= 0 ? this.queue[this.order[this.pos]] || null : null; }
    currentIndex() { return this.pos >= 0 ? this.order[this.pos] : -1; }

    /** Siguiente pista según repetir/aleatorio (sin avanzar). */
    peekNext() {
      if (!this.queue.length) return null;
      if (this.repeat === 'one') return this.current();
      if (this.pos + 1 < this.order.length) return this.queue[this.order[this.pos + 1]];
      return this.repeat === 'all' ? this.queue[this.order[0]] : null;
    }

    _preload() {                                            // precarga lógica: se resuelve la siguiente (no se crea ningún iframe)
      const n = this.peekNext();
      this.nextPreload = n ? n.id : null;
      if (n) this._emit('preload', { videoId: n.id, item: n });
    }

    setShuffle(on) { this.shuffle = !!on; if (this.queue.length) this._rebuildOrder(Math.max(this.currentIndex(), 0)); this._preload(); this._emit('mode', this.modes()); }
    setRepeat(mode) { this.repeat = ['off', 'all', 'one'].includes(mode) ? mode : 'off'; this._preload(); this._emit('mode', this.modes()); }
    setAutoplay(on) { this.autoplay = !!on; }
    modes() { return { repeat: this.repeat, shuffle: this.shuffle, autoplay: this.autoplay }; }

    // ---- reproducción ----
    async playIndex(queueIndex, opts) {
      opts = opts || {};
      const at = this.order.indexOf(queueIndex);
      if (at < 0) return false;
      this.pos = at;
      const item = this.queue[queueIndex];
      await this.init();
      this.userPaused = false;
      this.wantPlay = opts.autoplay !== false;
      const payload = { videoId: item.id, startSeconds: Math.max(0, Number(opts.startSeconds) || 0) };
      if (this.wantPlay) this.player.loadVideoById(payload); else this.player.cueVideoById(payload);
      this._emit('track', { item, index: queueIndex, playlist: this.playlist });
      this._preload();
      return true;
    }

    play() {
      if (!this.player) return this.queue.length ? this.playIndex(this.currentIndex() < 0 ? 0 : this.currentIndex()) : false;
      this.userPaused = false; this.wantPlay = true; this.player.playVideo(); return true;
    }
    pause() { this.userPaused = true; this.wantPlay = false; if (this.player) this.player.pauseVideo(); }
    toggle() { return this.state === 'playing' || this.state === 'buffering' ? this.pause() : this.play(); }
    seek(s) { if (this.player) this.player.seekTo(Math.max(0, s), true); }
    setVolume(v) { this.volume = Math.max(0, Math.min(100, Number(v) || 0)); if (this.player) this.player.setVolume(this.volume); this._emit('volume', this.volume); }

    /** Pasa a la siguiente pista. Al final de la cola: con repetir «lista» da la vuelta; si no, para (salvo «siguiente» manual, que vuelve al principio). */
    next(o) {
      if (!this.queue.length) return false;
      const auto = !!(o && o.auto);
      let np = this.pos + 1;
      if (np >= this.order.length) {
        if (this.repeat === 'all') {
          if (this.shuffle) { this._rebuildOrder(this.order[this.order.length - 1]); np = this.order.length > 1 ? 1 : 0; } else np = 0;
        } else if (auto) { this.wantPlay = false; this._emit('queueEnd', {}); return false; }
        else np = 0;
      }
      return this.playIndex(this.order[np]);
    }
    prev() {
      if (!this.queue.length) return false;
      if (this.getTime() > 3) { this.seek(0); return true; }
      const pp = this.pos > 0 ? this.pos - 1 : (this.repeat === 'all' ? this.order.length - 1 : 0);
      return this.playIndex(this.order[pp]);
    }

    getTime() {
      try { const t = this.player && this.player.getCurrentTime ? this.player.getCurrentTime() : 0; return Number.isFinite(t) ? t : 0; } catch (e) { return 0; }
    }
    getDuration() {
      try { const d = this.player && this.player.getDuration ? this.player.getDuration() : 0; return Number.isFinite(d) ? d : 0; } catch (e) { return 0; }
    }

    /** Reanuda la pista actual desde un segundo concreto (recuperación tras errores/cortes). Sigue sin recrear el iframe. */
    async resumeFrom(seconds) {
      const cur = this.current();
      if (!cur) return false;
      await this.init();
      this.wantPlay = true; this.userPaused = false;
      this.player.loadVideoById({ videoId: cur.id, startSeconds: Math.max(0, Number(seconds) || 0) });
      return true;
    }

    /** Restaura un estado guardado sin sonar (queda en pausa lista para pulsar play). */
    async restore(s) {
      if (!s || !Array.isArray(s.queue)) return false;
      this.shuffle = !!s.shuffle; this.repeat = ['off', 'all', 'one'].includes(s.repeat) ? s.repeat : 'off';
      if (Number.isFinite(s.volume)) this.volume = Math.max(0, Math.min(100, s.volume));
      const n = this.setQueue(s.queue, Number.isInteger(s.index) ? s.index : 0, s.playlist);
      if (!n) return false;
      let qi = this.queue.findIndex((q) => q.id === s.videoId);
      if (qi < 0) qi = Math.min(Math.max(s.index | 0, 0), n - 1);
      this._rebuildOrder(qi);
      return this.playIndex(qi, { autoplay: false, startSeconds: s.position });
    }

    snapshot() {
      const cur = this.current();
      return { videoId: cur ? cur.id : '', position: this.getTime(), queue: this.queue.slice(), index: this.currentIndex(), volume: this.volume,
        playlist: this.playlist, repeat: this.repeat, shuffle: this.shuffle };
    }
  }

  NS.PlayerManager = PlayerManager;
})(globalThis);
if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.NSoundExperimental;
