import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
require('../src/js/03-router.js');
{   // 03-player.js toca window/document al cargarse; se simulan y su intervalo no debe mantener vivo el proceso
  const si = globalThis.setInterval; globalThis.setInterval = (f, ms) => { const t = si(f, ms); if (t && t.unref) t.unref(); return t; };
  globalThis.window = globalThis.window || { addEventListener() {} }; globalThis.location = globalThis.location || { origin: 'null' };
  require('../src/js/03-player.js'); globalThis.setInterval = si;
}
const LS = globalThis.LS;
for (const f of ['config', 'playerManager', 'stateManager', 'networkManager', 'mediaSession', 'iosManager', 'updateManager', 'experimentalBootstrap']) require(`../src/experimental/${f}.js`);
const NS = globalThis.NSoundExperimental;

const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd'];
const items = ids.map((id, i) => ({ id, title: 'T' + i, artist: 'A' }));

// YT falso: una sola instancia; registra las llamadas
function mockYT() {
  const made = [];
  class Player {
    constructor(el, o) { this.el = el; this.o = o; this.calls = []; this.t = 0; made.push(this); Promise.resolve().then(() => o.events.onReady()); }
    loadVideoById(p) { this.calls.push(['load', p.videoId, p.startSeconds]); }
    cueVideoById(p) { this.calls.push(['cue', p.videoId, p.startSeconds]); }
    playVideo() { this.calls.push(['play']); } pauseVideo() { this.calls.push(['pause']); }
    seekTo(s) { this.calls.push(['seek', s]); } setVolume(v) { this.vol = v; }
    getCurrentTime() { return this.t; } getDuration() { return 200; }
    emit(code) { this.o.events.onStateChange({ data: code }); }
    err(code) { this.o.events.onError({ data: code }); }
  }
  return { made, YT: { Player } };
}
const mk = (opts) => { const m = mockYT(); const pm = new NS.PlayerManager(Object.assign({ container: 'exp', loadApi: async () => m.YT, random: () => 0.5 }, opts)); return { pm, m }; };
const tick = () => new Promise((r) => setImmediate(r));
function memStorage(init) { const d = new Map(Object.entries(init || {})); return { d, getItem: (k) => (d.has(k) ? d.get(k) : null), setItem: (k, v) => d.set(k, String(v)), removeItem: (k) => d.delete(k) }; }

// ---------- Fase 2 ----------
test('flag apagado: create devuelve null; contenedor «yt» prohibido', () => {
  assert.equal(NS.enabled(), false); assert.equal(NS.create({ container: 'exp' }), null);
  assert.throws(() => new NS.PlayerManager({ container: 'yt' }));
});

test('una sola instancia y cambio de pista con loadVideoById', async () => {
  const { pm, m } = mk(); pm.setQueue(items, 0);
  await pm.playIndex(0); await pm.next(); await pm.next();
  assert.equal(m.made.length, 1);
  assert.deepEqual(m.made[0].calls.map((c) => c[1]), [ids[0], ids[1], ids[2]]);
});

test('vídeos normales e ids inválidos no entran en la cola musical', () => {
  const { pm } = mk();
  assert.equal(pm.setQueue([{ id: 'aaaaaaaaaaa' }, { id: 'bbbbbbbbbbb', kind: 'video' }, { id: 'mal' }], 0), 1);
});

test('autoplay al terminar, repetir lista/canción y fin de cola', async () => {
  const { pm, m } = mk(); pm.setQueue(items.slice(0, 2), 0); await pm.playIndex(0);
  const p = m.made[0]; p.emit(0); await tick();
  assert.equal(pm.current().id, ids[1]);
  const ends = []; pm.on('queueEnd', () => ends.push(1));
  p.emit(0); await tick(); assert.equal(ends.length, 1); assert.equal(pm.wantPlay, false);
  pm.setRepeat('all'); await pm.playIndex(1); p.emit(0); await tick(); assert.equal(pm.current().id, ids[0]);
  pm.setRepeat('one'); p.emit(0); await tick(); assert.equal(pm.current().id, ids[0]);
  assert.deepEqual(p.calls.at(-1), ['load', ids[0], 0]);
});

test('shuffle: la actual primero, todas una vez; precarga lógica de la siguiente', async () => {
  const { pm } = mk({ random: () => 0 }); pm.setQueue(items, 1); pm.setShuffle(true);
  assert.equal(pm.order[0], 1); assert.deepEqual([...pm.order].sort(), [0, 1, 2, 3]);
  const pre = []; pm.on('preload', (e) => pre.push(e.videoId));
  await pm.playIndex(1); assert.equal(pre.at(-1), pm.queue[pm.order[1]].id); assert.equal(pm.nextPreload, pre.at(-1));
});

test('errores fatales saltan a la siguiente y no dan vueltas infinitas', async () => {
  const { pm, m } = mk(); pm.setQueue(items.slice(0, 3), 0); await pm.playIndex(0);
  const p = m.made[0]; p.err(150); await tick(); assert.equal(pm.current().id, ids[1]);
  let ex = 0; pm.on('queueExhausted', () => ex++);
  p.err(100); await tick(); p.err(101); await tick(); assert.equal(ex, 1);
});

test('prev: tras 3 s reinicia; error recuperable no salta', async () => {
  const { pm, m } = mk(); pm.setQueue(items, 2); await pm.playIndex(2);
  const p = m.made[0]; p.t = 10; pm.prev(); assert.deepEqual(p.calls.at(-1), ['seek', 0]);
  p.t = 1; await pm.prev(); assert.equal(pm.current().id, ids[1]);
  p.err(5); await tick(); assert.equal(pm.current().id, ids[1]);
});

// ---------- Fase 3 ----------
test('estado: copia de seguridad previa, guardado cada 5 s y restauración exacta', async () => {
  const old = JSON.stringify({ videoId: 'ccccccccccc', position: 42, queue: items, index: 2, volume: 55, playlist: 'L', repeat: 'all', shuffle: false, timestamp: 1 });
  const st = memStorage({ nsound_experimental_state: old, 'ls.settings': 'x' });
  const { pm, m } = mk(); let tickFn, interval;
  const sm = new NS.StateManager({ player: pm, storage: st, setInterval: (f, ms) => { tickFn = f; interval = ms; return 1; }, clearInterval() {}, now: () => 99 });
  sm.start(); assert.equal(interval, 5000);
  assert.equal(st.getItem('nsound_experimental_state_backup'), old);   // copia antes de cualquier guardado
  assert.equal(st.getItem('nsound_experimental_state'), old);
  assert.equal(await sm.restore(), true); const p = m.made[0];
  assert.deepEqual(p.calls[0], ['cue', 'ccccccccccc', 42]);
  assert.equal(pm.volume, 55); assert.equal(pm.repeat, 'all'); assert.equal(pm.queue.length, 4); assert.equal(pm.playlist, 'L');
  pm.wantPlay = true; p.t = 50; tickFn();
  const saved = JSON.parse(st.getItem('nsound_experimental_state'));
  assert.equal(saved.position, 50); assert.equal(saved.timestamp, 99);
  assert.equal(st.getItem('ls.settings'), 'x');                         // nada ajeno tocado
  assert.ok([...st.d.keys()].every((k) => k === 'ls.settings' || k.startsWith('nsound_experimental_')));
});

test('estado dañado: se usa la copia; sin pista no se pisa lo guardado; storage roto no lanza', async () => {
  const good = JSON.stringify({ videoId: 'aaaaaaaaaaa', position: 3, queue: items, index: 0 });
  const st = memStorage({ nsound_experimental_state: '{roto', nsound_experimental_state_backup: good });
  const { pm } = mk(); const sm = new NS.StateManager({ player: pm, storage: st });
  sm.init(); assert.equal(st.getItem('nsound_experimental_state_backup'), good);   // el dañado no pisa la buena copia
  assert.equal(sm.load().videoId, 'aaaaaaaaaaa');
  assert.equal(sm.saveNow(), false); assert.equal(st.getItem('nsound_experimental_state'), '{roto');
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  const sm2 = new NS.StateManager({ player: pm, storage: bad }); sm2.init(); assert.equal(sm2.load(), null);
});

// ---------- Fase 4 ----------
function netSetup(opts) {
  const { pm, m } = mk(); pm.setQueue(items, 0);
  const st = memStorage(); const sm = new NS.StateManager({ player: pm, storage: st });
  const timers = []; let clock = 0;
  const env = { navigator: { onLine: true }, _l: {}, addEventListener(e, f) { (this._l[e] = this._l[e] || []).push(f); }, removeEventListener() {} };
  const nm = new NS.NetworkManager(Object.assign({ player: pm, state: sm, env,
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].f = null; }, now: () => ++clock }, opts));
  nm.start();
  const fire = async (ms) => { const t = timers.find((x) => x.f && x.ms === ms); if (t) { const f = t.f; t.f = null; await f(); } return !!t; };
  return { pm, m, nm, st, env, timers, fire };
}

test('reconexión: guarda, espera 3 s, reintenta desde el último segundo', async () => {
  const s = netSetup(); await s.pm.playIndex(0); const p = s.m.made[0];
  p.t = 77; p.emit(1); p.emit(3);                                       // sonaba y se queda cargando
  s.pm.getTime(); s.nm.trouble('prueba');
  assert.equal(JSON.parse(s.st.getItem('nsound_experimental_state')).position, 77);   // 1) guardar
  assert.ok(s.timers.some((t) => t.ms === 3000 && t.f));                // 2) esperar 3 s
  await s.fire(3000);                                                   // 3) reintentar
  assert.deepEqual(p.calls.at(-1), ['load', ids[0], 77]);               // 4) desde el último segundo
  p.emit(1); assert.equal(s.nm.attempts, 0); assert.ok(s.nm.getLog().some((e) => e.event === 'recovered'));
});

test('máximo 5 intentos y luego se rinde, con registro', async () => {
  const s = netSetup(); await s.pm.playIndex(0); const p = s.m.made[0]; p.t = 5; p.emit(3);
  s.nm.trouble('x');
  for (let i = 0; i < 12; i++) { if (!(await s.fire(3000))) await s.fire(6000); }
  assert.equal(p.calls.filter((c) => c[0] === 'load').length, 1 + 5);   // la carga inicial + 5 reintentos
  assert.equal(s.nm.attempts, 5); assert.ok(s.nm.getLog().some((e) => e.event === 'gaveup'));
  assert.equal(s.nm.trouble('otra'), false);
});

test('sin conexión no carga nada; error recuperable y pausa del usuario', async () => {
  const s = netSetup(); await s.pm.playIndex(0); const p = s.m.made[0];
  s.env.navigator.onLine = false; s.env._l.offline[0]();
  await s.fire(3000); assert.equal(p.calls.filter((c) => c[0] === 'load').length, 1);
  assert.ok(s.nm.getLog().some((e) => e.event === 'retry' && e.data.online === false));
  const s2 = netSetup(); await s2.pm.playIndex(0); s2.pm.pause();
  s2.m.made[0].emit(2); assert.equal(s2.timers.length, 0);              // pausa del usuario: se respeta
  const s3 = netSetup(); await s3.pm.playIndex(0); s3.m.made[0].err(5);
  assert.ok(s3.timers.some((t) => t.ms === 3000));
});

test('interrupción de WebKit al volver a primer plano', async () => {
  const s = netSetup({ env: undefined }); await s.pm.playIndex(0); s.m.made[0].emit(2);
  const before = s.timers.length; s.nm._checkAfterInterruption('visible');
  assert.ok(s.timers.length > before);
});


// =====================================================================================================================
// Cierre de la rama «Motores»: precarga real (prepare), cola experimental al mando y sincronía con el contenedor de iPhone
// =====================================================================================================================
const root = new URL('../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');
const trk = (i, extra) => Object.assign({ key: 'yt:' + ids[i], src: 'yt', id: ids[i], kind: 'track', title: 'T' + i, sub: 'A', thumb: 'https://img.test/' + ids[i] + '.jpg', duration: 100 }, extra);
function rig(engineOpts) {
  const m = mockYT(), pm = new NS.PlayerManager({ container: 'exp', loadApi: async () => m.YT, random: () => 0 });
  const calls = [], prepared = [], subs = {};
  const raw = { calls, prepared, on: (e, f) => (subs[e] = subs[e] || []).push(f), init() {}, state: () => ({ playing: false, time: 0, duration: 0 }), mode: () => null,
    load: async (it, o) => { calls.push(['load', it.id, o]); }, play() {}, pause() {}, seek() {}, setVolume() {}, setEq() {}, eqStatus: async () => null, prepare: (t) => prepared.push(t.id) };
  const facade = LS.engines.wrap(raw);
  const perfCalls = [];
  const eng = new (NS.makeEngineClass(LS))(pm, Object.assign({ facade, setInterval: () => 1, clearInterval() {}, perf: { preloadImage: (u) => perfCalls.push(u) } }, engineOpts));
  facade.router.register(eng, true);
  const ev = []; facade.on('track', (e) => ev.push(['track', e.index, e.key])); facade.on('ended', (e) => ev.push(['ended', e]));
  return { m, pm, raw, facade, eng, ev, perfCalls };
}
const music = (n) => ids.slice(0, n).map((_, i) => trk(i));
const qopts = (n, index, extra) => ({ audioOnly: true, queue: Object.assign({ items: music(n), index: index || 0, repeat: 'off', shuffle: false }, extra) });
const loadIds = (m) => m.made[0].calls.filter((c) => c[0] === 'load').map((c) => c[1]);
const endedEvents = (ev) => ev.filter((e) => e[0] === 'ended');

// ---------- 1. prepare() de verdad ----------
test('prepare: el reproductor básico precarga solo la miniatura (https, sin duplicados, tope de 4)', () => {
  const made = []; globalThis.Image = class { constructor() { made.push(this); } };
  try {
    assert.equal(LS.Player.prepare(trk(0)), true); assert.equal(LS.Player.prepare(trk(0)), false);
    assert.equal(LS.Player.prepare({ thumb: 'http://x/a.jpg' }), false); assert.equal(LS.Player.prepare({}), false); assert.equal(LS.Player.prepare(null), false);
    for (let i = 1; i < 8; i++) LS.Player.prepare({ thumb: 'https://x/' + i + '.jpg' });
    assert.equal(made.length, 8); assert.equal(made[0].decoding, 'async');
  } finally { delete globalThis.Image; }
});
test('prepare: la fachada lo manda al motor que reproduciría esa pista (experimental para música, el de siempre para el resto)', async () => {
  const { facade, raw, eng, perfCalls } = rig();
  await facade.prepare(trk(1), { audioOnly: true }); assert.deepEqual(perfCalls, [trk(1).thumb]); assert.deepEqual(raw.prepared, []);
  await facade.prepare(trk(2, { kind: 'video' }), { audioOnly: false }); assert.deepEqual(raw.prepared, [ids[2]]);       // vídeo normal: motor de siempre
  assert.equal(await facade.prepare({ src: 'nada', id: 'x' }, {}), undefined);
  assert.equal(eng.id, 'exp-yt');
});
test('prepare: con la cola del motor, la miniatura de la siguiente se precarga al empezar y al avanzar', async () => {
  const r = rig(); await r.facade.load(trk(0), qopts(3));
  assert.deepEqual(r.perfCalls, [trk(1).thumb]);
  r.m.made[0].emit(0); await tick(); assert.deepEqual(r.perfCalls, [trk(1).thumb, trk(2).thumb]);
});

// ---------- 2. la cola experimental manda ----------
test('cola del motor: al terminar cada pista avanza sola y la app solo recibe el cambio de pista (no «ended»)', async () => {
  const { facade, m, ev, raw } = rig();
  await facade.load(trk(0), qopts(3));
  assert.equal(facade.ownsQueue(), true); assert.equal(raw.calls.length, 0);
  m.made[0].emit(0); await tick(); m.made[0].emit(0); await tick();
  assert.deepEqual(loadIds(m), [ids[0], ids[1], ids[2]]);
  assert.deepEqual(ev.filter((e) => e[0] === 'track').map((e) => e[1]), [0, 1, 2]); assert.deepEqual(endedEvents(ev), []);
  assert.equal(ev.at(-1)[2], 'yt:' + ids[2]);
});
test('cola del motor: fin de la lista (sin repetir) avisa con queueEnd; repetir lista da la vuelta; repetir una repite sin avisar', async () => {
  let r = rig(); await r.facade.load(trk(2), qopts(3, 2)); r.m.made[0].emit(0); await tick();
  assert.deepEqual(endedEvents(r.ev), [['ended', { queueEnd: true }]]); assert.equal(loadIds(r.m).length, 1);
  r = rig(); await r.facade.load(trk(2), qopts(3, 2, { repeat: 'all' })); r.m.made[0].emit(0); await tick();
  assert.deepEqual(loadIds(r.m), [ids[2], ids[0]]); assert.deepEqual(endedEvents(r.ev), []);
  r = rig(); await r.facade.load(trk(1), qopts(3, 1, { repeat: 'one' })); r.m.made[0].emit(0); await tick();
  assert.deepEqual(loadIds(r.m), [ids[1], ids[1]]); assert.deepEqual(endedEvents(r.ev), []);
});
test('cola del motor: siguiente y anterior de la fachada (anterior con >3 s vuelve al inicio; al final no hay siguiente)', async () => {
  const { facade, m, ev } = rig();
  await facade.load(trk(0), qopts(3)); await facade.next(); await tick(); assert.equal(ev.at(-1)[1], 1);
  m.made[0].t = 10; await facade.prev(); await tick(); assert.equal(ev.at(-1)[1], 1); assert.deepEqual(m.made[0].calls.at(-1), ['seek', 0]);   // >3 s: al principio
  m.made[0].t = 0; await facade.prev(); await tick(); assert.equal(ev.at(-1)[1], 0);
  await facade.next(); await tick(); await facade.next(); await tick(); assert.equal(ev.at(-1)[1], 2);
  assert.equal(facade.next(), false, 'al final de la lista y sin repetir no hay siguiente (la app para)');
});
test('cola del motor: aleatorio, repetir y cambios de cola se sincronizan sin recargar la pista que suena', async () => {
  const { facade, m, pm } = rig();
  await facade.load(trk(0), qopts(3)); const loads = loadIds(m).length;
  assert.equal(facade.syncQueue({ items: music(3), index: 0, repeat: 'all', shuffle: true }), true);
  assert.equal(pm.repeat, 'all'); assert.equal(pm.shuffle, true); assert.equal(pm.order[0], 0); assert.equal(loadIds(m).length, loads, 'no se vuelve a cargar');
  assert.equal(facade.syncQueue({ items: music(3).concat([trk(3)]), index: 0, repeat: 'all', shuffle: false }), true); assert.equal(pm.queue.length, 4);   // la app añadió una a la cola
  assert.equal(loadIds(m).length, loads);
});
test('cola del motor: con vídeos o catálogo en la lista, o una pista que no encaja, manda la cola de la app (como siempre)', async () => {
  let r = rig(); await r.facade.load(trk(0), { audioOnly: true, queue: { items: [trk(0), trk(1, { kind: 'video' })], index: 0, repeat: 'off', shuffle: false } });
  assert.equal(r.facade.ownsQueue(), false); assert.equal(r.pm.queue.length, 1); assert.equal(r.pm.autoplay, false);
  r.m.made[0].emit(0); await tick(); assert.deepEqual(endedEvents(r.ev), [['ended', undefined]]);                        // «ended» normal: la app decide
  r = rig(); await r.facade.load(trk(0), { audioOnly: true, queue: { items: [trk(0), { key: 'cat:1', src: 'cat', id: 'zz', kind: 'track', url: 'https://x/a.mp3' }], index: 0, repeat: 'off', shuffle: false } });
  assert.equal(r.facade.ownsQueue(), false);
  r = rig(); await r.facade.load(trk(0), qopts(3, 1)); assert.equal(r.facade.ownsQueue(), false, 'el índice no corresponde a la pista: no se adopta');
  r = rig(); await r.facade.load(trk(0), { audioOnly: true }); assert.equal(r.facade.ownsQueue(), false, 'sin cola en las opciones: igual que antes');
  r = rig(); await r.facade.load(trk(0), qopts(3)); assert.equal(r.facade.ownsQueue(), true);
  assert.equal(r.facade.syncQueue({ items: [trk(0), trk(1, { kind: 'video' })], index: 0, repeat: 'off', shuffle: false }), false);   // la app metió un vídeo: devuelve el mando
  assert.equal(r.facade.ownsQueue(), false); assert.equal(r.pm.autoplay, false);
  r = rig(); await r.facade.load(trk(0), qopts(3)); await r.facade.load(trk(1, { kind: 'video' }), { audioOnly: false }); assert.equal(r.facade.ownsQueue(), false, 'al pasar a un vídeo normal se suelta la cola');
});
test('modo apagado: el reproductor de siempre no tiene cola propia, y el motor sin «queue» en las opciones se comporta como antes', async () => {
  assert.equal(LS.enginesEnabled, false); assert.equal(typeof LS.Player.ownsQueue, 'undefined'); assert.equal(typeof LS.Player.syncQueue, 'undefined'); assert.equal(typeof LS.Player.next, 'undefined');
  const { facade, m, pm } = rig(); await facade.load(trk(0), { audioOnly: true });
  assert.equal(pm.autoplay, false); assert.equal(pm.queue.length, 1); assert.deepEqual(loadIds(m), [ids[0]]); assert.equal(facade.next(), false); assert.equal(facade.prev(), false);
});

// ---------- cableado de la app y del contenedor de iPhone (comprobaciones del código fuente: 04-app.js es un único módulo con DOM) ----------
test('04-app.js: todo lo nuevo cuelga de LS.enginesEnabled y la cola de la app no pisa a la del motor', () => {
  const a = read('app/src/js/04-app.js');
  assert.match(a, /if \(LS\.enginesEnabled\) loadOpts\.queue = \{ items: S\.queue, index: S\.index, repeat: S\.repeat, shuffle: S\.shuffle \}/);
  assert.match(a, /Player\.load\(resolveLocal\(it\), loadOpts\);\s*prepareNext\(\);/);
  assert.match(a, /function prepareNext\(\) \{\s*if \(!LS\.enginesEnabled \|\| typeof Player\.prepare !== 'function' \|\| S\.shuffle\) return;/);
  assert.match(a, /function next\(\) \{\s*if \(ownedStep\('next'\)\) return;/); assert.match(a, /function prev\(\) \{\s*if \(ownedStep\('prev'\)\) return;/);
  assert.match(a, /function engineOwnsQueue\(\) \{ return LS\.enginesEnabled && typeof Player\.ownsQueue === 'function' && Player\.ownsQueue\(\); \}/);
  assert.match(a, /function applyQueue\(r\) \{ S\.queue = r\.queue; S\.index = r\.index; syncExpQueue\(\); \}/);
  assert.match(a, /Player\.on\('ended', \(e\) => \{ if \(e && e\.queueEnd\)/); assert.match(a, /Player\.on\('track'/); assert.match(a, /!engineOwnsQueue\(\)\) setTimeout\(next, 1200\)/);
  assert.match(a, /LS\.enginesEnabled && Native\.platform === 'ios'/); assert.match(a, /Native\.call\('playbackState'/);
  assert.match(a, /function onEnded\(\) \{ if \(S\.repeat === 'one' && S\.now\)/, 'la lógica de siempre sigue ahí');
});
test('WebShell.swift: «playbackState» y ráfagas de reanudación solo si debía sonar y no la pausó el usuario', () => {
  const w = read('ios/LibreStream/Shell/WebShell.swift').replace(/\r\n/g, '\n');
  assert.match(w, /case "playbackState":/); assert.match(w, /wantPlay = payload\["wantPlay"\] as\? Bool \?\? true/); assert.match(w, /userPause = payload\["userPause"\] as\? Bool \?\? false/);
  assert.match(w, /guard let self, self\.wantPlay, !self\.userPause else \{ return \}/);
  assert.match(w, /\[0\.1, 0\.25, 0\.4, 0\.6, 0\.9, 1\.3, 2\.0, 3\.0, 5\.0\]/, 'las ráfagas de siempre no cambian');
  assert.match(w, /hasSuffix\("\.motores"\)/);
});
test('CI: build-ipa.yml sigue ejecutando core.test.mjs tal cual y ejecuta también las pruebas del modo experimental antes de empaquetar', () => {
  const y = read('.github/workflows/build-ipa.yml').replace(/\r\n/g, '\n');
  assert.ok(y.includes('node --test app/test/core.test.mjs\n          node app/build.mjs'), 'el paso original queda intacto');
  assert.match(y, /node --test[^\n]*app\/test\/experimental\.test\.mjs/);
  assert.ok(y.indexOf('experimental.test.mjs') < y.indexOf('xcodebuild'), 'las pruebas corren antes de compilar la app');
});
