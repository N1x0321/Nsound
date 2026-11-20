/* EXPERIMENTAL: actualización automática. Cada minuto lee experimental/version.json (siempre de la red); si la versión cambió:
   guarda el estado, registra el service worker nuevo (?v=…), borra cachés obsoletas y recarga. Al arrancar tras la recarga se restaura
   la cola, la pista y el segundo, y se reanuda si sonaba. Solo funciona en la web alojada (https); las apps de iPhone/Android cargan
   la interfaz empaquetada y no tienen service workers, ahí solo se actualiza instalando una versión nueva. */
(function (root) {
  'use strict';
  const NS = root.NSoundExperimental = root.NSoundExperimental || {};
  const VERSION_KEY = 'nsound_experimental_version', RELOAD_KEY = 'nsound_experimental_reload';
  const BUNDLED_VERSION = '1.0.0-beta';                     // debe coincidir con experimental/version.json (lo comprueba un test)

  class UpdateManager {
    /** opts: { player, state, env?, fetchFn?, intervalMs?=60000, versionUrl?, swUrl?, resume?=true, swScope?, waitMs?=8000, setInterval?, clearInterval?, now? } */
    constructor(opts) {
      opts = opts || {};
      this.player = opts.player; this.state = opts.state;
      this.env = opts.env || root;
      this.fetchFn = opts.fetchFn || ((u, o) => root.fetch(u, o));
      this.intervalMs = opts.intervalMs || 60000;
      this.versionUrl = opts.versionUrl || 'experimental/version.json';
      this.swUrl = opts.swUrl || 'sw-experimental.js';
      this.swScope = opts.swScope || './';
      this.resume = opts.resume !== false;           // false: la app restaura su propia cola tras recargar
      this.waitMs = opts.waitMs == null ? 8000 : opts.waitMs;
      this._si = opts.setInterval || root.setInterval.bind(root);
      this._ci = opts.clearInterval || root.clearInterval.bind(root);
      this.now = opts.now || (() => Date.now());
      this.current = this._stored(VERSION_KEY) || BUNDLED_VERSION;
      this.timer = null; this.busy = false; this.log = []; this._off = [];
    }

    _log(event, data) { this.log.push({ t: this.now(), event, data: data || null }); if (this.log.length > 200) this.log.shift(); }
    getLog() { return this.log.slice(); }
    _stored(k) { try { return this.env.localStorage.getItem(k) || ''; } catch (e) { return ''; } }
    _put(k, v) { try { this.env.localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } }
    _del(k) { try { this.env.localStorage.removeItem(k); } catch (e) { /* ya */ } }
    get swSupported() { const n = this.env.navigator; return !!(n && n.serviceWorker) && /^https:|^http:\/\/localhost/.test((this.env.location && this.env.location.origin) || ''); }

    async start() {
      if (this.timer) return;
      this.stopped = false;
      await this._afterReload();
      await this._registerSw(this.current);
      if (this.stopped) return;                      // se paró mientras arrancaba
      this.timer = this._si(() => { this.check(); }, this.intervalMs);
      const doc = this.env.document;
      if (doc && doc.addEventListener) {
        const f = () => { if (!doc.hidden) this.check(); };
        doc.addEventListener('visibilitychange', f); this._off.push(() => doc.removeEventListener('visibilitychange', f));
      }
      this._log('start', { version: this.current });
    }
    stop() {
      this.stopped = true;
      if (this.timer) { this._ci(this.timer); this.timer = null; }
      this._off.forEach((f) => f()); this._off = [];
    }

    async _registerSw(version) {
      if (!this.swSupported) { this._log('sw-unsupported'); return null; }
      try {
        const reg = await this.env.navigator.serviceWorker.register(`${this.swUrl}?v=${encodeURIComponent(version)}`, { scope: this.swScope });
        this._log('sw-registered', { version });
        return reg;
      } catch (e) { this._log('sw-failed', { message: String((e && e.message) || e) }); return null; }
    }

    async remoteVersion() {
      const sep = this.versionUrl.includes('?') ? '&' : '?';
      const res = await this.fetchFn(`${this.versionUrl}${sep}t=${this.now()}`, { cache: 'no-store' });
      if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
      const j = await res.json();
      if (!j || typeof j.version !== 'string' || !j.version) throw new Error('version.json no válido');
      return j.version;
    }

    /** Una comprobación. Devuelve 'updated' | 'same' | 'busy' | 'error'. */
    async check() {
      if (this.busy) return 'busy';
      this.busy = true;
      try {
        let v;
        try { v = await this.remoteVersion(); } catch (e) { this._log('check-failed', { message: String((e && e.message) || e) }); return 'error'; }
        if (v === this.current) return 'same';
        this._log('new-version', { from: this.current, to: v });
        await this.apply(v);
        return 'updated';
      } finally { this.busy = false; }
    }

    async apply(version) {
      // 1) Estado a salvo: guardado normal + anotación de que hay que reanudar tras la recarga
      const playing = !!this.player.wantPlay && !this.player.userPaused;
      this.state.saveNow();
      this._put(RELOAD_KEY, JSON.stringify({ wasPlaying: playing, to: version, ts: this.now() }));
      // 2) Service worker nuevo (otra URL ?v=) y espera a que active, con tope
      const reg = await this._registerSw(version);
      if (reg) { try { await reg.update(); } catch (e) { /* sin red: seguirá con el actual */ } await this._waitActive(reg); }
      // 3) Cachés obsoletas fuera (el worker nuevo también lo hace al activarse)
      await this._clearOldCaches(version);
      this._put(VERSION_KEY, version); this.current = version;
      // 4) Recarga
      this._log('reload', { version });
      this.env.location.reload();
    }

    _waitActive(reg) {
      return new Promise((resolve) => {
        const done = () => resolve(true);
        if (reg.active && !reg.installing && !reg.waiting) { done(); return; }
        const w = reg.installing || reg.waiting;
        if (reg.waiting && reg.waiting.postMessage) { try { reg.waiting.postMessage('SKIP_WAITING'); } catch (e) { /* ya activo */ } }
        if (w && w.addEventListener) w.addEventListener('statechange', () => { if (w.state === 'activated') done(); });
        this.env.setTimeout ? this.env.setTimeout(done, this.waitMs) : setTimeout(done, this.waitMs);
      });
    }

    async _clearOldCaches(version) {
      const c = this.env.caches; if (!c) return;
      try {
        const keep = 'nsound-exp-' + version;
        const keys = await c.keys();
        await Promise.all(keys.filter((k) => k.startsWith('nsound-exp-') && k !== keep).map((k) => c.delete(k)));
      } catch (e) { this._log('cache-clean-failed'); }
    }

    /** Tras recargar por una actualización: devuelve cola, pista y segundo, y reanuda si sonaba. */
    async _afterReload() {
      const raw = this._stored(RELOAD_KEY);
      if (!raw) return false;
      this._del(RELOAD_KEY);
      if (!this.resume) return false;
      let r; try { r = JSON.parse(raw); } catch (e) { return false; }
      if (!r || this.now() - r.ts > 5 * 60 * 1000) return false;   // marca antigua: no se reanuda nada por sorpresa
      const ok = await this.state.restore();
      this._log('restored-after-update', { ok, wasPlaying: !!r.wasPlaying });
      if (ok && r.wasPlaying) { try { await this.player.play(); } catch (e) { /* iOS puede exigir un toque del usuario */ } }
      return ok;
    }
  }

  UpdateManager.BUNDLED_VERSION = BUNDLED_VERSION;
  NS.UpdateManager = UpdateManager;
})(globalThis);
if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.NSoundExperimental;
