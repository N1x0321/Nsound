// Esqueleto del motor oficial de Spotify: apagado por defecto, contrato PlaybackEngineAdapter y eventos normalizados con un SDK FALSO (no se contacta con Spotify).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../src/js/03-router.js');
require('../src/experimental/config.js');
require('../src/experimental/spotifyEngine.js');
const NS = globalThis.NSoundExperimental, LS = globalThis.LS;
const URI = 'spotify:track:' + 'a'.repeat(22);
const track = { src: 'spotify', ref: URI, title: 'x', drm: true };

function fakeSdk() {
  const S = { players: [] };
  S.Player = class {
    constructor(o) { this.o = o; this.h = {}; this.calls = []; S.players.push(this); }
    addListener(e, f) { this.h[e] = f; }
    connect() { this.calls.push('connect'); setTimeout(() => this.h.ready({ device_id: 'dev1' }), 0); }
    pause() { this.calls.push('pause'); } resume() { this.calls.push('resume'); }
    seekTo(ms) { this.calls.push('seek:' + ms); } setVolume(v) { this.calls.push('vol:' + v); } disconnect() { this.calls.push('disconnect'); }
  };
  return S;
}
function make(extra) {
  const S = fakeSdk(), reqs = [];
  NS.config.ENABLE_SPOTIFY_ENGINE = true;
  const e = NS.createSpotifyEngine(Object.assign({ getToken: async () => 'TOK', loadSdk: async () => S, fetch: async (u, o) => { reqs.push({ u, o }); return { status: 204 }; } }, extra));
  NS.config.ENABLE_SPOTIFY_ENGINE = false;
  const ev = []; e.on((x) => ev.push(x));
  return { e, S, reqs, ev };
}

test('apagado por defecto: no se crea ningún motor', () => {
  assert.equal(NS.config.ENABLE_SPOTIFY_ENGINE, false);
  assert.equal(NS.createSpotifyEngine({ getToken: async () => 't' }), null);
});

test('contrato: id, capacidades con DRM y sin caché, canPlay solo para URIs de pista de Spotify', () => {
  const { e } = make();
  assert.ok(e instanceof LS.engines.PlaybackEngineAdapter);
  assert.equal(e.id, 'spotify'); assert.equal(e.capabilities.drm, true); assert.equal(e.capabilities.cacheable, false);
  assert.equal(e.capabilities.eq, false); assert.equal(e.capabilities.needsLogin, true);
  assert.equal(e.canPlay(track), true);
  assert.equal(e.canPlay({ src: 'yt', ref: URI }), false);
  assert.equal(e.canPlay({ src: 'spotify', ref: 'spotify:album:' + 'a'.repeat(22) }), false);
  assert.equal(e.canPlay({ src: 'spotify', ref: 'javascript:alert(1)' }), false);
  assert.equal(e.canPlay(null), false);
});

test('play: conecta el dispositivo y pide la reproducción a la Web API oficial con el token del usuario', async () => {
  const { e, S, reqs } = make();
  assert.equal(await e.play(track, { startAt: 12.5 }), true);
  assert.equal(S.players.length, 1); assert.equal(e.deviceId, 'dev1');
  assert.equal(reqs.length, 1); assert.equal(reqs[0].u, 'https://api.spotify.com/v1/me/player/play?device_id=dev1');
  assert.equal(reqs[0].o.method, 'PUT'); assert.equal(reqs[0].o.headers.Authorization, 'Bearer TOK');
  assert.deepEqual(JSON.parse(reqs[0].o.body), { uris: [URI], position_ms: 12500 });
  await e.play(track); assert.equal(S.players.length, 1, 'no crea otro dispositivo');
});

test('sin getToken no hay sesión: error auth-required y no se contacta con nada', async () => {
  const { e, reqs, ev } = make({ getToken: null });
  assert.equal(await e.play(track), false);
  assert.ok(ev.some((x) => x.type === 'error' && x.error.code === 'auth-required' && x.error.recoverable === false));
  assert.equal(reqs.length, 0);
});

test('eventos del SDK → eventos normalizados (pista, estado, progreso, fin)', async () => {
  const { e, S, ev } = make(); await e.connect();
  const p = S.players[0];
  const cur = { id: 'i1', uri: URI, name: 'Canción', artists: [{ name: 'A' }, { name: 'B' }], album: { name: 'Disco', images: [{ url: 'https://img/1' }] } };
  p.h.player_state_changed({ paused: false, loading: false, position: 5000, duration: 200000, track_window: { current_track: cur, previous_tracks: [] } });
  const t = ev.find((x) => x.type === 'track').track;
  assert.equal(t.title, 'Canción'); assert.equal(t.artist, 'A, B'); assert.equal(t.duration, 200); assert.equal(t.drm, true); assert.equal(t.src, 'spotify');
  assert.deepEqual(ev.find((x) => x.type === 'state'), { type: 'state', state: 'playing', position: 5, duration: 200 });
  const fin = { paused: true, loading: false, position: 0, duration: 200000, track_window: { current_track: cur, previous_tracks: [cur] } };
  p.h.player_state_changed(fin);
  assert.equal(ev.filter((x) => x.type === 'ended').length, 1);
  p.h.player_state_changed(fin);
  assert.equal(ev.filter((x) => x.type === 'ended').length, 1, 'el fin se avisa una sola vez');
  p.h.player_state_changed(null); assert.equal(ev[ev.length - 1].state, 'idle');
});

test('errores del SDK: Premium obligatorio, autenticación y navegador sin DRM no son recuperables', async () => {
  for (const [evt, code] of [['account_error', 'premium-required'], ['authentication_error', 'auth'], ['initialization_error', 'init']]) {
    const { e, S, ev } = make();
    S.Player.prototype.connect = function () { this.h[evt]({ message: 'm' }); };
    assert.equal(await e.connect(), false);
    assert.ok(ev.some((x) => x.type === 'error' && x.error.code === code && x.error.recoverable === false), code);
  }
});

test('Web API: 403 → Premium; 429 → recuperable; controles delegan en el SDK; stop suelta el dispositivo', async () => {
  const a = make({ fetch: async () => ({ status: 403 }) });
  assert.equal(await a.e.play(track), false);
  assert.ok(a.ev.some((x) => x.error && x.error.code === 'premium-required'));
  const m = make({ fetch: async () => ({ status: 429 }) }); await m.e.play(track);
  assert.ok(m.ev.some((x) => x.error && x.error.code === 'rate-limit' && x.error.recoverable === true));
  const k = make(); await k.e.connect(); const p = k.S.players[0];
  await k.e.pause(); await k.e.resume(); await k.e.seek(30); await k.e.setVolume(50);
  assert.deepEqual(p.calls.slice(1), ['pause', 'resume', 'seek:30000', 'vol:0.5']);
  await k.e.stop(); assert.ok(p.calls.includes('disconnect')); assert.equal(k.e.ready, false);
});

test('el motor no usa ninguna caché ni descarga de audio', () => {
  const src = readFileSync(new URL('../src/experimental/spotifyEngine.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.equal(/localStorage|indexedDB|caches\.|createWriteStream|writeFile/.test(src), false);
});
