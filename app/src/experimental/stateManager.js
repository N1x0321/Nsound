/* EXPERIMENTAL: guarda y restaura el estado de reproducción. Solo escribe claves «nsound_experimental_*»;
   no lee ni modifica favoritos, historial, listas ni ajustes del resto de la app (claves «ls.*»). */
(function (root) {
  'use strict';
  const NS = root.NSoundExperimental = root.NSoundExperimental || {};
  const PREFIX = 'nsound_experimental_';
  const KEY = PREFIX + 'state', BACKUP = PREFIX + 'state_backup';
  const MAX_QUEUE = 500;

  function validState(s) {
    return !!s && typeof s === 'object' && typeof s.videoId === 'string' && Array.isArray(s.queue) && Number.isFinite(s.position) && s.position >= 0;
  }

  class StateManager {
    /** opts: { player (PlayerManager), storage?, intervalMs?=5000, now?, setInterval?, clearInterval? } */
    constructor(opts) {
      opts = opts || {};
      this.player = opts.player;
      this.prefix = opts.prefix || PREFIX;            // «nsound_exp_audio_» en el modo de audio puro
      this._key = this.prefix + 'state'; this._backupKey = this.prefix + 'state_backup';
      this.storage = opts.storage || (() => { try { return root.localStorage; } catch (e) { return null; } })();
      this.intervalMs = opts.intervalMs || 5000;
      this.now = opts.now || (() => Date.now());
      this._si = opts.setInterval || root.setInterval.bind(root);
      this._ci = opts.clearInterval || root.clearInterval.bind(root);
      this.timer = null; this.initialized = false; this.lastError = null;
    }

    _get(key) { try { const raw = this.storage && this.storage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
    _set(key, v) { try { this.storage.setItem(key, JSON.stringify(v)); return true; } catch (e) { this.lastError = e; return false; } }   // sin espacio o bloqueado: se ignora

    /** Copia de seguridad del estado previo (si lo hay) antes de escribir nada. */
    backup() {
      try {
        const raw = this.storage && this.storage.getItem(this._key);
        if (raw && validState(JSON.parse(raw))) this.storage.setItem(this._backupKey, raw);   // no se pisa una buena copia con un estado dañado
        return !!raw;
      } catch (e) { this.lastError = e; return false; }
    }

    init() {
      if (this.initialized) return;
      this.backup();                                        // primero la copia; después cualquier guardado
      this.initialized = true;
    }

    saveNow() {
      if (!this.initialized) this.init();
      const snap = this.player.snapshot();
      if (!snap.videoId) return false;                      // nada sonando: no se pisa el último estado bueno
      snap.queue = snap.queue.slice(0, MAX_QUEUE);
      snap.timestamp = this.now();
      return this._set(this._key, snap);
    }

    /** Lee el estado guardado (o su copia si el principal está dañado). */
    load() {
      const s = this._get(this._key);
      if (validState(s)) return s;
      const b = this._get(this._backupKey);
      return validState(b) ? b : null;
    }

    async restore() {
      this.init();
      const s = this.load();
      if (!s) return false;
      return this.player.restore(s);
    }

    start() {
      this.init();
      if (this.timer) return;
      this.timer = this._si(() => { if (this.player.wantPlay || this.player.state === 'playing') this.saveNow(); }, this.intervalMs);
      if (root.document && root.document.addEventListener) {
        this._onHide = () => { if (root.document.hidden) this.saveNow(); };
        root.document.addEventListener('visibilitychange', this._onHide);
        if (root.addEventListener) { this._onPageHide = () => this.saveNow(); root.addEventListener('pagehide', this._onPageHide); }
      }
    }
    stop() {
      if (this.timer) { this._ci(this.timer); this.timer = null; }
      if (root.document && this._onHide) root.document.removeEventListener('visibilitychange', this._onHide);
      if (root.removeEventListener && this._onPageHide) root.removeEventListener('pagehide', this._onPageHide);
      this._onHide = this._onPageHide = null;
    }
  }

  StateManager.KEY = KEY; StateManager.BACKUP = BACKUP; StateManager.PREFIX = PREFIX;
  NS.StateManager = StateManager;
})(globalThis);
if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.NSoundExperimental;
