// Reproductor experimental de AUDIO PURO (HTMLAudioElement) con elemento <audio>, conector, almacenamiento y DOM simulados. No toca core.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../src/js/03-router.js');
for (const f of ['config', 'migration', 'audioPlayerManager', 'playerManager', 'stateManager', 'networkManager', 'mediaSession', 'iosManager', 'updateManager', 'experimentalBootstrap']) require(`../src/experimental/${f}.js`);
const NS = globalThis.NSoundExperimental, LS = globalThis.LS;
const RESOLVER = 'https://resolver.test/audio';

// ---------- simulaciones ----------
class FakeAudio extends EventTarget {
  constructor() {
    super(); this.src = ''; this.currentTime = 0; this.duration = NaN; this.paused = true; this.ended = false; this.readyState = 0; this.volume = 1;
    this.playbackRate = 1; this.error = null; this.muted = false; this.plays = 0; this.loads = 0; this.rejectPlay = null; this.preload = ''; this.crossOrigin = null;
  }
  getAttribute(k) { return k === 'src' && this.src ? this.src : null; }
  removeAttribute(k) { if (k === 'src') this.src = ''; }
  load() { this.loads++; }
  play() { this.plays++; if (this.rejectPlay) return Promise.reject(Object.assign(new Error(this.rejectPlay), { name: this.rejectPlay })); this.paused = false; return Promise.resolve(); }
  pause() { if (this.paused) return; this.paused = true; this.fire('pause'); }
  fire(n) { this.dispatchEvent(new Event(n)); }
  start() { this.paused = false; this.readyState = 4; this.fire('loadedmetadata'); this.fire('playing'); }   // el navegador empieza a sonar
}
function timers() {
  const l = []; let id = 0;
  return { l, st: (f, ms) => { l.push({ id: ++id, f, ms }); return id; }, ct: (i) => { const t = l.find((x) => x.id === i); if (t) t.f = null; },
    pending: () => l.filter((x) => x.f).length,
    // Dispara el primer temporizador pendiente (el más corto si se indica «ms»)
    async fire(ms) { const t = l.find((x) => x.f && (ms == null || x.ms === ms)); if (!t) return false; const f = t.f; t.f = null; await f(); return true; } };
}
function resolver(map, calls) {
  return { calls, async resolve(id) { calls.push(id); if (map[id] instanceof Error) throw map[id]; if (!map[id]) { const e = new Error('404'); e.code = 'resolver-http-404'; throw e; } return { url: map[id], duration: 200 }; },
    invalidate(id) { calls.push('inv:' + id); } };
}
const ids = ['t1', 't2', 't3'];
const urls = { t1: 'https://cdn.test/t1.mp3', t2: 'https://cdn.test/t2.mp3', t3: 'https://cdn.test/t3.mp3' };
const items = ids.map((id, i) => ({ id, title: 'Tema ' + i, artist: 'Artista' }));
function mk(extra) {
  const T = timers(), calls = [], audios = [];
  const pm = new NS.AudioPlayerManager(Object.assign({ resolver: resolver(Object.assign({}, urls), calls), createAudio: () => { const a = new FakeAudio(); audios.push(a); return a; },
    setTimeout: T.st, clearTimeout: T.ct, random: () => 0.5 }, extra || {}));
  return { pm, T, calls, a: audios[0], buf: audios[1] };
}
const events = (pm, ...names) => { const out = []; names.forEach((n) => pm.on(n, (d) => out.push([n, d]))); return out; };
const flush = () => new Promise((r) => setImmediate(r));
function mem(init) {
  const d = new Map(Object.entries(init || {})), writes = [];
  return { d, writes, get length() { return d.size; }, key: (i) => [...d.keys()][i] ?? null, getItem: (k) => (d.has(k) ? d.get(k) : null),
    setItem(k, v) { writes.push(['set', k]); d.set(k, String(v)); }, removeItem(k) { writes.push(['remove', k]); d.delete(k); } };
}

// ---------- apagado por defecto y configuración ----------
test('configuración: audio puro apagado por defecto, sin conector, y no se activa solo', () => {
  assert.equal(NS.config.ENABLE_EXPERIMENTAL_AUDIO_PLAYER, false);
  assert.equal(NS.config.AUDIO_STREAM_RESOLVER_URL, '');
  assert.equal(NS.config.AUDIO_STORAGE_PREFIX, 'nsound_exp_audio_');
  assert.equal(NS.audioEnabled(), false);
  globalThis.ENABLE_EXPERIMENTAL_PLAYER = true;
  assert.equal(NS.audioEnabled(), false, 'maestro encendido pero flag de audio apagado');
  NS.config.ENABLE_EXPERIMENTAL_AUDIO_PLAYER = true;
  assert.equal(NS.audioEnabled(), false, 'flag encendido pero sin conector');
  NS.config.AUDIO_STREAM_RESOLVER_URL = 'ftp://x'; assert.equal(NS.audioEnabled(), false);
  NS.config.AUDIO_STREAM_RESOLVER_URL = RESOLVER; assert.equal(NS.audioEnabled(), true);
  delete globalThis.ENABLE_EXPERIMENTAL_PLAYER; assert.equal(NS.audioEnabled(), false, 'sin la marca nativa tampoco');
  NS.config.ENABLE_EXPERIMENTAL_AUDIO_PLAYER = false; NS.config.AUDIO_STREAM_RESOLVER_URL = '';
});

test('elementos: new Audio() con preload auto y crossOrigin anonymous; el buffer de la siguiente va en silencio', () => {
  const { a, buf } = mk();
  for (const el of [a, buf]) { assert.equal(el.preload, 'auto'); assert.equal(el.crossOrigin, 'anonymous'); }
  assert.equal(buf.muted, true); assert.notEqual(a, buf);
});

// ---------- conector ----------
test('conector: contrato GET ?trackId=, caché, caducidad y 404 recordado', async () => {
  let n = 0, now = 1000; const seen = [];
  const f = async (u) => { n++; seen.push(u); if (u.includes('trackId=bad')) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => ({ url: 'https://cdn.test/a.mp3', expiresAt: 1100, duration: 180, art: 'https://img.test/a.jpg', title: 'A' }) }; };
  const r = new NS.StreamResolver({ url: RESOLVER, fetch: f, now: () => now });
  const info = await r.resolve('abc'); assert.equal(seen[0], RESOLVER + '?trackId=abc'); assert.equal(info.url, 'https://cdn.test/a.mp3'); assert.equal(info.duration, 180);
  await r.resolve('abc'); assert.equal(n, 1, 'caché');
  now = 1100 * 1000 - 10000; await r.resolve('abc'); assert.equal(n, 2, 'a punto de caducar se pide otra');   // expiresAt en segundos
  await assert.rejects(r.resolve('bad'), (e) => e.code === 'resolver-http-404'); await assert.rejects(r.resolve('bad'), (e) => e.code === 'resolver-http-404'); assert.equal(n, 3, '404 recordado');
  const r2 = new NS.StreamResolver({ url: 'https://x.test/r/{trackId}/url?v=1', fetch: f }); await r2.resolve('a:b'); assert.equal(seen.at(-1), 'https://x.test/r/a%3Ab/url?v=1');
  await assert.rejects(r.resolve('../etc'), (e) => e.code === 'bad-track-id');
});
test('conector: solo URLs https (http en red local); rechaza javascript:, data: y http público', async () => {
  for (const u of ['javascript:alert(1)', 'data:audio/mp3;base64,AAAA', 'http://example.com/a.mp3', 'file:///a.mp3', 'blob:x', '']) assert.equal(NS.isAllowedAudioUrl(u), false, u);
  for (const u of ['https://cdn.test/a.mp3', 'http://localhost:5174/a.mp3', 'http://192.168.1.5/a.mp3']) assert.equal(NS.isAllowedAudioUrl(u), true, u);
  const r = new NS.StreamResolver({ url: RESOLVER, fetch: async () => ({ ok: true, json: async () => ({ url: 'javascript:alert(1)' }) }) });
  await assert.rejects(r.resolve('abc'), (e) => e.code === 'resolver-bad-url');
  const r2 = new NS.StreamResolver({ url: RESOLVER, fetch: async () => { throw new Error('red'); } }); await assert.rejects(r2.resolve('abc'), (e) => e.code === 'resolver-network');
});

// ---------- reproducción, cola y precarga ----------
test('reproducir: resuelve, asigna src, suena y los estados salen en orden', async () => {
  const { pm, a } = mk(); const ev = events(pm, 'state', 'track');
  pm.setQueue(items, 0); assert.equal(await pm.playIndex(0), true);
  assert.equal(a.src, urls.t1); assert.equal(a.plays, 1); a.start();
  assert.deepEqual(ev.filter(([n]) => n === 'state').map(([, d]) => d.state), ['buffering', 'buffering', 'playing']);
  assert.equal(ev.find(([n]) => n === 'track')[1].item.id, 't1'); assert.equal(pm.state, 'playing'); assert.equal(pm.wantPlay, true);
});
test('precarga real: la siguiente se resuelve en el segundo objeto Audio al empezar y de nuevo a 20 s del final', async () => {
  const { pm, a, buf, calls } = mk(); pm.setQueue(items, 0); await pm.playIndex(0); await flush();
  assert.equal(buf.src, urls.t2); assert.equal(pm.nextPreload, 't2'); assert.ok(calls.includes('t2'));
  buf.fire('canplaythrough'); assert.equal(pm.nextReady, true);
  a.start(); assert.equal(buf.src, '', 'el buffer se suelta cuando la pista ya suena');
  a.duration = 200; a.currentTime = 100; a.fire('timeupdate'); await flush(); assert.equal(buf.src, '', 'lejos del final no se precarga otra vez');
  pm.preparedId = null; a.currentTime = 181; a.fire('timeupdate'); await flush(); assert.equal(buf.src, urls.t2, 'a ≤ 20 s del final');
  const n = calls.length; a.currentTime = 182; a.fire('timeupdate'); await flush(); assert.equal(calls.length, n, 'una sola precarga por pista');
});
test('precarga: sin siguiente (fin de cola) o en repetir una no se precarga nada; si la cola cambia no se usa lo viejo', async () => {
  const { pm, buf } = mk(); pm.setQueue([items[0]], 0); await pm.playIndex(0); await flush(); assert.equal(buf.src, '');
  pm.setQueue(items, 0); pm.setRepeat('one'); await pm.playIndex(0); await flush(); assert.equal(pm.nextPreload, null);
  pm.setRepeat('off'); await flush(); assert.equal(buf.src, urls.t2);
});
test('fin de pista: pasa a la siguiente con el mismo elemento (sin silencio); repetir lista, una y fin de cola', async () => {
  const { pm, a } = mk(); const ev = events(pm, 'ended', 'queueEnd'); pm.setQueue(items, 0); await pm.playIndex(0); a.start();
  a.ended = true; a.fire('ended'); await flush(); assert.equal(a.src, urls.t2); assert.equal(pm.current().id, 't2'); assert.equal(a.loads, 2);
  pm.setRepeat('one'); const plays = a.plays; a.ended = true; a.fire('ended'); await flush(); assert.equal(a.src, urls.t2); assert.equal(a.currentTime, 0); assert.ok(a.plays > plays);
  pm.setRepeat('off'); a.ended = true; a.fire('ended'); await flush(); assert.equal(pm.current().id, 't3');
  a.ended = true; a.fire('ended'); await flush(); assert.equal(ev.filter(([n]) => n === 'queueEnd').length, 1); assert.equal(pm.wantPlay, false);
  pm.setRepeat('all'); await pm.next({ auto: false }); assert.equal(pm.current().id, 't1');
});
test('siguiente/anterior y aleatorio: determinista con la semilla; anterior vuelve al inicio si pasaron >3 s', async () => {
  const { pm, a } = mk({ random: () => 0 }); pm.setQueue(items, 0); await pm.playIndex(0); a.start();
  pm.setShuffle(true); assert.deepEqual(pm.order, [0, 2, 1]); await pm.next(); assert.equal(pm.current().id, 't3');
  a.currentTime = 9; pm.prev(); assert.equal(a.currentTime, 0); assert.equal(pm.current().id, 't3'); await pm.prev(); assert.equal(pm.current().id, 't1');
  pm.setAutoplay(false); const ev = events(pm, 'ended'); a.ended = true; a.fire('ended'); assert.deepEqual(ev, [['ended', { auto: false }]]); assert.equal(pm.wantPlay, false);
});
test('vídeos normales no entran en la cola del audio puro', () => {
  const { pm } = mk(); assert.equal(pm.setQueue([{ id: 'v1', kind: 'video' }, { id: 't1' }, { id: 'no válido!' }], 0), 1);
});

// ---------- recuperación ----------
test('recuperación: error de red → guarda el segundo, espera, reintenta hasta 5 veces y no pierde la posición', async () => {
  const { pm, a, T, calls } = mk(); const ev = events(pm, 'error');
  pm.setQueue(items, 0); await pm.playIndex(0); a.start(); a.currentTime = 42;
  a.error = { code: 2 }; a.fire('error');
  assert.equal(pm.lastPos, 42, 'guarda el segundo exacto'); assert.equal(T.pending() >= 1, true);
  assert.equal(await T.fire(1000), true); await flush();                                      // espera 1 s y reintenta
  assert.equal(pm.attempts, 1); assert.ok(calls.includes('inv:t1'), 'se pide una URL nueva por si caducó'); assert.equal(a.src, urls.t1);
  assert.equal(pm._pendingSeek, 42); a.fire('loadedmetadata'); assert.equal(a.currentTime, 42);   // continúa desde el segundo exacto
  for (let i = 0; i < 12; i++) { while (await T.fire()) await flush(); a.currentTime = 42; }  // nunca llega a sonar: se agotan los intentos
  assert.equal(pm.attempts, 5); assert.equal(pm.gaveUp, true);
  assert.ok(ev.some(([, d]) => d.code === 'gaveup' && d.recoverable === false));
  const loads = a.loads; await T.fire(); assert.equal(a.loads, loads, 'tras rendirse no hay más intentos');
});
test('recuperación: si vuelve a sonar se reinician los intentos', async () => {
  const { pm, a, T } = mk(); pm.setQueue(items, 0); await pm.playIndex(0); a.start(); a.currentTime = 10;
  a.fire('waiting'); assert.equal(pm.state, 'buffering'); await T.fire(4000); assert.equal(T.pending() >= 1, true); await T.fire(1000); await flush();
  assert.equal(pm.attempts, 1); a.start(); assert.equal(pm.attempts, 0); assert.equal(pm.state, 'playing'); assert.equal(T.pending(), 1, 'solo queda el vigilante'); assert.ok(pm.wdTimer);
});
test('pausa del sistema (llamada, iOS): se vuelve a intentar; pausa del usuario: nunca', async () => {
  const { pm, a, T } = mk(); pm.setQueue(items, 0); await pm.playIndex(0); a.start(); a.currentTime = 30;
  a.pause(); assert.equal(pm.state, 'paused'); const plays = a.plays; assert.equal(await T.fire(0), true); await flush();   // primero pide play otra vez AL INSTANTE (0 ms, antes 300), sin recargar
  assert.equal(a.plays, plays + 1); assert.equal(a.loads, 1);
  assert.equal(await T.fire(4000), true); assert.equal(await T.fire(1000), true); await flush();            // si sigue sin sonar: recarga y reintenta
  assert.equal(pm.attempts, 1);
  a.start(); pm.pause(); assert.equal(pm.userPaused, true); assert.equal(pm.attempts, 0); assert.equal(T.pending(), 0);
  a.fire('waiting'); a.fire('stalled'); assert.equal(T.pending(), 0, 'con la pausa del usuario no se arma nada');
  const loads = a.loads; assert.equal(pm._trouble('x'), false); assert.equal(a.loads, loads);
});
test('la pausa del usuario cancela un reintento ya programado', async () => {
  const { pm, a, T } = mk(); pm.setQueue(items, 0); await pm.playIndex(0); a.start();
  a.error = { code: 2 }; a.fire('error'); assert.equal(T.pending() >= 1, true); pm.pause(); assert.equal(T.pending(), 0);
  const loads = a.loads; await T.fire(); assert.equal(a.loads, loads);
});
test('iOS exige un toque (NotAllowedError): no se reintenta en bucle y se avisa', async () => {
  const { pm, a, T } = mk(); const ev = events(pm, 'error'); pm.setQueue(items, 0); a.rejectPlay = 'NotAllowedError';
  assert.equal(await pm.playIndex(0), false); assert.equal(pm.blocked, true); assert.equal(pm.wantPlay, false); assert.equal(T.pending(), 0);
  assert.ok(ev.some(([, d]) => d.code === 'autoplay-blocked' && d.blocked === true));
  a.rejectPlay = null; pm.play(); await flush(); assert.equal(pm.wantPlay, true); assert.equal(a.paused, false);
});
test('pista sin audio autorizado: error no recuperable; con cola propia se salta y si todas fallan se detiene', async () => {
  const calls = []; const { pm, a } = mk({ resolver: resolver({ t2: urls.t2 }, calls) }); const ev = events(pm, 'error', 'queueExhausted');
  pm.setQueue(items, 0); assert.equal(await pm.playIndex(0), false); assert.equal(pm._failedResolve, true);
  assert.ok(ev.some(([n, d]) => n === 'error' && d.resolve === true && d.recoverable === false));
  assert.equal(await pm.next({ auto: false }), true); assert.equal(pm.current().id, 't2'); assert.equal(a.src, urls.t2);                      // t1 no estaba; se avanza
  const x = mk({ resolver: resolver({}, []) }); x.pm.setQueue(items, 0); const ex = events(x.pm, 'queueExhausted'); await x.pm._playAndSkip(0); assert.equal(ex.length, 1); assert.equal(x.pm.wantPlay, false);
});

// ---------- estado, restauración e iOS ----------
test('estado: se guarda bajo nsound_exp_audio_ y no se toca producción; la migración también protege estas claves', async () => {
  const PROD = { 'ls.settings': '{"v":1}', 'ls.library': '[1]' };
  const st = mem(PROD); const { pm, a } = mk();
  const mig = new NS.Migration({ storage: st, now: () => 1 }); const fp = mig.productionFingerprint();
  const sm = new NS.StateManager({ player: pm, storage: NS.createSafeStorage(st), prefix: NS.config.AUDIO_STORAGE_PREFIX });
  pm.setQueue(items, 1); await pm.playIndex(1); a.start(); a.currentTime = 77; assert.equal(sm.saveNow(), true);
  assert.equal(JSON.parse(st.getItem('nsound_exp_audio_state')).videoId, 't2'); assert.equal(st.getItem('nsound_experimental_state'), null);
  assert.equal(mig.productionFingerprint(), fp, 'las claves de audio no cuentan como producción');
  const safe = NS.createSafeStorage(st); safe.setItem('ls.settings', 'malo'); assert.equal(st.getItem('ls.settings'), PROD['ls.settings']); assert.equal(safe.violations.length, 1);
  assert.equal(mig.backup(), 'nsound_experimental_backup_1'); assert.ok('nsound_exp_audio_state' in JSON.parse(st.getItem('nsound_experimental_backup_1')).data);
  sm.start(); sm.stop();
});
test('restaurar: vuelve a la pista y al segundo en pausa (lista, sin sonar) y luego suena desde ahí', async () => {
  const { pm, a, T } = mk();
  const snap = { videoId: 't3', position: 55, queue: items, index: 2, volume: 60, playlist: 'Lista', repeat: 'all', shuffle: false };
  assert.equal(await pm.restore(snap), true);
  assert.equal(pm.current().id, 't3'); assert.equal(pm.state, 'cued'); assert.equal(a.plays, 0); assert.equal(pm.getTime(), 55); assert.equal(pm.repeat, 'all'); assert.equal(a.volume, 0.6);
  a.fire('loadedmetadata'); assert.equal(a.currentTime, 55); assert.equal(pm.playlist, 'Lista');
  pm.play(); await flush(); assert.equal(a.plays, 1); assert.equal(T.pending() >= 0, true);
  assert.equal(await pm.restore({ queue: 'no' }), false);
});
test('iOS: al volver a primer plano no pisa un audio que sigue sonando y reanuda sin descargar si estaba pausado por el sistema', async () => {
  const { pm, a } = mk(); pm.setQueue(items, 0); await pm.playIndex(0); a.start(); a.currentTime = 20;
  assert.equal(await pm.resumeFrom(20), true); assert.equal(a.loads, 1, 'mismo audio: sin recargar');
  a.currentTime = 0; await pm.resumeFrom(50); assert.equal(a.currentTime, 50);
  a.error = { code: 2 }; a.readyState = 0; await pm.resumeFrom(50); assert.equal(a.loads, 2, 'si el elemento quedó roto, se carga de nuevo');
  assert.equal(await mk().pm.resumeFrom(5), false);
  const T2 = timers(); const st = mem({}); const sm = new NS.StateManager({ player: pm, storage: st, prefix: 'nsound_exp_audio_' });
  const doc = Object.assign(new EventTarget(), { hidden: false }); const env = Object.assign(new EventTarget(), { document: doc, localStorage: st, navigator: { userAgent: 'iPhone' } });
  const ios = new NS.IOSManager({ player: pm, state: sm, env, key: 'nsound_exp_audio_ios', setTimeout: T2.st, clearTimeout: T2.ct, graceMs: 10 }); assert.equal(ios.start(), true);
  pm.userPaused = false; pm.wantPlay = true; a.start(); doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); assert.equal(typeof st.getItem('nsound_exp_audio_ios'), 'string'); assert.equal(st.getItem('nsound_experimental_ios'), null);
  ios.stop(); sm.stop();
});

// ---------- Media Session ----------
test('Media Session: estado, posición con la velocidad real, metadatos completos y handlers', async () => {
  const { pm, a } = mk(); const set = {}, handlers = {}; let metaArg = null;
  const env = { navigator: { mediaSession: { setActionHandler: (n, f) => { handlers[n] = f; }, setPositionState: (s) => { set.pos = s; } } }, MediaMetadata: function (m) { metaArg = m; Object.assign(this, m); } };
  let clock = 0; const ms = new NS.MediaSessionManager({ player: pm, env, now: () => (clock += 5000) });
  pm.setQueue([{ id: 't1', title: 'Tema', artist: 'Artista', art: 'https://img.test/a.jpg', duration: 200 }, items[1]], 0, 'Álbum'); await pm.playIndex(0);
  assert.equal(ms.start(), true); a.duration = 200; a.currentTime = 30; a.playbackRate = 1.25; a.start();
  assert.equal(env.navigator.mediaSession.playbackState, 'playing'); assert.deepEqual(set.pos, { duration: 200, playbackRate: 1.25, position: 30 });
  assert.equal(metaArg.title, 'Tema'); assert.equal(metaArg.album, 'Álbum'); assert.equal(metaArg.artwork[0].src, 'https://img.test/a.jpg');
  for (const h of ['play', 'pause', 'nexttrack', 'previoustrack', 'seekto', 'seekbackward', 'seekforward']) assert.equal(typeof handlers[h], 'function', h);
  handlers.seekto({ seekTime: 90 }); assert.equal(a.currentTime, 90); handlers.seekbackward({}); assert.equal(a.currentTime, 80); handlers.seekforward({ seekOffset: 30 }); assert.equal(a.currentTime, 110);
  handlers.pause(); assert.equal(pm.userPaused, true); assert.equal(env.navigator.mediaSession.playbackState, 'paused');
  a.playbackRate = 2; a.fire('ratechange'); assert.equal(set.pos.playbackRate, 2);
  handlers.nexttrack(); await flush(); assert.equal(pm.current().id, 't2'); assert.equal(metaArg.artwork, undefined, 'un id que no es de YouTube no inventa miniatura');
  ms.stop(); assert.equal(handlers.play, null);
});

// ---------- bootstrap y desacoplamiento ----------
function fakeDom() {
  const mkEl = (tag) => ({ tagName: tag.toUpperCase(), attrs: {}, children: [], nodeType: 1, id: '', setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = v; }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    hasAttribute(k) { return k in this.attrs; }, appendChild(c) { this.children.push(c); return c; }, querySelectorAll() { return []; } });
  const head = mkEl('head'), body = mkEl('body'), classes = new Set();
  const all = () => head.children.concat(body.children, body.children.flatMap((c) => c.children));
  const match = (e, sel) => [...sel.matchAll(/\[(\w+)="([^"]*)"\]/g)].every(([, k, v]) => e.attrs[k] === v) && (!/^\w+/.test(sel) || e.tagName.toLowerCase() === sel.match(/^\w+/)[0]);
  return { head, body, hidden: false, readyState: 'complete', documentElement: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } }, createElement: mkEl,
    getElementById: (id) => all().find((e) => e.id === id) || null, querySelector: (s) => all().find((e) => match(e, s)) || null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
}
async function bootAudio(map) {
  NS.config.ENABLE_EXPERIMENTAL_AUDIO_PLAYER = true; NS.config.AUDIO_STREAM_RESOLVER_URL = RESOLVER;
  globalThis.ENABLE_EXPERIMENTAL_PLAYER = true; NS.instance = null;
  const ls = mem({ 'ls.settings': '{"v":1}', 'ls.library': '[1]' }); globalThis.localStorage = ls;
  const doc = fakeDom(); globalThis.document = doc;
  const audios = []; globalThis.Audio = class extends FakeAudio { constructor() { super(); audios.push(this); } };
  const asked = [];
  globalThis.fetch = async (u) => { const m = String(u).match(/trackId=([^&]+)/); if (!m) return { ok: false, status: 404 }; asked.push(m[1]); const url = map[m[1]];
    return url ? { ok: true, status: 200, json: async () => ({ url }) } : { ok: false, status: 404 }; };
  const rawCalls = []; const raw = { on() {}, init() {}, state: () => ({}), mode: () => null, load: async (it) => { rawCalls.push(it.id); }, play() {}, pause() {}, seek() {}, setVolume() {}, setEq() {}, eqStatus: async () => null };
  const facade = LS.engines.wrap(raw); const out = NS.bootstrap();
  return { out, facade, raw, rawCalls, audios, asked, ls, doc };
}
const cleanup = () => { NS.config.ENABLE_EXPERIMENTAL_AUDIO_PLAYER = false; NS.config.AUDIO_STREAM_RESOLVER_URL = ''; delete globalThis.ENABLE_EXPERIMENTAL_PLAYER; delete globalThis.Audio; delete globalThis.fetch; delete globalThis.document; delete globalThis.localStorage; };

test('bootstrap con audio puro: sin iframe, el motor toma solo música y cede a los de siempre cuando no hay audio autorizado', async () => {
  const { out, facade, rawCalls, audios, asked, ls, doc } = await bootAudio({ MusicA: 'https://cdn.test/a.mp3' });
  try {
    assert.ok(out && out.controller && out.controller.audio === true); assert.equal(out.controller.network, null); assert.equal(doc.getElementById('exp-player'), null, 'sin contenedor de iframe');
    assert.equal(out.controller.player instanceof NS.AudioPlayerManager, true); assert.equal([...facade.router.engines.keys()][0], 'exp-audio');
    await facade.load({ src: 'yt', id: 'MusicA', kind: 'track', title: 'A' }, { audioOnly: true }); await flush();
    assert.equal(audios[0].src, 'https://cdn.test/a.mp3'); assert.equal(rawCalls.length, 0); assert.ok(asked.includes('MusicA'));
    await facade.load({ src: 'yt', id: 'Video1', kind: 'video' }, { audioOnly: false }); assert.deepEqual(rawCalls, ['Video1'], 'vídeo normal: reproductor habitual');
    await facade.load({ src: 'yt', id: 'NoAudio', kind: 'track' }, { audioOnly: true }); await flush();
    assert.deepEqual(rawCalls, ['Video1', 'NoAudio'], 'sin audio autorizado → cede al reproductor habitual');
    out.controller.state.saveNow(); out.controller.ios.leave('test'); out.stop();
    assert.equal(ls.getItem('ls.settings'), '{"v":1}'); assert.equal(ls.getItem('ls.library'), '[1]');
    assert.ok(ls.writes.every(([, k]) => k.startsWith('nsound_experimental_') || k.startsWith('nsound_exp_audio_')), JSON.stringify(ls.writes));
    assert.equal(NS.debug().running, false);
  } finally { cleanup(); }
});
test('bootstrap con el flag de audio apagado: se usa el reproductor de YouTube de siempre', async () => {
  globalThis.ENABLE_EXPERIMENTAL_PLAYER = true; NS.instance = null; const doc = fakeDom(); globalThis.document = doc;
  const d = mem({}); globalThis.localStorage = d; globalThis.YT = undefined;
  const raw = { on() {}, init() {}, state: () => ({}), mode: () => null, load: async () => {}, play() {}, pause() {}, seek() {}, setVolume() {}, setEq() {}, eqStatus: async () => null };
  const facade = LS.engines.wrap(raw); const out = NS.bootstrap();
  try { assert.equal(out.controller.audio, false); assert.equal(out.controller.player instanceof NS.PlayerManager, true); assert.ok(out.controller.network); assert.deepEqual([...facade.router.engines.keys()], ['exp-yt', 'yt', 'html5']); out.stop(); }
  finally { cleanup(); }
});

test('vigilante: detecta una parada sin eventos (pausado o congelado) y actúa; con pausa del usuario no hace nada', async () => {
  const { pm, a, T } = mk(); pm.setQueue(items, 0); await pm.playIndex(0); a.start(); a.currentTime = 20;
  assert.ok(pm.wdTimer, 'se arma al empezar a sonar');
  a.paused = true;                                                       // iOS lo paró sin avisar (sin evento «pause»)
  const plays = a.plays; assert.equal(await T.fire(5000), true); await flush();
  assert.equal(a.plays, plays + 1, 'pide play otra vez a los 5 s sin recargar'); assert.equal(a.loads, 1);
  a.start(); a.currentTime = 25;
  a.readyState = 2;                                                      // congelado: no avanza y no tiene datos
  assert.equal(await T.fire(5000), true); await flush(); assert.ok(pm.timer || T.pending() >= 1, 'se programa la recuperación');
  a.start(); pm.pause(); assert.equal(pm.wdTimer, null, 'la pausa del usuario apaga el vigilante');
});
