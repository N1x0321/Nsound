/* EXPERIMENTAL: ajustes para iPhone, iPad, Safari y Chrome iOS (todos usan WebKit). Evita cortes al cambiar de app, de pestaña,
   bloquear la pantalla o usar multitarea en iPad: al salir guarda; al volver restaura estado, cola y segundo exacto y sincroniza Media Session.
   No evita que iOS pause un iframe de YouTube en segundo plano: lo detecta y lo reanuda. */
(function (root) {
  'use strict';
  const NS = root.NSoundExperimental = root.NSoundExperimental || {};
  const KEY = 'nsound_experimental_ios';

  function isIOS(env) {
    const n = env.navigator || {};
    const ua = n.userAgent || '';
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && n.maxTouchPoints > 1);   // iPadOS se presenta como Mac
  }

  class IOSManager {
    /** opts: { player, state (StateManager), media? (MediaSessionManager), env?, force?, graceMs?=600, coalesceMs?=300, setTimeout?, clearTimeout?, now? } */
    constructor(opts) {
      opts = opts || {};
      this.player = opts.player; this.state = opts.state; this.media = opts.media || null;
      this.env = opts.env || root;
      this.force = !!opts.force;
      this.graceMs = opts.graceMs == null ? 600 : opts.graceMs;
      this.coalesceMs = opts.coalesceMs == null ? 300 : opts.coalesceMs;
      this.now = opts.now || (() => Date.now());
      this._st = opts.setTimeout || root.setTimeout.bind(root);
      this._ct = opts.clearTimeout || root.clearTimeout.bind(root);
      this.away = false; this.wasPlaying = false; this.leftPos = 0; this.leftAt = 0;
      this.pending = null; this.active = false; this.log = []; this._off = [];
    }

    get applies() { return this.force || isIOS(this.env); }
    _log(event, data) { this.log.push({ t: this.now(), event, data: data || null }); if (this.log.length > 200) this.log.shift(); }
    getLog() { return this.log.slice(); }

    start() {
      if (this.active || !this.applies) return false;
      this.active = true;
      const env = this.env, doc = env.document;
      const add = (t, e, f) => { if (t && t.addEventListener) { t.addEventListener(e, f); this._off.push(() => t.removeEventListener(e, f)); } };
      add(doc, 'visibilitychange', () => (doc.hidden ? this.leave('visibilitychange') : this.back('visibilitychange')));
      add(env, 'pagehide', () => this.leave('pagehide'));
      add(env, 'pageshow', (e) => this.back(e && e.persisted ? 'pageshow-bfcache' : 'pageshow'));
      add(env, 'blur', () => this.leave('blur'));          // multitarea de iPad: la ventana pierde el foco sin ocultarse
      add(env, 'focus', () => this.back('focus'));
      this._log('start');
      this._restoreIfFresh();
      return true;
    }
    stop() {
      this.active = false;
      this._off.forEach((f) => { try { f(); } catch (e) { /* ya quitado */ } }); this._off = [];
      if (this.pending) { this._ct(this.pending); this.pending = null; }
    }

    _intent() { return !!this.player.wantPlay && !this.player.userPaused; }
    _store(v) { try { this.env.localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } }
    _read() { try { return JSON.parse(this.env.localStorage.getItem(KEY)); } catch (e) { return null; } }

    /** Salida de primer plano: se guarda todo y se anota si sonaba (solo la primera señal de cada salida). */
    leave(why) {
      if (!this.active) return;
      if (!this.away) {
        this.away = true;
        this.wasPlaying = this._intent();
        const t = this.player.getTime(); if (t > 0) this.leftPos = t;
        this.leftAt = this.now();
        this._store({ wasPlaying: this.wasPlaying, position: this.leftPos, videoId: this.player.current() ? this.player.current().id : '', ts: this.leftAt });
      }
      this.state.saveNow();
      this._log('leave', { why, wasPlaying: this.wasPlaying, pos: this.leftPos });
    }

    /** Vuelta a primer plano: varias señales seguidas (visibilitychange+pageshow+focus) se juntan en una sola comprobación. */
    back(why) {
      if (!this.active) return;
      this._log('back-signal', { why });
      if (this.pending) return;
      this.pending = this._st(() => { this.pending = null; this._recover(why); }, this.coalesceMs);
    }

    async _recover(why) {
      if (!this.active) return;
      const doc = this.env.document;
      if (doc && doc.hidden) return;                       // falsa alarma: sigue oculta
      const wasAway = this.away; this.away = false;
      if (this.media) this.media.sync();
      if (!this.player.queue.length) {                     // la página se descargó de memoria: se restaura todo desde lo guardado
        const ok = await this.state.restore();
        this._log('restored', { ok, why });
        if (ok && wasAway && this.wasPlaying) await this._resume(this.leftPos || undefined);
        if (this.media) this.media.sync();
        return;
      }
      if (!(wasAway ? this.wasPlaying : this._intent())) return;   // no sonaba o la pausa fue del usuario: se respeta
      // Se da un margen: iOS a veces reanuda solo y no hay que pisarlo
      this._st(async () => {
        if (!this.active) return;
        const st = this.player.state;
        if (st === 'playing' || st === 'buffering') { this._log('already-playing'); if (this.media) this.media.sync(); return; }
        await this._resume(this.leftPos);
        if (this.media) this.media.sync();
      }, this.graceMs);
    }

    async _resume(pos) {
      const from = Math.max(Number(pos) || 0, this.player.getTime());
      this._log('resume', { from });
      try { await this.player.resumeFrom(from); } catch (e) { this._log('resume-failed', { message: String((e && e.message) || e) }); }
    }

    /** Al arrancar: si se salió hace poco con música sonando y la página se recargó, se restaura sin esperar a un evento. */
    async _restoreIfFresh() {
      const s = this._read();
      if (!s || !this.now || this.now() - s.ts > 6 * 3600 * 1000) return;
      if (this.player.queue.length) return;
      const ok = await this.state.restore();
      this._log('restored-on-start', { ok });
      if (ok && this.media) this.media.sync();
    }
  }

  IOSManager.isIOS = isIOS;
  NS.IOSManager = IOSManager;
})(globalThis);
if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.NSoundExperimental;
