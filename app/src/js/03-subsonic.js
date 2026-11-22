/* Cliente de la API Subsonic (la que habla Navidrome): tu propio servidor de música, con tus propios archivos.
   Sin DOM: se prueba con Node. Solo se usa en la app de iPhone de pruebas («Nsound Motores», LS.enginesEnabled); en el resto nadie lo llama.
   No guarda la contraseña: solo el token (md5(contraseña + sal)) y la sal, como pide el protocolo.
   Las llamadas van por el puente de mismo origen /__nd (Navidrome no envía cabeceras CORS); ver app/dev/server.mjs. */
var LS = globalThis.LS = globalThis.LS || {};
(function (LS) {
  'use strict';

  const API_VERSION = '1.16.1', CLIENT = 'nsound';
  const STORE_KEY = 'nsound_experimental_navidrome';
  const ENDPOINTS = ['ping', 'search3', 'getAlbumList2', 'getAlbum', 'getArtists', 'getArtist', 'getRandomSongs', 'getPlaylists', 'getPlaylist', 'getSong', 'stream', 'getCoverArt'];
  const NEEDS_TRANSCODE = /^(ogg|oga|opus|wma|wv|ape|mpc)$/i;   // formatos que Safari/iOS no reproduce: el servidor los pasa a MP3 al vuelo

  // ---------- MD5 (el protocolo Subsonic lo exige para el token) ----------
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0);
  const SH = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const rotl = (x, n) => (x << n) | (x >>> (32 - n));
  function md5(input) {
    const msg = Array.from(new TextEncoder().encode(String(input)));
    const len = msg.length;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    const hi = Math.floor(len / 536870912), lo = (len * 8) >>> 0;
    for (let i = 0; i < 4; i++) msg.push((lo >>> (8 * i)) & 255);
    for (let i = 0; i < 4; i++) msg.push((hi >>> (8 * i)) & 255);
    let a0 = 0x67452301 | 0, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476 | 0;
    for (let off = 0; off < msg.length; off += 64) {
      const M = new Array(16);
      for (let j = 0; j < 16; j++) M[j] = msg[off + 4 * j] | (msg[off + 4 * j + 1] << 8) | (msg[off + 4 * j + 2] << 16) | (msg[off + 4 * j + 3] << 24);
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        F = (F + A + K[i] + M[g]) | 0;
        A = D; D = C; C = B; B = (B + rotl(F, SH[i])) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    const hex = (n) => Array.from({ length: 4 }, (_, i) => ((n >>> (8 * i)) & 255).toString(16).padStart(2, '0')).join('');
    return hex(a0) + hex(b0) + hex(c0) + hex(d0);
  }

  function randomSalt() {
    const c = globalThis.crypto;
    if (c && c.getRandomValues) return Array.from(c.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
    return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  }
  /** { u, t, s } a partir de usuario y contraseña. La contraseña no se guarda en ningún sitio. */
  function makeAuth(user, password, salt) {
    const s = salt || randomSalt();
    return { u: String(user || ''), s, t: md5(String(password || '') + s) };
  }

  // ---------- Normalización de lo que devuelve el servidor ----------
  const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  function normSong(s) {
    if (!s || s.id == null || s.isVideo === true) return null;
    return { id: String(s.id), title: String(s.title || ''), artist: String(s.artist || ''), album: String(s.album || ''), duration: Number(s.duration) || 0,
      coverArt: String(s.coverArt || s.albumId || ''), track: Number(s.track) || 0, suffix: String(s.suffix || '') };
  }
  const normAlbum = (a) => (a && a.id != null ? { id: String(a.id), name: String(a.name || a.title || ''), artist: String(a.artist || ''), coverArt: String(a.coverArt || a.id), songCount: Number(a.songCount) || 0, year: Number(a.year) || 0 } : null);
  const normArtist = (a) => (a && a.id != null ? { id: String(a.id), name: String(a.name || ''), albumCount: Number(a.albumCount) || 0, coverArt: String(a.coverArt || '') } : null);
  const clean = (list, fn) => asList(list).map(fn).filter(Boolean);

  class SubsonicError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  class SubsonicClient {
    /** opts: { base?='/__nd', auth: { u, t, s }, sig?, fetch? }. sig: firma que el puente exige para stream y carátulas (ver /__nd/session). */
    constructor(opts) {
      opts = opts || {};
      if (!opts.auth || !opts.auth.u || !opts.auth.t || !opts.auth.s) throw new Error('Subsonic: faltan usuario, token y sal');
      this.base = String(opts.base == null ? '/__nd' : opts.base).replace(/\/+$/, '');
      this.auth = { u: opts.auth.u, t: opts.auth.t, s: opts.auth.s };
      this.sig = opts.sig || '';
      this._fetch = opts.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    }

    /** URL de un endpoint. media=true añade la firma del puente (stream y carátulas las pide el reproductor, que no lleva la cookie). */
    url(endpoint, params, media) {
      if (!ENDPOINTS.includes(endpoint)) throw new SubsonicError('bad-endpoint', 'endpoint no permitido: ' + endpoint);
      const p = new URLSearchParams({ u: this.auth.u, t: this.auth.t, s: this.auth.s, v: API_VERSION, c: CLIENT, f: 'json' });
      Object.keys(params || {}).forEach((k) => { const v = params[k]; if (v != null && v !== '') p.set(k, String(v)); });
      if (media && this.sig) p.set('lk', this.sig);
      return this.base + '/rest/' + endpoint + '?' + p.toString();
    }

    async call(endpoint, params) {
      if (!this._fetch) throw new SubsonicError('no-fetch', 'fetch no disponible');
      let res;
      try { res = await this._fetch(this.url(endpoint, params), { cache: 'no-store', credentials: 'same-origin' }); }
      catch (e) { throw new SubsonicError('network', String((e && e.message) || e)); }
      if (!res.ok) throw new SubsonicError('http-' + res.status, res.status === 404 ? 'El servidor Navidrome no está configurado en este servidor (falta ND_URL).' : 'El servidor respondió ' + res.status);
      let j; try { j = await res.json(); } catch (e) { throw new SubsonicError('bad-json', 'Respuesta no válida'); }
      const x = j && j['subsonic-response'];
      if (!x) throw new SubsonicError('bad-response', 'Respuesta no válida');
      if (x.status !== 'ok') throw new SubsonicError(String((x.error && x.error.code) || 'failed'), (x.error && x.error.message) || 'Error del servidor');
      return x;
    }

    async ping() { await this.call('ping'); return true; }
    async search(query, o) {
      o = o || {};
      const x = await this.call('search3', { query, songCount: o.songs == null ? 30 : o.songs, albumCount: o.albums == null ? 12 : o.albums, artistCount: o.artists == null ? 8 : o.artists });
      const r = x.searchResult3 || {};
      return { songs: clean(r.song, normSong), albums: clean(r.album, normAlbum), artists: clean(r.artist, normArtist) };
    }
    async randomSongs(n) { const x = await this.call('getRandomSongs', { size: n || 30 }); return clean(x.randomSongs && x.randomSongs.song, normSong); }
    async albumList(type, size, offset) { const x = await this.call('getAlbumList2', { type: type || 'newest', size: size || 24, offset: offset || 0 }); return clean(x.albumList2 && x.albumList2.album, normAlbum); }
    async album(id) { const x = await this.call('getAlbum', { id }); const a = x.album || {}; return { album: normAlbum(a), songs: clean(a.song, normSong).sort((p, q) => p.track - q.track) }; }
    async artists() { const x = await this.call('getArtists'); return asList(x.artists && x.artists.index).flatMap((i) => clean(i.artist, normArtist)); }
    async artist(id) { const x = await this.call('getArtist', { id }); const a = x.artist || {}; return { artist: normArtist(a), albums: clean(a.album, normAlbum) }; }
    async playlists() { const x = await this.call('getPlaylists'); return asList(x.playlists && x.playlists.playlist).filter((p) => p && p.id != null).map((p) => ({ id: String(p.id), name: String(p.name || ''), songCount: Number(p.songCount) || 0 })); }
    async playlist(id) { const x = await this.call('getPlaylist', { id }); const p = x.playlist || {}; return { name: String(p.name || ''), songs: clean(p.entry, normSong) }; }

    /** Audio original (con soporte de Range). Los formatos que iOS no reproduce se piden ya convertidos a MP3. */
    streamUrl(id, suffix) {
      const p = { id };
      if (NEEDS_TRANSCODE.test(suffix || '')) { p.format = 'mp3'; p.maxBitRate = 320; }
      return this.url('stream', p, true);
    }
    coverUrl(id, size) { return id ? this.url('getCoverArt', { id, size: size || 300 }, true) : ''; }
  }

  /** Pide al puente si Navidrome está configurado y la firma de medios. */
  async function fetchSession(base, fetchFn) {
    const f = fetchFn || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!f) return { configured: false, sig: '' };
    try {
      const r = await f(String(base == null ? '/__nd' : base).replace(/\/+$/, '') + '/session', { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) return { configured: false, sig: '' };
      const j = await r.json();
      return { configured: j.configured === true, sig: typeof j.sig === 'string' ? j.sig : '' };
    } catch (e) { return { configured: false, sig: '' }; }
  }

  // ---------- Sesión guardada (solo usuario, token y sal) ----------
  function loadSaved(storage) {
    try {
      const v = JSON.parse(storage.getItem(STORE_KEY));
      return v && v.u && v.t && v.s ? { u: String(v.u), t: String(v.t), s: String(v.s) } : null;
    } catch (e) { return null; }
  }
  function saveAuth(storage, auth) { try { storage.setItem(STORE_KEY, JSON.stringify({ u: auth.u, t: auth.t, s: auth.s })); return true; } catch (e) { return false; } }
  function clearSaved(storage) { try { storage.removeItem(STORE_KEY); } catch (e) { /* sin almacenamiento */ } }

  LS.Subsonic = { md5, makeAuth, SubsonicClient, SubsonicError, fetchSession, loadSaved, saveAuth, clearSaved, normSong, normAlbum, normArtist, ENDPOINTS, STORE_KEY, NEEDS_TRANSCODE };
})(LS);
if (typeof module !== 'undefined' && module.exports) module.exports = LS;
