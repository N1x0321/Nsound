/* EXPERIMENTAL: orquestación. Con el modo experimental apagado no hace absolutamente nada.
   Encendido: inyecta la configuración PWA de Apple (solo lo que falte), aplica optimizaciones de rendimiento, crea el reproductor
   experimental y los gestores, y registra un motor que intercepta ÚNICAMENTE la reproducción musical (pistas de YouTube Music en
   «solo audio»). Los vídeos normales y el catálogo siguen por el reproductor de siempre. */
(function (root) {
  'use strict';
  const NS = root.NSoundExperimental = root.NSoundExperimental || {};
  const cfg = () => NS.config || {};
  const ID_RE = /^[A-Za-z0-9_-]{11}$/;

  NS.enabled = () => cfg().ENABLE_EXPERIMENTAL_PLAYER === true && (!cfg().REQUIRE_NATIVE_FLAG || root.ENABLE_EXPERIMENTAL_PLAYER === true);

  // ================= Fase 9: PWA de Apple =================
  const SPLASH = [   // [ancho CSS, alto CSS, ratio]: iPhone y iPad en vertical; los archivos los genera app/assets-experimental.mjs
    [430, 932, 3], [393, 852, 3], [390, 844, 3], [375, 812, 3], [414, 896, 3], [414, 896, 2], [414, 736, 3], [375, 667, 2],
    [768, 1024, 2], [820, 1180, 2], [834, 1194, 2], [1024, 1366, 2],
  ];
  const splashFile = (w, h, r) => `experimental/splash/splash-${w * r}x${h * r}.png`;

  /** Añade a <head> solo lo que falte. Devuelve la lista de lo añadido. La versión actual ya trae capable/title/status-bar/theme-color/icono. */
  function injectPwa(doc, opts) {
    opts = opts || {};
    const added = [], head = doc.head;
    const has = (sel) => !!doc.querySelector(sel);
    const meta = (name, content) => { if (has(`meta[name="${name}"]`)) return; const m = doc.createElement('meta'); m.setAttribute('name', name); m.setAttribute('content', content); head.appendChild(m); added.push('meta:' + name); };
    const link = (rel, href, extra, key) => {
      if (has(key || `link[rel="${rel}"]`)) return;
      const l = doc.createElement('link'); l.setAttribute('rel', rel); l.setAttribute('href', href);
      Object.keys(extra || {}).forEach((k) => l.setAttribute(k, extra[k])); head.appendChild(l); added.push('link:' + rel + (extra && extra.sizes ? ':' + extra.sizes : ''));
    };
    meta('apple-mobile-web-app-capable', 'yes');
    meta('apple-mobile-web-app-status-bar-style', 'black-translucent');
    meta('apple-mobile-web-app-title', opts.title || 'Nsound');
    meta('mobile-web-app-capable', 'yes');
    meta('theme-color', opts.themeColor || '#121214');
    link('manifest', opts.manifest || cfg().MANIFEST_URL);
    link('apple-touch-icon', 'experimental/icons/icon-180.png', { sizes: '180x180' }, 'link[rel="apple-touch-icon"][sizes="180x180"]');
    SPLASH.forEach(([w, h, r]) => {
      const href = splashFile(w, h, r);
      link('apple-touch-startup-image', href, { media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)` }, `link[href="${href}"]`);
    });
    return added;
  }

  // ================= Fase 10: rendimiento =================
  class Perf {
    /** opts: { env?, maxImages?=12, setTimeout?, raf? } */
    constructor(opts) {
      opts = opts || {};
      this.env = opts.env || root;
      this.maxImages = opts.maxImages || 12;
      this._st = opts.setTimeout || root.setTimeout.bind(root);
      this.raf = opts.raf || ((f) => (this.env.requestAnimationFrame ? this.env.requestAnimationFrame(f) : this._st(f, 16)));
      this.images = []; this.queue = []; this.scheduled = false; this.observer = null; this._off = []; this.active = false;
    }
    get doc() { return this.env.document; }

    start() {
      if (this.active || !this.doc) return false;
      this.active = true;
      this._style(); this._lazyAll(); this._observe(); this._battery(); this._hints();
      const add = (t, e, f) => { if (t && t.addEventListener) { t.addEventListener(e, f); this._off.push(() => t.removeEventListener(e, f)); } };
      add(this.doc, 'visibilitychange', () => this._onVisibility());
      add(this.env, 'pagehide', () => { this.images.length = 0; });           // menos memoria al salir
      return true;
    }
    stop() {
      this.active = false;
      if (this.observer) { this.observer.disconnect(); this.observer = null; }
      this._off.forEach((f) => f()); this._off = []; this.images.length = 0;
    }

    _style() {                                                              // un solo <style>; solo actúa con las clases de abajo
      if (this.doc.getElementById('exp-perf-style')) return;
      const st = this.doc.createElement('style'); st.id = 'exp-perf-style';
      st.textContent = 'html.exp-hidden *,html.exp-hidden *::before,html.exp-hidden *::after{animation-play-state:paused!important}'
        + 'html.exp-lowpower *,html.exp-lowpower *::before,html.exp-lowpower *::after{animation:none!important;transition:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}';
      this.doc.head.appendChild(st);
    }

    /** Imágenes: carga diferida y decodificación fuera del hilo principal (sin tocar las marcadas data-eager ni las que ya lo definen). */
    lazify(img) {
      if (!img || img.tagName !== 'IMG') return false;
      let changed = false;
      if (!img.getAttribute('loading') && !img.hasAttribute('data-eager')) { img.setAttribute('loading', 'lazy'); changed = true; }
      if (!img.getAttribute('decoding')) { img.setAttribute('decoding', 'async'); changed = true; }
      return changed;
    }
    _lazyAll() { Array.prototype.forEach.call(this.doc.querySelectorAll('img'), (i) => this.lazify(i)); }
    _observe() {
      const MO = this.env.MutationObserver; if (!MO || !this.doc.body) return;
      this.observer = new MO((muts) => {
        muts.forEach((m) => Array.prototype.forEach.call(m.addedNodes || [], (n) => { if (n.nodeType === 1) this.queue.push(n); }));
        if (!this.scheduled) { this.scheduled = true; this.raf(() => this.flush()); }   // todo el trabajo del lote junto, en un solo fotograma
      });
      this.observer.observe(this.doc.body, { childList: true, subtree: true });
    }
    flush() {
      this.scheduled = false;
      const nodes = this.queue.splice(0);
      nodes.forEach((n) => { if (n.tagName === 'IMG') this.lazify(n); else if (n.querySelectorAll) Array.prototype.forEach.call(n.querySelectorAll('img'), (i) => this.lazify(i)); });
      return nodes.length;
    }

    /** Precarga de miniaturas con tope (las más antiguas se sueltan para no acumular memoria). */
    preloadImage(url) {
      if (!url || !/^https:/.test(url) || !this.env.Image) return false;
      if (this.images.some((i) => i.src === url)) return false;
      const img = new this.env.Image(); img.decoding = 'async'; img.src = url;
      this.images.push(img);
      while (this.images.length > this.maxImages) this.images.shift();
      return true;
    }

    /** Conexiones y script de YouTube calentados cuando el navegador está libre. */
    _hints() {
      const run = () => {
        const add = (rel, href, extra) => { if (this.doc.querySelector(`link[rel="${rel}"][href="${href}"]`)) return; const l = this.doc.createElement('link'); l.setAttribute('rel', rel); l.setAttribute('href', href); Object.keys(extra || {}).forEach((k) => l.setAttribute(k, extra[k])); this.doc.head.appendChild(l); };
        ['https://www.youtube.com', 'https://i.ytimg.com'].forEach((h) => { add('preconnect', h, { crossorigin: '' }); add('dns-prefetch', h); });
        add('preload', 'https://www.youtube.com/iframe_api', { as: 'script' });
      };
      if (this.env.requestIdleCallback) this.env.requestIdleCallback(run, { timeout: 3000 }); else this._st(run, 1500);
    }

    /** Batería: con la página oculta se pausan las animaciones; con batería baja o ahorro de datos se apagan efectos pesados. */
    _onVisibility() {
      const hidden = !!this.doc.hidden, cl = this.doc.documentElement.classList;
      if (hidden) { cl.add('exp-hidden'); this.images.length = 0; } else cl.remove('exp-hidden');
    }
    _battery() {
      const cl = this.doc.documentElement.classList, nav = this.env.navigator || {};
      const apply = (low) => (low ? cl.add('exp-lowpower') : cl.remove('exp-lowpower'));
      if (nav.connection && nav.connection.saveData) apply(true);
      if (typeof nav.getBattery === 'function') {                           // no existe en Safari/iOS: ahí no se hace nada
        nav.getBattery().then((b) => { const f = () => apply(!b.charging && b.level <= 0.2); f(); b.addEventListener('levelchange', f); b.addEventListener('chargingchange', f); }).catch(() => {});
      }
    }
  }

  // ================= Fase 12: motor que intercepta solo la música =================
  /** Devuelve una clase de motor (necesita LS.engines, que solo existe en el modo de motores). */
  function makeEngineClass(LS) {
    return class ExperimentalMusicEngine extends LS.engines.PlaybackEngineAdapter {
      constructor(pm, o) {
        super();
        o = o || {};
        this.pm = pm; this.facade = o.facade || null; this.perf = o.perf || null;
        this._st = { playing: false, time: 0, duration: 0 };
        this._setInterval = o.setInterval || root.setInterval.bind(root);
        this._clearInterval = o.clearInterval || root.clearInterval.bind(root);
        this.poll = null;
        pm.on('state', (s) => { this._st.playing = s.state === 'playing' || s.state === 'buffering'; this._publish(); });
        pm.on('ended', () => { this._st.playing = false; this._publish(); this._emit({ type: 'ended' }); });
        pm.on('error', (e) => { if (!e.recoverable) this._emit({ type: 'error', error: { code: e.code, recoverable: false }, raw: { code: e.code } }); });   // los recuperables los reintenta networkManager
      }
      get id() { return 'exp-yt'; }
      /** Solo pistas de música de YouTube en «solo audio». Vídeos normales y catálogo libre: no. */
      canPlay(track, opts) {
        return !!track && track.src === 'yt' && track.kind !== 'video' && ID_RE.test(track.id || '') && !!(opts && opts.audioOnly === true);
      }
      snapshot() { return Object.assign({}, this._st); }
      _publish() {
        this._st.time = this.pm.getTime(); const d = this.pm.getDuration(); if (d > 0) this._st.duration = d;
        const raw = Object.assign({}, this._st);
        this._emit({ type: 'state', state: raw.playing ? 'playing' : 'paused', position: raw.time, duration: raw.duration, raw });
      }
      async prepare(track) { if (this.perf && track && track.thumb) this.perf.preloadImage(track.thumb); }   // precarga de la miniatura de la siguiente
      async play(track, opts) {
        this._st = { playing: true, time: 0, duration: track.duration || 0 };
        this.pm.setAutoplay(false);                                         // la cola, repetir y aleatorio son de la app: el motor solo reproduce esta pista
        this.pm.setQueue([{ id: track.id, title: track.title, artist: track.artist || track.sub || '', art: track.thumb || '', duration: track.duration }], 0);
        const v = this.facade && this.facade.volume ? this.facade.volume() : null; if (v != null) this.pm.setVolume(v);
        this._startPoll();
        return this.pm.playIndex(0);
      }
      async pause() { this.pm.pause(); }
      async resume() { this.pm.play(); }
      async seek(s) { this.pm.seek(s); this._st.time = s; }
      async setVolume(v) { this.pm.setVolume(v); }
      async stop() { this._stopPoll(); this.pm.pause(); this._st.playing = false; }
      _startPoll() {                                                        // como el reproductor actual: cada 0,5 s y no con la página oculta
        if (this.poll) return;
        this.poll = this._setInterval(() => { if (root.document && root.document.hidden) return; if (this.pm.state === 'playing') this._publish(); }, 500);
      }
      _stopPoll() { if (this.poll) { this._clearInterval(this.poll); this.poll = null; } }
    };
  }

  // ================= Orquestación =================
  /** Crea los gestores ya conectados. Devuelve null si el modo experimental está apagado. */
  NS.create = function (opts) {
    if (!NS.enabled()) return null;
    opts = opts || {};
    let raw = opts.storage; if (!raw) { try { raw = root.localStorage; } catch (e) { raw = null; } }
    if (!raw) return null;
    if (opts.migrated !== true && !NS.migrate(raw)) return null;            // Fase 13: copia de seguridad antes de inicializar nada
    const player = new NS.PlayerManager({ container: opts.container || cfg().CONTAINER_ID, volume: opts.volume });
    const state = new NS.StateManager({ player, storage: NS.createSafeStorage(raw) });   // con candado: solo escribe «nsound_experimental_*»
    const network = new NS.NetworkManager({ player, state });
    const media = new NS.MediaSessionManager({ player });
    const owned = opts.appOwnsQueue === true;       // integrado: la app manda en cola y Media Session; aquí no se restaura ni se reanuda nada por su cuenta
    const ios = new NS.IOSManager({ player, state, media: owned ? null : media, restore: !owned });
    const update = new NS.UpdateManager({ player, state, intervalMs: cfg().UPDATE_INTERVAL_MS, versionUrl: cfg().VERSION_URL, swUrl: cfg().SW_URL, resume: !owned });
    return {
      player, state, network, media, ios, update,
      start() { state.start(); network.start(); if (!owned) media.start(); ios.start(); return update.start(); },
      stop() { update.stop(); ios.stop(); if (!owned) media.stop(); network.stop(); state.stop(); },
    };
  };

  /** Copia de seguridad + migración del estado experimental. Devuelve true si se puede seguir; si no, el modo experimental no arranca. */
  NS.migrate = function (storage) {
    let st = storage; if (!st) { try { st = root.localStorage; } catch (e) { st = null; } }
    const res = new NS.Migration({ storage: st }).run();
    NS.lastMigration = res;
    return !!res.ok;
  };

  /** Registros de todos los gestores para depurar (en iOS: consola de Safari → NSoundExperimental.debug()). */
  NS.debug = function () {
    const i = NS.instance; if (!i || !i.controller) return { running: false, migration: NS.lastMigration || null };
    const c = i.controller;
    return { running: true, migration: NS.lastMigration, version: c.update.current, player: { state: c.player.state, wantPlay: c.player.wantPlay, queue: c.player.queue.length, time: c.player.getTime() },
      network: c.network.getLog(), ios: c.ios.getLog(), update: c.update.getLog(), pwa: i.pwa };
  };

  /** Arranque completo. Idempotente. Con el modo apagado devuelve null sin tocar nada. */
  NS.bootstrap = function () {
    if (!NS.enabled()) return null;
    if (NS.instance) return NS.instance;
    const doc = root.document, LS = root.LS;
    if (!doc || !doc.body) return null;
    if (!NS.migrate()) return null;                                         // sin copia de seguridad no se arranca nada
    const out = { pwa: [], engine: null, controller: null, perf: null };
    NS.instance = out;
    try { out.pwa = injectPwa(doc); } catch (e) { out.pwa = []; }
    out.perf = new Perf({ env: root }); out.perf.start();

    // Contenedor propio del iframe experimental, oculto igual que el actual en solo audio (nunca se reutiliza #yt)
    let box = doc.getElementById(cfg().CONTAINER_ID);
    if (!box) {
      const wrap = doc.createElement('div');
      wrap.setAttribute('style', 'position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:0;pointer-events:none;overflow:hidden');
      box = doc.createElement('div'); box.id = cfg().CONTAINER_ID; wrap.appendChild(box); doc.body.appendChild(wrap);
    }
    const facade = LS && LS.engines && LS.engines.current;
    out.controller = NS.create({ container: cfg().CONTAINER_ID, appOwnsQueue: !!facade, migrated: true });
    if (facade) {                                                           // modo motores: se coloca delante del reproductor actual solo para música
      const Engine = makeEngineClass(LS);
      out.engine = new Engine(out.controller.player, { facade, perf: out.perf });
      facade.router.register(out.engine, true);
    }
    out.controller.start();
    out.stop = () => { if (out.engine) out.engine._stopPoll(); out.perf.stop(); out.controller.stop(); NS.instance = null; };
    return out;
  };

  NS.injectPwa = injectPwa; NS.Perf = Perf; NS.makeEngineClass = makeEngineClass; NS.SPLASH = SPLASH;

  // Arranque automático al final del paquete (la app ya está creada). Apagado: no hace nada.
  if (NS.enabled() && root.document) {
    const go = () => { try { NS.bootstrap(); } catch (e) { if (root.console) console.error('Nsound experimental:', e); } };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', go); else root.setTimeout(go, 0);
  }
})(globalThis);
if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.NSoundExperimental;
