import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
for (const f of ['playerManager', 'stateManager', 'networkManager', 'index']) require(`../src/experimental/${f}.js`);
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
