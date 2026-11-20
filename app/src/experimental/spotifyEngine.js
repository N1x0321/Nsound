/* EXPERIMENTAL (flag ENABLE_SPOTIFY_ENGINE, APAGADO): esqueleto de motor OFICIAL de Spotify detrás de PlaybackEngineAdapter.
   Reproduce SOLO con el Web Playback SDK oficial (https://sdk.scdn.co/spotify-player.js) y la Web API oficial de Spotify:
     · el usuario inicia sesión él mismo y necesita Spotify Premium; este módulo NO implementa el inicio de sesión: recibe una función
       getToken() que devuelve un token OAuth del propio usuario (flujo PKCE a cargo de la app);
     · el audio y los anuncios los gestiona Spotify; no se extrae, no se descarga, no se cachea y no se mezcla con otras fuentes (drm: true);
     · el Web Playback SDK NO funciona en WebView móvil (iOS/Android): en el móvil el equivalente oficial es Spotify App Remote (nativo, necesita
       la app de Spotify instalada) y quedaría detrás de este mismo contrato. Aquí solo escritorio/navegador.
   Revisa siempre la política vigente de desarrolladores de Spotify antes de activarlo. */
(function (root) {
  'use strict';
  const NS = root.NSoundExperimental = root.NSoundExperimental || {};
  const API = 'https://api.spotify.com/v1';
  const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
  const URI_RE = /^spotify:track:[A-Za-z0-9]{22}$/;

  function Base() { return root.LS && root.LS.engines && root.LS.engines.PlaybackEngineAdapter; }

  /** Crea la clase sobre PlaybackEngineAdapter (que existe cuando el router está cargado). */
  function define() {
    const Adapter = Base();
    if (!Adapter) return null;
    return class SpotifyEngine extends Adapter {
      /** opts: { getToken: () => Promise<string>, name?, fetch?, loadSdk?: () => Promise<SpotifyGlobal>, volume?: 0-100 } */
      constructor(opts) {
        super();
        opts = opts || {};
        this.getToken = typeof opts.getToken === 'function' ? opts.getToken : null;
        this.deviceName = opts.name || 'Nsound';
        this._fetch = opts.fetch || (root.fetch ? root.fetch.bind(root) : null);
        this._loadSdk = opts.loadSdk || SpotifyEngine.defaultLoadSdk;
        this.volume = Number.isFinite(opts.volume) ? Math.max(0, Math.min(100, opts.volume)) : 80;
        this.player = null; this.deviceId = ''; this.ready = false; this.current = null; this._last = null; this._ended = false;
      }
      get id() { return 'spotify'; }
      get capabilities() { return { seek: true, volume: true, eq: false, crossfade: false, offline: false, background: false, needsLogin: true, drm: true, cacheable: false }; }
      canPlay(track) { return !!track && track.src === 'spotify' && URI_RE.test(String(track.ref || track.uri || '')); }

      static defaultLoadSdk() {
        return new Promise((resolve, reject) => {
          if (root.Spotify && root.Spotify.Player) { resolve(root.Spotify); return; }
          if (!root.document) { reject(new Error('sin documento: el Web Playback SDK solo funciona en un navegador')); return; }
          root.onSpotifyWebPlaybackSDKReady = () => resolve(root.Spotify);
          const s = root.document.createElement('script'); s.src = SDK_URL; s.async = true;
          s.onerror = () => reject(new Error('no se pudo cargar el Web Playback SDK'));
          root.document.head.appendChild(s);
        });
      }

      _err(code, message, recoverable) { this._emit({ type: 'error', error: { code, message, recoverable: !!recoverable } }); }

      /** Conecta el dispositivo «Nsound» en la cuenta del usuario. Idempotente. */
      async connect() {
        if (this.ready) return true;
        if (!this.getToken) { this._err('auth-required', 'Falta iniciar sesión en Spotify (getToken)', false); return false; }
        let S;
        try { S = await this._loadSdk(); } catch (e) { this._err('sdk-load', String((e && e.message) || e), true); return false; }
        return new Promise((resolve) => {
          const p = new S.Player({ name: this.deviceName, getOAuthToken: (cb) => { Promise.resolve(this.getToken()).then(cb, () => this._err('auth-token', 'No se pudo obtener el token', true)); }, volume: this.volume / 100 });
          this.player = p;
          p.addListener('ready', ({ device_id }) => { this.deviceId = device_id; this.ready = true; resolve(true); });
          p.addListener('not_ready', () => { this.ready = false; this._emit({ type: 'state', state: 'idle' }); });
          p.addListener('initialization_error', (e) => { this._err('init', e && e.message, false); resolve(false); });          // navegador sin EME/DRM
          p.addListener('authentication_error', (e) => { this._err('auth', e && e.message, false); resolve(false); });
          p.addListener('account_error', (e) => { this._err('premium-required', (e && e.message) || 'Spotify Premium es obligatorio', false); resolve(false); });
          p.addListener('playback_error', (e) => this._err('playback', e && e.message, true));
          p.addListener('player_state_changed', (st) => this._onState(st));
          p.connect();
        });
      }

      _onState(st) {
        if (!st) { this._emit({ type: 'state', state: 'idle' }); return; }
        const cur = st.track_window && st.track_window.current_track;
        const meta = cur ? { id: cur.id, uri: cur.uri, title: cur.name, artist: (cur.artists || []).map((a) => a.name).join(', '), album: cur.album && cur.album.name,
          art: cur.album && cur.album.images && cur.album.images[0] && cur.album.images[0].url, duration: (st.duration || 0) / 1000, src: 'spotify', drm: true } : null;
        const key = cur && cur.uri;
        if (key && key !== this._last) { this._last = key; this._ended = false; this._emit({ type: 'track', track: meta }); }
        this._emit({ type: 'state', state: st.loading ? 'loading' : st.paused ? 'paused' : 'playing', position: (st.position || 0) / 1000, duration: (st.duration || 0) / 1000 });
        this._emit({ type: 'progress', position: (st.position || 0) / 1000, duration: (st.duration || 0) / 1000 });
        // Fin de pista según el SDK: en pausa, posición 0 y la pista actual ya figura entre las anteriores
        const prev = (st.track_window && st.track_window.previous_tracks) || [];
        if (st.paused && st.position === 0 && cur && prev.some((t) => t.uri === cur.uri) && !this._ended) { this._ended = true; this._emit({ type: 'ended' }); }
      }

      async _api(method, path, body) {
        if (!this._fetch) throw new Error('fetch no disponible');
        const token = await this.getToken();
        const res = await this._fetch(API + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        if (res.status === 401) this._err('auth', 'Sesión de Spotify caducada', false);
        else if (res.status === 403) this._err('premium-required', 'Spotify Premium es obligatorio', false);
        else if (res.status === 404) this._err('no-device', 'Dispositivo Nsound no encontrado en Spotify', true);
        else if (res.status === 429) this._err('rate-limit', 'Demasiadas peticiones a Spotify', true);
        return res.status >= 200 && res.status < 300;
      }

      /** Spotify no permite precargar la siguiente: no hace nada (entre motores habrá un pequeño silencio). */
      async prepare() {}

      async play(track, opts) {
        if (!this.canPlay(track)) { this._err('bad-track', 'No es una pista de Spotify válida', false); return false; }
        if (!(await this.connect())) return false;
        const uri = String(track.ref || track.uri);
        this.current = track; this._ended = false;
        const start = Math.max(0, Math.round(((opts && opts.startAt) || 0) * 1000));
        return this._api('PUT', '/me/player/play?device_id=' + encodeURIComponent(this.deviceId), { uris: [uri], position_ms: start });
      }
      async pause() { if (this.player) await this.player.pause(); }
      async resume() { if (this.player) await this.player.resume(); }
      async seek(s) { if (this.player) await this.player.seekTo(Math.max(0, Math.round(s * 1000))); }
      async setVolume(v) { this.volume = Math.max(0, Math.min(100, Number(v) || 0)); if (this.player) await this.player.setVolume(this.volume / 100); }
      /** Al ceder el turno a otro motor se pausa y se suelta el dispositivo: solo suena un motor a la vez y no queda una segunda sesión multimedia. */
      async stop() { if (this.player) { try { await this.player.pause(); } catch (e) { /* ya parado */ } try { this.player.disconnect(); } catch (e) { /* ya desconectado */ } } this.ready = false; this.player = null; this._last = null; }
    };
  }

  /** Devuelve el motor, o null si el interruptor está apagado (por defecto) o el router no está cargado. Nunca se registra solo. */
  NS.createSpotifyEngine = function (opts) {
    if (!(NS.config && NS.config.ENABLE_SPOTIFY_ENGINE === true)) return null;
    const C = define();
    return C ? new C(opts) : null;
  };
  NS.defineSpotifyEngine = define;     // para pruebas
  NS.SPOTIFY_URI_RE = URI_RE;
})(globalThis);
if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.NSoundExperimental;
