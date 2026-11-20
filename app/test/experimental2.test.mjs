import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
for (const f of ['playerManager', 'stateManager', 'networkManager', 'mediaSession', 'iosManager', 'updateManager', 'config', 'experimentalBootstrap']) require(`../src/experimental/${f}.js`);
const sw = require('../src/experimental/sw-experimental.js');
const NS = globalThis.NSoundExperimental;

const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'];
const items = ids.map((id, i) => ({ id, title: 'Tema ' + i, artist: 'Artista', art: 'https://i.ytimg.com/vi/' + id + '/hq.jpg' }));
function mockYT() {
  const made = [];
  class Player {
    constructor(el, o) { this.calls = []; this.t = 0; this.o = o; made.push(this); Promise.resolve().then(() => o.events.onReady()); }
    loadVideoById(p) { this.calls.push(['load', p.videoId, p.startSeconds]); } cueVideoById(p) { this.calls.push(['cue', p.videoId, p.startSeconds]); }
    playVideo() { this.calls.push(['play']); } pauseVideo() { this.calls.push(['pause']); } seekTo(s) { this.calls.push(['seek', s]); }
    setVolume() {} getCurrentTime() { return this.t; } getDuration() { return 200; }
    emit(c) { this.o.events.onStateChange({ data: c }); }
  }
  return { made, YT: { Player } };
}
const mk = () => { const m = mockYT(); return { m, pm: new NS.PlayerManager({ container: 'exp', loadApi: async () => m.YT }) }; };
const mem = (init) => { const d = new Map(Object.entries(init || {})); return { d, getItem: (k) => (d.has(k) ? d.get(k) : null), setItem: (k, v) => d.set(k, String(v)), removeItem: (k) => d.delete(k) }; };
const tick = () => new Promise((r) => setImmediate(r));
// Temporizadores manuales
const timers = () => { const l = []; return { l, st: (f, ms) => { l.push({ f, ms }); return l.length; }, ct: (id) => { if (l[id - 1]) l[id - 1].f = null; },
  run: async (ms) => { const t = l.find((x) => x.f && (ms == null || x.ms === ms)); if (t) { const f = t.f; t.f = null; await f(); } return !!t; } }; };

// ---------- Fase 6: Media Session ----------
function fakeEnv() {
  const handlers = {}, ms = { handlers, playbackState: 'none', metadata: null, pos: null, setActionHandler(a, f) { if (a === 'bogus') throw new Error('x'); handlers[a] = f; }, setPositionState(p) { ms.pos = p; } };
  return { navigator: { mediaSession: ms, userAgent: 'iPhone', maxTouchPoints: 5 }, MediaMetadata: class { constructor(o) { Object.assign(this, o); } }, ms };
}
test('mediaSession: metadatos, miniatura y los 6 handlers', async () => {
  const { pm, m } = mk(); pm.setQueue(items, 0, 'Mi lista'); const env = fakeEnv();
  const ms = new NS.MediaSessionManager({ player: pm, env, now: () => 1e9 });
  assert.equal(ms.start(), true); await pm.playIndex(0);
  assert.equal(env.ms.metadata.title, 'Tema 0'); assert.equal(env.ms.metadata.artist, 'Artista'); assert.equal(env.ms.metadata.album, 'Mi lista');
  assert.match(env.ms.metadata.artwork[0].src, /ytimg\.com/);
  for (const a of ['play', 'pause', 'nexttrack', 'previoustrack', 'seekbackward', 'seekforward']) assert.equal(typeof env.ms.handlers[a], 'function', a);
  const p = m.made[0]; p.t = 50;
  env.ms.handlers.seekforward({}); assert.deepEqual(p.calls.at(-1), ['seek', 60]);
  env.ms.handlers.seekbackward({ seekOffset: 30 }); assert.deepEqual(p.calls.at(-1), ['seek', 20]);
  env.ms.handlers.nexttrack(); await tick(); assert.equal(pm.current().id, ids[1]);
  env.ms.handlers.pause(); assert.equal(pm.userPaused, true); env.ms.handlers.play(); assert.deepEqual(p.calls.at(-1), ['play']);
  p.emit(1); assert.equal(env.ms.playbackState, 'playing'); p.emit(2); assert.equal(env.ms.playbackState, 'paused');
  assert.equal(env.ms.pos.duration, 200);
});
test('mediaSession: sin soporte no falla', () => {
  const { pm } = mk(); const ms = new NS.MediaSessionManager({ player: pm, env: { navigator: {} } });
  assert.equal(ms.start(), false); assert.equal(ms.sync(), false);
});

// ---------- Fase 5: iOS ----------
function iosSetup(ua) {
  const { pm, m } = mk(); pm.setQueue(items, 1, 'L');
  const storage = mem(); const sm = new NS.StateManager({ player: pm, storage });
  const listeners = {}, doc = { hidden: false, _l: {}, addEventListener(e, f) { (this._l[e] = this._l[e] || []).push(f); }, removeEventListener() {} };
  const env = Object.assign(fakeEnv(), { document: doc, localStorage: mem(), addEventListener(e, f) { (listeners[e] = listeners[e] || []).push(f); }, removeEventListener() {} });
  env.navigator.userAgent = ua || 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
  const media = new NS.MediaSessionManager({ player: pm, env }); media.start();
  const t = timers();
  const ios = new NS.IOSManager({ player: pm, state: sm, media, env, setTimeout: t.st, clearTimeout: t.ct, now: () => 1000 });
  return { pm, m, sm, storage, env, doc, listeners, ios, t, media };
}
test('iosManager: solo actúa en iOS/iPadOS (o con force)', () => {
  assert.equal(iosSetup('Mozilla/5.0 (Windows NT 10.0) Chrome/120').ios.start(), false);
  assert.equal(iosSetup().ios.start(), true);
  const ipad = iosSetup('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari'); ipad.env.navigator.maxTouchPoints = 5; assert.equal(ipad.ios.start(), true);
});
test('iosManager: bloquear y desbloquear reanuda desde el segundo exacto', async () => {
  const s = iosSetup(); await s.pm.playIndex(1); const p = s.m.made[0]; p.emit(1); p.t = 88; s.ios.start();
  s.doc.hidden = true; s.doc._l.visibilitychange[0](); s.listeners.pagehide[0]();       // guarda una sola vez el «sonaba»
  assert.equal(JSON.parse(s.storage.getItem('nsound_experimental_state')).position, 88);
  p.emit(2); p.t = 0;                                                                    // iOS pausó el iframe y lo dejó en 0
  s.doc.hidden = false; s.doc._l.visibilitychange[0](); s.listeners.pageshow[0]({}); s.listeners.focus[0]();   // tres señales juntas
  assert.equal(s.t.l.filter((x) => x.ms === 300).length, 1);                             // se juntan en una sola comprobación
  await s.t.run(300); await s.t.run(600);
  assert.deepEqual(p.calls.at(-1), ['load', ids[1], 88]);
  assert.equal(s.env.ms.metadata.title, 'Tema 1');                                       // Media Session sincronizada
});
test('iosManager: si iOS ya reanudó solo no se pisa; la pausa del usuario se respeta; blur/focus de iPad', async () => {
  const s = iosSetup(); await s.pm.playIndex(0); const p = s.m.made[0]; s.ios.start(); p.emit(1);
  s.listeners.blur[0](); p.emit(1); s.listeners.focus[0](); await s.t.run(300); await s.t.run(600);
  assert.equal(p.calls.filter((c) => c[0] === 'load').length, 1);
  s.pm.pause(); s.listeners.blur[0](); s.listeners.focus[0](); await s.t.run(300);
  assert.equal(s.t.l.filter((x) => x.f && x.ms === 600).length, 0);
});
test('iosManager: página descargada de memoria → restaura cola, pista y segundo', async () => {
  const saved = JSON.stringify({ videoId: ids[2], position: 31, queue: items, index: 2, volume: 70, playlist: 'L', repeat: 'off', shuffle: false, timestamp: 1 });
  const s = iosSetup(); s.pm.setQueue([], 0); s.storage.setItem('nsound_experimental_state', saved);
  s.ios.wasPlaying = true; s.ios.leftPos = 31; s.ios.active = true; s.ios.away = true;
  await s.ios._recover('pageshow');
  assert.equal(s.pm.current().id, ids[2]); assert.deepEqual(s.m.made[0].calls[0], ['cue', ids[2], 31]);
  assert.deepEqual(s.m.made[0].calls.at(-1), ['load', ids[2], 31]);
});

// ---------- Fase 7: service worker ----------
test('sw: nunca gestiona YouTube y sí la interfaz', () => {
  const o = 'https://n.example';
  const req = (url, extra) => Object.assign({ method: 'GET', url, destination: '' }, extra);
  for (const h of ['youtube.com', 'www.youtube.com', 'music.youtube.com', 'youtu.be', 'i.ytimg.com', 's.ytimg.com', 'rr1---sn.googlevideo.com'])
    assert.equal(sw.shouldHandle(req('https://' + h + '/x'), o), false, h);
  assert.equal(sw.isExcluded('notyoutube.com'), false);
  for (const u of ['/', '/index.html', '/app.css', '/a.js', '/logo.png', '/manifest.webmanifest', '/icon.svg']) assert.equal(sw.shouldHandle(req(o + u), o), true, u);
  assert.equal(sw.shouldHandle(req('https://fonts.gstatic.com/s/x.woff2', { destination: 'font' }), o), true);
  assert.equal(sw.shouldHandle(req(o + '/experimental/version.json'), o), false);
  assert.equal(sw.shouldHandle(req(o + '/__proxy?url=x'), o), false);
  assert.equal(sw.shouldHandle(req(o + '/a', { method: 'POST' }), o), false);
});
test('sw: stale-while-revalidate y borrado de cachés obsoletas', async () => {
  const stores = new Map(); let net = 'v1';
  const cachesApi = { keys: async () => [...stores.keys()], delete: async (k) => stores.delete(k),
    open: async (n) => { if (!stores.has(n)) stores.set(n, new Map()); const m = stores.get(n); return { match: async (r) => m.get(typeof r === 'string' ? r : r.url), put: async (r, v) => { m.set(r.url, v); } }; } };
  const res = (b) => ({ ok: true, type: 'basic', body: b, clone() { return this; } });
  stores.set('nsound-exp-v0.9', new Map()); stores.set('otra-cache', new Map()); stores.set('nsound-shell-v1', new Map());
  const w = sw.createWorker({ version: '2', caches: cachesApi, fetch: async () => res(net), origin: 'https://n.example' });
  await w.onActivate();
  assert.deepEqual([...stores.keys()].sort(), ['nsound-shell-v1', 'otra-cache']);   // solo se borran las «nsound-exp-» viejas
  const r = { url: 'https://n.example/a.js', method: 'GET', mode: 'cors' };
  assert.equal((await w.staleWhileRevalidate(r)).body, 'v1');                          // primera vez: red y se guarda
  net = 'v2'; assert.equal((await w.staleWhileRevalidate(r)).body, 'v1');              // sirve lo guardado…
  await tick(); assert.equal((await w.staleWhileRevalidate(r)).body, 'v2');            // …y ya estaba actualizado detrás
});

// ---------- Fase 8: actualización ----------
test('version.json es exactamente {"version":"1.0.0-beta"} y coincide con la versión incrustada', () => {
  const raw = readFileSync(new URL('../src/experimental/version.json', import.meta.url), 'utf8');
  assert.deepEqual(JSON.parse(raw), { version: '1.0.0-beta' });
  assert.equal(NS.UpdateManager.BUNDLED_VERSION, '1.0.0-beta');
});
test('updateManager: comprueba cada minuto, conserva estado, actualiza SW/cachés y recarga', async () => {
  const { pm, m } = mk(); pm.setQueue(items, 1, 'L'); await pm.playIndex(1); const p = m.made[0]; p.t = 44;
  const storage = mem(), sm = new NS.StateManager({ player: pm, storage });
  const stores = new Map([['nsound-exp-1.0.0-beta', 1], ['nsound-exp-1.1.0', 1], ['otra', 1]]);
  const regs = []; let reloads = 0, remote = '1.0.0-beta', interval, urls = [];
  const env = { localStorage: mem(), location: { origin: 'https://n.example', reload() { reloads++; } },
    navigator: { serviceWorker: { register: async (u) => { regs.push(u); return { active: {}, update: async () => {} }; } } },
    caches: { keys: async () => [...stores.keys()], delete: async (k) => stores.delete(k) } };
  const um = new NS.UpdateManager({ player: pm, state: sm, env, fetchFn: async (u, o) => { urls.push([u, o]); return { ok: true, json: async () => ({ version: remote }) }; },
    setInterval: (f, ms) => { interval = ms; return 1; }, clearInterval() {}, now: () => 5000, waitMs: 5 });
  await um.start(); assert.equal(interval, 60000); assert.match(regs[0], /sw-experimental\.js\?v=1\.0\.0-beta/);
  assert.equal(await um.check(), 'same'); assert.equal(reloads, 0); assert.equal(urls[0][1].cache, 'no-store');
  remote = '1.1.0'; assert.equal(await um.check(), 'updated');
  assert.equal(reloads, 1); assert.match(regs.at(-1), /v=1\.1\.0/);
  assert.equal(JSON.parse(storage.getItem('nsound_experimental_state')).position, 44);   // estado guardado antes de recargar
  assert.deepEqual([...stores.keys()].sort(), ['nsound-exp-1.1.0', 'otra']);
  assert.equal(env.localStorage.getItem('nsound_experimental_version'), '1.1.0');
  assert.equal(JSON.parse(env.localStorage.getItem('nsound_experimental_reload')).wasPlaying, true);
  // Arranque tras la recarga: restaura y reanuda
  const { pm: pm2, m: m2 } = mk(); const sm2 = new NS.StateManager({ player: pm2, storage });
  const um2 = new NS.UpdateManager({ player: pm2, state: sm2, env, fetchFn: async () => ({ ok: true, json: async () => ({ version: '1.1.0' }) }), setInterval: () => 1, clearInterval() {}, now: () => 6000 });
  await um2.start();
  assert.equal(pm2.current().id, ids[1]); assert.deepEqual(m2.made[0].calls[0], ['cue', ids[1], 44]);
  assert.equal(env.localStorage.getItem('nsound_experimental_reload'), null);
});
test('updateManager: error de red o JSON malo no recarga; sin SW no falla', async () => {
  const { pm } = mk(); const sm = new NS.StateManager({ player: pm, storage: mem() }); let reloads = 0;
  const env = { localStorage: mem(), location: { origin: 'http://x', reload() { reloads++; } }, navigator: {} };
  for (const f of [async () => { throw new Error('offline'); }, async () => ({ ok: false, status: 500 }), async () => ({ ok: true, json: async () => ({}) })]) {
    const um = new NS.UpdateManager({ player: pm, state: sm, env, fetchFn: f, setInterval: () => 1, clearInterval() {} });
    await um.start(); assert.equal(await um.check(), 'error');
  }
  assert.equal(reloads, 0);
});
