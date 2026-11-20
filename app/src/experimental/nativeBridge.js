/* EXPERIMENTAL: puente opcional entre la web y el contenedor nativo de iOS (carpeta ios-wrapper/).
   Solo se activa si existe window.webkit.messageHandlers.nsoundAudio (lo crea el contenedor); en cualquier otro sitio no hace nada.
   Web → nativo: metadatos y estado de la pista (título, artista, carátula, duración, segundo actual).
   Nativo → web: órdenes play, pause, next, previous, seek, toggle (window.NSoundNativeBridge.onCommand). */
(function (root) {
  'use strict';
  const NS = root.NSoundExperimental = root.NSoundExperimental || {};
  const HANDLER = 'nsoundAudio';
  const COMMANDS = ['play', 'pause', 'toggle', 'next', 'previous', 'prev', 'seek'];

  class NativeBridge {
    /** opts: { player (PlayerManager), env?, commandTarget?='player'|'app', resyncMs?=15000, setInterval?, clearInterval? }
     *  commandTarget 'app': la cola es de la app (modo motores) y las órdenes se le pasan como eventos «remote» nativos, igual que en la app de iPhone actual. */
    constructor(opts) {
      opts = opts || {};
      this.player = opts.player; this.env = opts.env || root;
      this.commandTarget = opts.commandTarget === 'app' ? 'app' : 'player';
      this.resyncMs = opts.resyncMs || 15000;
      this._si = opts.setInterval || root.setInterval.bind(root);
      this._ci = opts.clearInterval || root.clearInterval.bind(root);
      this.timer = null; this.active = false; this._off = []; this.log = [];
      this.lastKey = ''; this.lastPlaying = null;
    }

    get handler() { const w = this.env.webkit; return w && w.messageHandlers && w.messageHandlers[HANDLER] ? w.messageHandlers[HANDLER] : null; }
    get available() { return !!this.handler; }
    _log(event, data) { this.log.push({ event, data: data || null }); if (this.log.length > 100) this.log.shift(); }
    getLog() { return this.log.slice(); }

    _post(msg) {
      const h = this.handler; if (!h) return false;
      try { h.postMessage(msg); return true; } catch (e) { this._log('post-failed', { type: msg.type, message: String((e && e.message) || e) }); return false; }
    }

    start() {
      if (this.active || !this.available) return false;
      this.active = true;
      this.env.NSoundNativeBridge = { onCommand: (c) => this.handle(c), onLifecycle: (e) => this.onLifecycle(e) };
      this._off.push(this.player.on('track', () => this.sync(true)));
      this._off.push(this.player.on('state', (s) => this._onState(s)));
      this._off.push(this.player.on('queueEnd', () => this._post({ type: 'clear' })));
      this.timer = this._si(() => this._state(), this.resyncMs);        // corrige la deriva de la barra de tiempo del sistema
      this._post({ type: 'ready', version: 1 });
      this.sync(true);
      return true;
    }
    stop() {
      this.active = false;
      if (this.timer) { this._ci(this.timer); this.timer = null; }
      this._off.forEach((f) => f()); this._off = [];
      if (this.env.NSoundNativeBridge) delete this.env.NSoundNativeBridge;
    }

    _info() {
      const p = this.player, it = p.current(); if (!it) return null;
      const d = p.getDuration();
      return { type: 'nowPlaying', title: it.title || '', artist: it.artist || '', album: p.playlist || '', artwork: it.art || `https://i.ytimg.com/vi/${it.id}/hqdefault.jpg`,
        duration: d > 0 ? d : (it.duration || 0), position: p.getTime(), playing: this._isPlaying(), videoId: it.id };
    }
    _isPlaying() { return this.player.state === 'playing' || this.player.state === 'buffering'; }

    /** Envía los metadatos completos (cambio de pista) o solo el estado. */
    sync(full) {
      if (!this.active) return false;
      const info = this._info();
      if (!info) return this._post({ type: 'clear' });
      const key = info.videoId + '|' + info.title + '|' + info.artist;
      if (full || key !== this.lastKey) { this.lastKey = key; return this._post(info); }
      return this._state();
    }
    _state() {
      if (!this.active || !this.player.current()) return false;
      this.lastPlaying = this._isPlaying();
      return this._post({ type: 'state', position: this.player.getTime(), duration: this.player.getDuration(), playing: this.lastPlaying });
    }
    _onState(s) {
      if (!this.active) return;
      const playing = s.state === 'playing' || s.state === 'buffering';
      if (playing !== this.lastPlaying || s.state === 'ended' || s.state === 'paused') this._state();
    }

    /** Ciclo de vida que avisa el contenedor: al volver a primer plano se reenvía todo (iOS puede haber soltado la sesión). */
    onLifecycle(evt) {
      this._log('lifecycle', { evt });
      if (evt === 'foreground') this.sync(true);
      return true;
    }

    /** Orden del sistema (pantalla de bloqueo, AirPods, Centro de control). Devuelve true si se entendió. */
    handle(cmd) {
      if (!cmd || typeof cmd !== 'object' || !COMMANDS.includes(cmd.cmd)) { this._log('bad-command', { cmd }); return false; }
      const name = cmd.cmd === 'prev' ? 'previous' : cmd.cmd;
      const pos = Number(cmd.position);
      if (name === 'seek' && !(Number.isFinite(pos) && pos >= 0)) { this._log('bad-seek', { cmd }); return false; }
      this._log('command', { name });
      if (this.commandTarget === 'app' && typeof this.env.__nativeEvent === 'function') {
        const e = { type: 'remote', cmd: name === 'previous' ? 'prev' : name };
        if (name === 'seek') e.position = pos;
        if (name === 'toggle') e.cmd = this._isPlaying() ? 'pause' : 'play';
        this.env.__nativeEvent(e);
        return true;
      }
      const p = this.player;
      if (name === 'play') p.play(); else if (name === 'pause') p.pause();
      else if (name === 'toggle') p.toggle();
      else if (name === 'next') p.next({ auto: false });
      else if (name === 'previous') p.prev();
      else if (name === 'seek') p.seek(pos);
      this._state();
      return true;
    }
  }

  NS.NativeBridge = NativeBridge;
})(globalThis);
if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.NSoundExperimental;
