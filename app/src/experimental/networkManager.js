/* EXPERIMENTAL: reconexión automática. Ante error de red, pérdida de conexión, corte de la reproducción o interrupción de
   WebKit/Safari en iOS: 1) guarda estado, 2) espera 3 s, 3) reintenta, 4) continúa desde el último segundo. Máx. 5 intentos. */
(function (root) {
  'use strict';
  const NS = root.NSoundExperimental = root.NSoundExperimental || {};
  const LOG_MAX = 200;

  class NetworkManager {
    /** opts: { player, state (StateManager), env?, delayMs?=3000, maxAttempts?=5, stallMs?=6000, now?, setTimeout?, clearTimeout? } */
    constructor(opts) {
      opts = opts || {};
      this.player = opts.player; this.state = opts.state;
      this.env = opts.env || root;
      this.delayMs = opts.delayMs == null ? 3000 : opts.delayMs;
      this.maxAttempts = opts.maxAttempts || 5;
      this.stallMs = opts.stallMs || 6000;
      this.now = opts.now || (() => Date.now());
      this._st = opts.setTimeout || root.setTimeout.bind(root);
      this._ct = opts.clearTimeout || root.clearTimeout.bind(root);
      this.attempts = 0; this.timer = null; this.stallTimer = null; this.watchTimer = null; this.lastPos = 0; this.active = false;
      this.gaveUp = false;
      this.log = []; this._off = [];
    }

    _log(event, data) {
      const e = { t: this.now(), event, data: data || null };
      this.log.push(e); if (this.log.length > LOG_MAX) this.log.shift();
      return e;
    }
    getLog() { return this.log.slice(); }
    _online() { const n = this.env.navigator; return !n || n.onLine !== false; }

    start() {
      if (this.active) return;
      this.active = true;
      const env = this.env;
      const add = (target, evt, fn) => { if (target && target.addEventListener) { target.addEventListener(evt, fn); this._off.push(() => target.removeEventListener(evt, fn)); } };
      add(env, 'offline', () => this.trouble('offline'));
      add(env, 'online', () => { this._log('online'); if (this._needsHelp() && !this.timer) { this.gaveUp = false; this.attempts = 0; this.trouble('back-online'); } });
      add(env, 'pagehide', () => { this._log('pagehide'); this.state.saveNow(); });
      add(env, 'pageshow', (e) => { if (e && e.persisted) this._checkAfterInterruption('pageshow-persisted'); });
      add(env.document, 'visibilitychange', () => { if (env.document && !env.document.hidden) this._checkAfterInterruption('visible'); });
      this._off.push(this.player.on('error', (e) => { if (e.recoverable) this.trouble('player-error-' + e.code); }));
      this._off.push(this.player.on('state', (s) => this._onPlayerState(s)));
      this._log('start');
    }
    stop() {
      this.active = false;
      this._off.forEach((f) => { try { f(); } catch (e) { /* ya quitado */ } }); this._off = [];
      this._clearTimers(); this._log('stop');
    }

    _needsHelp() { return this.player.wantPlay && !this.player.userPaused && this.player.state !== 'playing' && this.player.state !== 'buffering'; }

    _onPlayerState(s) {
      if (s.state === 'playing') {
        if (this.attempts > 0) this._log('recovered', { attempts: this.attempts, at: s.time });
        this.attempts = 0; this.gaveUp = false; this._clearTimers();
        return;
      }
      if (s.time > 0) this.lastPos = s.time;
      // Corte de reproducción: la app quería sonar pero el reproductor se queda en carga/pausa sin que el usuario lo haya pedido
      if (this.player.wantPlay && !this.player.userPaused && ['buffering', 'paused', 'unstarted'].includes(s.state)) this._armStall(s.state);
    }
    _armStall(why) {
      if (this.stallTimer || this.timer) return;
      this.stallTimer = this._st(() => {
        this.stallTimer = null;
        if (this.player.wantPlay && !this.player.userPaused && this.player.state !== 'playing') this.trouble('stall-' + why);
      }, this.stallMs);
    }
    _checkAfterInterruption(why) { if (this._needsHelp()) this.trouble('webkit-interruption-' + why); }

    /** Punto de entrada de cualquier problema. */
    trouble(reason) {
      if (!this.active) return false;
      this._log('trouble', { reason });
      if (this.timer || this.gaveUp) return false;          // ya hay un reintento programado o se agotaron los intentos
      if (this.attempts >= this.maxAttempts) { this._giveUp(); return false; }
      const t = this.player.getTime(); if (t > 0) this.lastPos = t;
      this.state.saveNow();                                 // 1) guardar
      this._schedule(reason);                               // 2) esperar 3 s
      return true;
    }

    _giveUp() { this.gaveUp = true; this._clearTimers(); this._log('gaveup', { attempts: this.attempts, lastPos: this.lastPos }); }

    _schedule(reason) {
      if (this.timer) this._ct(this.timer);
      this.timer = this._st(() => { this.timer = null; this._retry(reason); }, this.delayMs);
    }
    _clearTimers() {
      [['timer'], ['stallTimer'], ['watchTimer']].forEach(([k]) => { if (this[k]) { this._ct(this[k]); this[k] = null; } });
    }

    async _retry(reason) {
      if (!this.active) return;
      this.attempts++;
      const online = this._online();
      this._log('retry', { attempt: this.attempts, reason, from: this.lastPos, online });
      if (online) {
        try { await this.player.resumeFrom(this.lastPos); }   // 3) reintentar y 4) continuar desde el último segundo
        catch (e) { this._log('retry-failed', { message: String((e && e.message) || e) }); }
      }
      // Si no llega a sonar, se vuelve a intentar tras otra espera de 3 s, hasta agotar los intentos
      this.watchTimer = this._st(() => {
        this.watchTimer = null;
        if (!this.active || this.player.state === 'playing') return;
        if (this.attempts < this.maxAttempts) this._schedule('no-playing-after-retry'); else this._giveUp();
      }, this.stallMs);
    }
  }

  NS.NetworkManager = NetworkManager;
})(globalThis);
if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.NSoundExperimental;
