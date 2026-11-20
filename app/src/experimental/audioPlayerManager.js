/* EXPERIMENTAL (flag ENABLE_EXPERIMENTAL_AUDIO_PLAYER): reproductor de AUDIO PURO con HTMLAudioElement (new Audio()), sin iframe de vídeo.
   iOS trata un <audio> como una sesión de audio de verdad: sigue sonando con la pantalla bloqueada y en segundo plano, y se integra
   con Media Session (pantalla de bloqueo, Dynamic Island, AirPods).
   La URL de audio NO se obtiene aquí: la entrega un conector configurable (AUDIO_STREAM_RESOLVER_URL) de un servicio propio que
   devuelve una URL AUTORIZADA con soporte de cabeceras HTTP Range. No hay extracción ni scraping de plataformas de terceros.
   Tiene la misma API pública que PlayerManager (on, setQueue, playIndex, play, pause, next, prev, seek, resumeFrom, restore, snapshot…),
   así que mediaSession, stateManager, iosManager y nativeBridge lo usan sin cambios. Su recuperación de red es propia (hasta 5 intentos). */
(function (root) {
  'use strict';
  const NS = root.NSoundExperimental = root.NSoundExperimental || {};
  const ID_RE = /^[A-Za-z0-9_.:-]{1,200}$/;
  const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\]|.*\.local|.*\.localhost|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

  function shuffled(list, rnd) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /** https siempre; http solo en red local (desarrollo). Nada de javascript:, data:, blob: ni file:. */
  function isAllowedAudioUrl(u) {
    let url; try { url = new URL(String(u)); } catch (e) { return false; }
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && LOCAL_HOSTS.test(url.hostname);
  }

  // ================= Conector de URLs de audio =================
  class StreamResolver {
    /** opts: { url (AUDIO_STREAM_RESOLVER_URL), fetch?, now?, ttlMs?=600000, timeoutMs?=6000, failTtlMs?=300000, setTimeout?, clearTimeout? }
     *  Contrato: GET <url>?trackId=<id>  (o <url> con «{trackId}») → 200 JSON { url, expiresAt?, mimeType?, duration?, title?, artist?, art? }. */
    constructor(opts) {
      opts = opts || {};
      this.url = String(opts.url || '');
      this._fetch = opts.fetch || (root.fetch ? root.fetch.bind(root) : null);
      this.now = opts.now || (() => Date.now());
      this.ttlMs = opts.ttlMs || 600000;
      this.timeoutMs = opts.timeoutMs || 6000;
      this.failTtlMs = opts.failTtlMs == null ? 300000 : opts.failTtlMs;
      this._st = opts.setTimeout || root.setTimeout.bind(root);
      this._ct = opts.clearTimeout || root.clearTimeout.bind(root);
      this.cache = new Map(); this.failed = new Map(); this.inflight = new Map();
    }

    requestUrl(trackId) {
      const id = encodeURIComponent(trackId);
      if (this.url.includes('{trackId}')) return this.url.replace('{trackId}', id);
      return this.url + (this.url.includes('?') ? '&' : '?') + 'trackId=' + id;
    }
    invalidate(trackId) { this.cache.delete(trackId); }

    /** Fecha de caducidad en ms desde «expiresAt» (segundos, milisegundos o ISO). Sin dato: ttl por defecto. */
    _expiry(v) {
      const n = typeof v === 'number' ? v : (typeof v === 'string' && v ? (/^\d+$/.test(v) ? Number(v) : Date.parse(v)) : NaN);
      if (!Number.isFinite(n)) return this.now() + this.ttlMs;
      return n < 1e11 ? n * 1000 : n;
    }

    async resolve(trackId) {
      if (!ID_RE.test(String(trackId || ''))) throw this._err('bad-track-id', 'trackId no válido');
      if (!this._fetch) throw this._err('no-fetch', 'fetch no disponible');
      const t = this.now();
      const hit = this.cache.get(trackId);
      if (hit && hit.expires - 30000 > t) return hit.info;
      const f = this.failed.get(trackId);
      if (f && f.until > t) throw this._err(f.code, 'sin audio autorizado para esta pista (en caché)');
      if (this.inflight.has(trackId)) return this.inflight.get(trackId);
      const p = this._request(trackId).finally(() => this.inflight.delete(trackId));
      this.inflight.set(trackId, p);
      return p;
    }
    _err(code, message) { const e = new Error(message); e.code = code; return e; }

    async _request(trackId) {
      const ctl = typeof root.AbortController === 'function' ? new root.AbortController() : null;
      const timer = ctl ? this._st(() => ctl.abort(), this.timeoutMs) : null;
      let res;
      try { res = await this._fetch(this.requestUrl(trackId), { headers: { Accept: 'application/json' }, credentials: 'omit', cache: 'no-store', signal: ctl ? ctl.signal : undefined }); }
      catch (e) { throw this._err('resolver-network', String((e && e.message) || e)); }
      finally { if (timer) this._ct(timer); }
      if (!res.ok) {
        const code = 'resolver-http-' + res.status;
        if (res.status === 404 || res.status === 410 || res.status === 403) this.failed.set(trackId, { code, until: this.now() + this.failTtlMs });
        throw this._err(code, 'el conector respondió ' + res.status);
      }
      let j; try { j = await res.json(); } catch (e) { throw this._err('resolver-bad-json', 'respuesta no válida'); }
      if (!j || typeof j.url !== 'string' || !isAllowedAudioUrl(j.url)) throw this._err('resolver-bad-url', 'el conector no devolvió una URL de audio válida (https)');
      const info = { url: j.url, mimeType: typeof j.mimeType === 'string' ? j.mimeType : '', duration: Number(j.duration) > 0 ? Number(j.duration) : 0,
        title: typeof j.title === 'string' ? j.title : '', artist: typeof j.artist === 'string' ? j.artist : '', art: typeof j.art === 'string' && /^https:/.test(j.art) ? j.art : '' };
      this.cache.set(trackId, { info, expires: this._expiry(j.expiresAt) });
      this.failed.delete(trackId);
      return info;
    }
  }

  // ================= Reproductor =================
  class AudioPlayerManager {
    /** opts: { resolver? | resolverUrl?, fetch?, createAudio?, random?, volume?, maxAttempts?=5, delayMs?=1000, stallMs?=4000, preloadLeadS?=20, now?, setTimeout?, clearTimeout? } */
    constructor(opts) {
      opts = opts || {};
      this.resolver = opts.resolver || new StreamResolver({ url: opts.resolverUrl, fetch: opts.fetch });
      this.random = opts.random || Math.random;
      this.maxAttempts = opts.maxAttempts || 5;
      this.delayMs = opts.delayMs == null ? 1000 : opts.delayMs;
      this.stallMs = opts.stallMs || 4000;
      this.preloadLeadS = opts.preloadLeadS || 20;
      this.now = opts.now || (() => Date.now());
      this._st = opts.setTimeout || root.setTimeout.bind(root);
      this._ct = opts.clearTimeout || root.clearTimeout.bind(root);
      const make = opts.createAudio || (() => new root.Audio());
      this.audio = make(); this.nextAudioBuffer = make();                   // el segundo objeto solo precarga: nunca suena
      [this.audio, this.nextAudioBuffer].forEach((a) => { a.preload = 'auto'; a.crossOrigin = 'anonymous'; });
      this.nextAudioBuffer.muted = true;
      this.queue = []; this.order = []; this.pos = -1;
      this.repeat = 'off'; this.shuffle = false; this.autoplay = true;
      this.volume = Number.isFinite(opts.volume) ? Math.max(0, Math.min(100, opts.volume)) : 80;
      this.playlist = ''; this.wantPlay = false; this.userPaused = false; this.state = 'unstarted';
      this.skipStreak = 0; this.nextPreload = null; this.nextReady = false; this.preparedId = null;
      this.attempts = 0; this.gaveUp = false; this.lastPos = 0; this.blocked = false;
      this.timer = null; this.stallTimer = null; this.watchTimer = null;
      this._token = 0; this._loading = false; this._pendingSeek = 0; this._failedResolve = false;
      this._subs = {}; this._off = []; this.log = [];
      this.audio.volume = this.volume / 100;
      this._bind();
    }

    // ---- eventos ----
    on(evt, fn) { (this._subs[evt] = this._subs[evt] || []).push(fn); return () => { this._subs[evt] = (this._subs[evt] || []).filter((f) => f !== fn); }; }
    _emit(evt, data) { (this._subs[evt] || []).slice().forEach((fn) => { try { fn(data); } catch (e) { /* un oyente roto no afecta a los demás */ } }); }
    _log(event, data) { this.log.push({ t: this.now(), event, data: data || null }); if (this.log.length > 200) this.log.shift(); }
    getLog() { return this.log.slice(); }
    init() { return Promise.resolve(); }                                    // sin API externa que cargar; existe por compatibilidad con PlayerManager

    _wantsSound() { return !!this.wantPlay && !this.userPaused; }
    _setState(s) {
      this.state = s;
      const cur = this.current();
      this._emit('state', { state: s, time: this.getTime(), videoId: cur && cur.id });
    }

    _bind() {
      const a = this.audio;
      const on = (evt, fn) => { a.addEventListener(evt, fn); this._off.push(() => a.removeEventListener(evt, fn)); };
      on('playing', () => {
        this._loading = false; this.skipStreak = 0; this.blocked = false;
        if (this.attempts > 0) this._log('recovered', { attempts: this.attempts, at: this.getTime() });
        this.attempts = 0; this.gaveUp = false; this._clearTimers();
        this._setState('playing');
        this._releaseBuffer();
      });
      on('pause', () => {
        if (a.ended || this._loading) return;
        this._setState('paused');
        if (this._wantsSound()) this._armStall('system-pause', 300);   // el sistema pausó (llamada, auriculares, iOS): se intenta volver a sonar
      });
      on('waiting', () => { if (this._wantsSound() && !this._loading) { this._setState('buffering'); this._armStall('waiting'); } });
      on('stalled', () => { if (this._wantsSound()) this._armStall('stalled'); });
      on('loadedmetadata', () => {
        if (this._pendingSeek > 0) { try { a.currentTime = this._pendingSeek; } catch (e) { this._log('seek-failed'); } }
        this._pendingSeek = 0; this._emit('duration', { duration: this.getDuration() });
      });
      on('durationchange', () => this._emit('duration', { duration: this.getDuration() }));
      on('timeupdate', () => {
        const d = this.getDuration();
        if (d > 0 && d - a.currentTime <= this.preloadLeadS) this.prepareNext();   // faltan ≤ 20 s: la siguiente ya está lista
      });
      on('seeked', () => this._emit('seeked', { time: this.getTime() }));
      on('ratechange', () => this._emit('rate', { rate: a.playbackRate }));
      on('error', () => { const e = a.error; this._onMediaError(e && e.code ? e.code : 0); });
      on('ended', () => { this._setState('ended'); this._onEnded(); });
      const buf = this.nextAudioBuffer;
      const onBuf = (evt, fn) => { buf.addEventListener(evt, fn); this._off.push(() => buf.removeEventListener(evt, fn)); };
      onBuf('canplaythrough', () => { this.nextReady = true; this._emit('preload', { videoId: this.preparedId, ready: true }); });
      onBuf('error', () => { this.nextReady = false; this._log('preload-error', { id: this.preparedId }); });
    }

    destroy() {
      this._clearTimers(); this._off.forEach((f) => { try { f(); } catch (e) { /* ya quitado */ } }); this._off = [];
      try { this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); } catch (e) { /* sin elemento */ }
      this._releaseBuffer(); this._token++;
    }

    // ---- cola ----
    static normalize(item) {
      if (!item || !ID_RE.test(String(item.id || ''))) return null;
      if (item.kind === 'video') return null;               // los vídeos normales tienen su apartado y su reproductor
      return { id: String(item.id), title: String(item.title || ''), artist: String(item.artist || ''), art: item.art || '', duration: Number(item.duration) || 0 };
    }

    setQueue(items, startIndex, playlist) {
      this.queue = (items || []).map(AudioPlayerManager.normalize).filter(Boolean);
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

    modes() { return { repeat: this.repeat, shuffle: this.shuffle, autoplay: this.autoplay }; }
    setShuffle(on) { this.shuffle = !!on; if (this.queue.length) this._rebuildOrder(Math.max(this.currentIndex(), 0)); this._modeChanged(); }
    setRepeat(mode) { this.repeat = ['off', 'all', 'one'].includes(mode) ? mode : 'off'; this._modeChanged(); }
    setAutoplay(on) { this.autoplay = !!on; }
    _modeChanged() { this.preparedId = null; this.nextPreload = null; this._emit('mode', this.modes()); if (this.current()) this.prepareNext(); }

    // ---- precarga de la siguiente ----
    /** Resuelve y precarga la siguiente pista en nextAudioBuffer (oculto, en silencio). Devuelve true si se inició una precarga nueva. */
    async prepareNext() {
      const n = this.peekNext(), cur = this.current();
      if (!n || !cur || (n.id === cur.id)) { this.nextPreload = null; return false; }   // repetir una: el audio actual ya está en caché
      if (this.preparedId === n.id) return false;
      this.preparedId = n.id; this.nextPreload = n.id; this.nextReady = false;
      let info;
      try { info = await this.resolver.resolve(n.id); }
      catch (e) { if (this.preparedId === n.id) this.preparedId = null; this._log('preload-resolve-failed', { id: n.id, code: e && e.code }); return false; }
      const again = this.peekNext();
      if (!again || again.id !== n.id || this.preparedId !== n.id) return false;        // la cola cambió mientras tanto
      try { this.nextAudioBuffer.src = info.url; this.nextAudioBuffer.load(); } catch (e) { this._log('preload-failed'); return false; }
      this._emit('preload', { videoId: n.id, item: n, ready: false });
      return true;
    }
    _releaseBuffer() {                                                      // memoria: el buffer se suelta cuando la pista ya está sonando
      const b = this.nextAudioBuffer;
      try { if (b.getAttribute && b.getAttribute('src')) { b.removeAttribute('src'); b.load(); } } catch (e) { /* nada que soltar */ }
      this.nextReady = false;
    }

    // ---- reproducción ----
    /** Carga una URL en el elemento principal. Con autoplay empieza a sonar; si no, queda lista (cued). */
    async _load(url, startSeconds, autoplay) {
      const a = this.audio;
      this._loading = true; this._pendingSeek = Math.max(0, Number(startSeconds) || 0);
      a.src = url;
      try { a.load(); } catch (e) { /* sin load() */ }
      if (!autoplay) { this._loading = false; this._setState('cued'); return true; }
      this._setState('buffering');
      this._armStall('load');                                               // si no llega a sonar, el reintento se dispara solo
      return this._tryPlay();
    }

    _tryPlay() {
      let p; try { p = this.audio.play(); } catch (e) { p = Promise.reject(e); }
      return Promise.resolve(p).then(() => true).catch((e) => {
        const name = e && e.name;
        if (name === 'AbortError') return true;                             // una carga nueva interrumpió la anterior: normal
        if (name === 'NotAllowedError') {                                   // el sistema exige un gesto del usuario: no se reintenta en bucle
          this.blocked = true; this.wantPlay = false; this._clearTimers(); this._loading = false;
          this._log('autoplay-blocked'); this._setState('paused');
          this._emit('error', { code: 'autoplay-blocked', message: 'La reproducción necesita un toque del usuario', recoverable: false, blocked: true });
          return false;
        }
        this._onMediaError(4);
        return false;
      });
    }

    async playIndex(queueIndex, opts) {
      opts = opts || {};
      const at = this.order.indexOf(queueIndex);
      if (at < 0) return false;
      this.pos = at;
      const item = this.queue[queueIndex];
      this.userPaused = false; this.blocked = false; this._failedResolve = false;
      this.wantPlay = opts.autoplay !== false;
      this.attempts = 0; this.gaveUp = false; this._clearTimers();
      this.lastPos = Math.max(0, Number(opts.startSeconds) || 0);
      const token = ++this._token;
      this._emit('track', { item, index: queueIndex, playlist: this.playlist });
      if (this.wantPlay) this._setState('buffering');
      let info;
      try { info = await this.resolver.resolve(item.id); }
      catch (e) {
        if (token !== this._token) return false;                            // otra pista pidió el relevo: no es un error
        this._failedResolve = true; this.wantPlay = false; this._setState('unstarted');
        this._log('resolve-failed', { id: item.id, code: e && e.code });
        this._emit('error', { code: (e && e.code) || 'resolve', message: String((e && e.message) || e), videoId: item.id, recoverable: false, resolve: true });
        return false;
      }
      if (token !== this._token) return false;
      if (!item.duration && info.duration) item.duration = info.duration;
      const ok = await this._load(info.url, opts.startSeconds, this.wantPlay);
      if (token !== this._token) return false;
      this.preparedId = null; this.prepareNext();                           // la siguiente se precarga nada más empezar esta
      return ok;
    }

    /** Avanza saltando las pistas sin audio autorizado (solo con la cola propia; con la cola de la app, la app decide). */
    async _playAndSkip(queueIndex, opts) {
      const ok = await this.playIndex(queueIndex, opts);
      if (!ok && this._failedResolve && this.autoplay) {
        this.skipStreak++;
        if (this.skipStreak >= this.queue.length) { this.wantPlay = false; this._emit('queueExhausted', {}); return false; }
        return this.next({ auto: true });
      }
      return ok;
    }

    play() {
      const a = this.audio;
      if (!a.getAttribute || !a.getAttribute('src')) return this.queue.length ? this._playAndSkip(this.currentIndex() < 0 ? 0 : this.currentIndex()) : false;
      this.userPaused = false; this.wantPlay = true; this.attempts = 0; this.gaveUp = false; this.blocked = false;
      this._tryPlay(); return true;
    }
    pause() {
      this.userPaused = true; this.wantPlay = false;
      this._clearTimers(); this.attempts = 0;                                // la pausa del usuario cancela cualquier reintento pendiente
      try { this.audio.pause(); } catch (e) { /* sin elemento */ }
    }
    toggle() { return this.state === 'playing' || this.state === 'buffering' ? this.pause() : this.play(); }
    seek(s) { try { this.audio.currentTime = Math.max(0, Number(s) || 0); } catch (e) { this._pendingSeek = Math.max(0, Number(s) || 0); } }
    setVolume(v) { this.volume = Math.max(0, Math.min(100, Number(v) || 0)); this.audio.volume = this.volume / 100; this._emit('volume', this.volume); }
    getPlaybackRate() { const r = this.audio.playbackRate; return Number.isFinite(r) && r > 0 ? r : 1; }

    _onEnded() {
      this._clearTimers();
      if (!this.autoplay) { this.wantPlay = false; this._emit('ended', { auto: false }); return; }
      if (this.repeat === 'one') { this.seek(0); this._tryPlay(); return; }   // mismo elemento, mismo audio ya cargado: sin silencio
      this._emit('ended', { auto: true });
      this.next({ auto: true });
    }

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
      return this._playAndSkip(this.order[np]);
    }
    prev() {
      if (!this.queue.length) return false;
      if (this.getTime() > 3) { this.seek(0); return true; }
      const pp = this.pos > 0 ? this.pos - 1 : (this.repeat === 'all' ? this.order.length - 1 : 0);
      return this._playAndSkip(this.order[pp]);
    }

    getTime() {
      const t = this.audio.currentTime;
      if (this._pendingSeek > 0 && !(t > 0)) return this._pendingSeek;       // todavía cargando: se informa del punto al que se va a saltar
      return Number.isFinite(t) ? t : 0;
    }
    getDuration() {
      const d = this.audio.duration;
      if (Number.isFinite(d) && d > 0) return d;
      const c = this.current(); return c && c.duration > 0 ? c.duration : 0;
    }

    // ---- recuperación: guarda el segundo exacto, espera, reintenta (máx. 5) ----
    _clearTimers() { ['timer', 'stallTimer', 'watchTimer'].forEach((k) => { if (this[k]) { this._ct(this[k]); this[k] = null; } }); }

    _armStall(why, ms) {
      if (this.stallTimer || this.timer) return;
      this.stallTimer = this._st(() => {
        this.stallTimer = null;
        if (!this._wantsSound() || this.state === 'playing') return;
        if (why === 'system-pause') {                                       // primero lo más barato: pedir play otra vez al audio que sigue cargado
          this._log('soft-resume', { at: this.getTime() }); this._tryPlay(); this._armStall('system-pause-failed'); return;
        }
        this._trouble('stall-' + why);
      }, ms || this.stallMs);
    }

    _onMediaError(code) {
      if (this._loading && code === 1) return;                               // MEDIA_ERR_ABORTED por nuestra propia carga
      const cur = this.current();
      this._emit('error', { code, videoId: cur && cur.id, recoverable: true });
      this.resolver.invalidate && cur && this.resolver.invalidate(cur.id);   // la URL puede haber caducado: la próxima vez se pide de nuevo
      this._trouble('media-error-' + code);
    }

    _trouble(reason) {
      this._log('trouble', { reason });
      if (!this._wantsSound()) { this._log('ignored-user-paused', { reason }); return false; }
      if (this.timer || this.gaveUp) return false;
      if (this.attempts >= this.maxAttempts) { this._giveUp(); return false; }
      const t = this.getTime(); if (t > 0) this.lastPos = t;                  // segundo exacto
      this.timer = this._st(() => { this.timer = null; this._retry(reason); }, this.delayMs * Math.min(this.attempts + 1, 3));
      return true;
    }

    _giveUp() {
      this.gaveUp = true; this._clearTimers();
      const cur = this.current();
      this._log('gaveup', { attempts: this.attempts, lastPos: this.lastPos });
      this._emit('error', { code: 'gaveup', videoId: cur && cur.id, recoverable: false });
      if (this.autoplay && this.queue.length > 1) { this.skipStreak++; if (this.skipStreak < this.queue.length) this.next({ auto: true }); else { this.wantPlay = false; this._emit('queueExhausted', {}); } }
    }

    async _retry(reason) {
      if (!this._wantsSound()) { this.attempts = 0; this._clearTimers(); this._log('cancelled-user-paused'); return; }
      const cur = this.current(); if (!cur) return;
      this.attempts++;
      const n = this._online();
      this._log('retry', { attempt: this.attempts, reason, from: this.lastPos, online: n });
      if (n) {
        try {
          this.resolver.invalidate && this.resolver.invalidate(cur.id);
          const info = await this.resolver.resolve(cur.id);
          if (this._wantsSound() && this.current() === cur) await this._load(info.url, this.lastPos, true);
        } catch (e) { this._log('retry-failed', { message: String((e && e.message) || e) }); }
      }
      if (this.watchTimer) this._ct(this.watchTimer);
      this.watchTimer = this._st(() => {
        this.watchTimer = null;
        if (this.state === 'playing') return;
        if (!this._wantsSound()) { this.attempts = 0; this._log('cancelled-user-paused'); return; }
        if (this.attempts < this.maxAttempts) this._trouble('no-playing-after-retry'); else this._giveUp();
      }, this.stallMs);
    }
    _online() { const n = root.navigator; return !n || n.onLine !== false; }

    /** Reanuda la pista actual desde un segundo (al volver a primer plano, tras una interrupción). Sin volver a descargar si el audio sigue cargado. */
    async resumeFrom(seconds) {
      const cur = this.current();
      if (!cur) return false;
      const s = Math.max(0, Number(seconds) || 0), a = this.audio;
      this.wantPlay = true; this.userPaused = false; this.blocked = false; this.gaveUp = false;
      if (a.getAttribute && a.getAttribute('src') && !a.error && a.readyState >= 1) {
        if (Math.abs(a.currentTime - s) > 2) { try { a.currentTime = s; } catch (e) { /* sin seek */ } }
        return this._tryPlay();
      }
      let info;
      try { info = await this.resolver.resolve(cur.id); } catch (e) { this._log('resume-resolve-failed', { code: e && e.code }); return false; }
      return this._load(info.url, s, true);
    }

    /** Restaura un estado guardado sin sonar (queda en pausa lista para pulsar play). */
    async restore(s) {
      if (!s || !Array.isArray(s.queue)) return false;
      this.shuffle = !!s.shuffle; this.repeat = ['off', 'all', 'one'].includes(s.repeat) ? s.repeat : 'off';
      if (Number.isFinite(s.volume)) { this.volume = Math.max(0, Math.min(100, s.volume)); this.audio.volume = this.volume / 100; }
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

  AudioPlayerManager.ID_RE = ID_RE;
  NS.AudioPlayerManager = AudioPlayerManager; NS.StreamResolver = StreamResolver; NS.isAllowedAudioUrl = isAllowedAudioUrl;
})(globalThis);
if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.NSoundExperimental;
