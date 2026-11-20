/* EXPERIMENTAL: migración segura. Antes de cualquier inicialización o migración del estado experimental se hace una copia de seguridad
   de las claves «nsound_experimental_*». Nunca se lee-para-modificar, se borra ni se sobrescribe nada que no sea nuestro:
   catálogo, favoritos, historial, listas, ajustes y temas (claves «ls.*» y cualquier otra) quedan intactos, y se comprueba. */
(function (root) {
  'use strict';
  const NS = root.NSoundExperimental = root.NSoundExperimental || {};
  const PREFIX = 'nsound_experimental_';
  const BACKUP_PREFIX = PREFIX + 'backup_';
  const SCHEMA_KEY = PREFIX + 'schema';
  const CURRENT_SCHEMA = 1;

  const AUDIO_PREFIX = 'nsound_exp_audio_';   // reproductor de audio puro (HTML5): también es nuestro, nada más
  const isOwn = (k) => typeof k === 'string' && (k.startsWith(PREFIX) || k.startsWith(AUDIO_PREFIX));
  const isBackup = (k) => typeof k === 'string' && k.startsWith(BACKUP_PREFIX);
  const keysOf = (st) => { const out = []; for (let i = 0; i < st.length; i++) out.push(st.key(i)); return out; };

  /** Almacenamiento con candado: solo permite escribir o borrar claves «nsound_experimental_*». Lo demás se rechaza y se anota. */
  function createSafeStorage(storage) {
    const violations = [];
    const guard = (op, k) => { if (isOwn(k)) return true; violations.push({ op, key: String(k) }); return false; };
    return {
      violations,
      get length() { return storage.length; },
      key: (i) => storage.key(i),
      getItem: (k) => storage.getItem(k),
      setItem(k, v) { if (guard('set', k)) storage.setItem(k, v); },
      removeItem(k) { if (guard('remove', k)) storage.removeItem(k); },
      clear() { keysOf(storage).filter(isOwn).forEach((k) => storage.removeItem(k)); },   // «clear» solo borra lo nuestro
    };
  }

  class Migration {
    /** opts: { storage?, now?, keepBackups?=3 } */
    constructor(opts) {
      opts = opts || {};
      this.storage = opts.storage || (() => { try { return root.localStorage; } catch (e) { return null; } })();
      this.now = opts.now || (() => Date.now());
      this.keepBackups = opts.keepBackups || 3;
      this.log = [];
    }
    _log(event, data) { this.log.push({ t: this.now(), event, data: data || null }); }

    /** Huella de todo lo que NO es nuestro (clave + valor). Si cambia durante la migración, algo se ha escrito donde no debía. */
    productionFingerprint() {
      const st = this.storage; let h = 5381, n = 0;
      keysOf(st).filter((k) => !isOwn(k)).sort().forEach((k) => {
        const s = k + '\u0000' + st.getItem(k); n++;
        for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
      });
      return n + ':' + (h >>> 0).toString(16);
    }

    ownData() {
      const data = {};
      keysOf(this.storage).filter((k) => isOwn(k) && !isBackup(k)).forEach((k) => { data[k] = this.storage.getItem(k); });
      return data;
    }
    listBackups() { return keysOf(this.storage).filter(isBackup).sort(); }

    /** Copia de seguridad previa. Devuelve la clave, o null si no hay nada que copiar; lanza si no se pudo guardar. */
    backup() {
      const data = this.ownData();
      if (!Object.keys(data).length) return null;
      const key = BACKUP_PREFIX + this.now();
      const payload = JSON.stringify({ ts: this.now(), schema: this._schemaFound(), data });
      try { this.storage.setItem(key, payload); }
      catch (e) {                                                    // sin espacio: se liberan las copias antiguas nuestras y se reintenta una vez
        this.listBackups().forEach((k) => this.storage.removeItem(k));
        this.storage.setItem(key, payload);
      }
      this._prune(key);
      return key;
    }
    _prune(keep) {                                                   // solo copias propias; nunca otra cosa
      const all = this.listBackups();
      all.slice(0, Math.max(0, all.length - this.keepBackups)).filter((k) => k !== keep).forEach((k) => this.storage.removeItem(k));
    }
    _schemaFound() { const v = parseInt(this.storage.getItem(SCHEMA_KEY), 10); return Number.isFinite(v) ? v : 0; }

    /** Pasos de migración por versión de esquema. Cada paso solo toca claves propias y nunca borra: lo dudoso se aparta con otro nombre. */
    _steps() {
      return {
        1: () => {                                                   // 0 → 1: el estado guardado debe ser un JSON utilizable; si no, se aparta (no se borra)
          const raw = this.storage.getItem(PREFIX + 'state');
          if (raw === null) return;
          let ok = false; try { const s = JSON.parse(raw); ok = !!s && typeof s === 'object' && Array.isArray(s.queue); } catch (e) { ok = false; }
          if (!ok) { this.storage.setItem(PREFIX + 'state_corrupt', raw); this.storage.removeItem(PREFIX + 'state'); this._log('state-set-aside'); }
        },
      };
    }

    /** Copia → migra → verifica. { ok, migrated, backup, from, to, reason? }. Si falla la copia no se toca nada. */
    run() {
      if (!this.storage) return { ok: false, reason: 'no-storage' };
      const before = this.productionFingerprint();
      let backupKey = null;
      try { backupKey = this.backup(); } catch (e) { this._log('backup-failed', { message: String((e && e.message) || e) }); return { ok: false, reason: 'backup-failed' }; }
      const from = this._schemaFound(); let migrated = false;
      try {
        const steps = this._steps();
        for (let v = from + 1; v <= CURRENT_SCHEMA; v++) { if (steps[v]) steps[v](); migrated = true; }
        if (from !== CURRENT_SCHEMA) this.storage.setItem(SCHEMA_KEY, String(CURRENT_SCHEMA));
      } catch (e) {
        this._log('migration-failed', { message: String((e && e.message) || e) });
        if (backupKey) this.restore(backupKey);                      // se devuelve lo nuestro a como estaba
        return { ok: false, reason: 'migration-failed', backup: backupKey };
      }
      if (this.productionFingerprint() !== before) { this._log('production-changed'); return { ok: false, reason: 'production-changed', backup: backupKey }; }
      return { ok: true, migrated, backup: backupKey, from, to: CURRENT_SCHEMA };
    }

    /** Devuelve las claves propias de una copia (solo «nsound_experimental_*»; jamás otras). */
    restore(backupKey) {
      let b; try { b = JSON.parse(this.storage.getItem(backupKey)); } catch (e) { return false; }
      if (!b || typeof b.data !== 'object') return false;
      Object.keys(b.data).filter(isOwn).forEach((k) => this.storage.setItem(k, b.data[k]));
      return true;
    }
  }

  Migration.AUDIO_PREFIX = AUDIO_PREFIX; Migration.PREFIX = PREFIX; Migration.BACKUP_PREFIX = BACKUP_PREFIX; Migration.SCHEMA_KEY = SCHEMA_KEY; Migration.CURRENT_SCHEMA = CURRENT_SCHEMA;
  NS.Migration = Migration; NS.createSafeStorage = createSafeStorage;
})(globalThis);
if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.NSoundExperimental;
