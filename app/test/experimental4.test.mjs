// Fase 13-14: migración segura y pruebas de extremo a extremo del modo experimental (con YouTube, DOM y almacenamiento simulados).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../src/js/03-router.js');
for (const f of ['config', 'migration', 'playerManager', 'stateManager', 'networkManager', 'mediaSession', 'iosManager', 'updateManager', 'experimentalBootstrap']) require(`../src/experimental/${f}.js`);
const NS = globalThis.NSoundExperimental, LS = globalThis.LS;

const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'];
const items = ids.map((id, i) => ({ id, title: 'T' + i, artist: 'A' }));
function mem(init) {
  const d = new Map(Object.entries(init || {})), writes = [];
  return { d, writes, get length() { return d.size; }, key: (i) => [...d.keys()][i] ?? null, getItem: (k) => (d.has(k) ? d.get(k) : null),
    setItem(k, v) { writes.push(['set', k]); d.set(k, String(v)); }, removeItem(k) { writes.push(['remove', k]); d.delete(k); } };
}
function mockYT() {
  const made = [];
  class Player {
    constructor(el, o) { this.calls = []; this.t = 0; this.o = o; made.push(this); Promise.resolve().then(() => o.events.onReady()); }
    loadVideoById(p) { this.calls.push(['load', p.videoId, p.startSeconds]); } cueVideoById(p) { this.calls.push(['cue', p.videoId, p.startSeconds]); }
    playVideo() { this.calls.push(['play']); } pauseVideo() { this.calls.push(['pause']); } seekTo(s) { this.calls.push(['seek', s]); }
    setVolume(v) { this.vol = v; } getCurrentTime() { return this.t; } getDuration() { return 200; }
    emit(c) { this.o.events.onStateChange({ data: c }); } err(c) { this.o.events.onError({ data: c }); }
  }
  return { made, YT: { Player } };
}
const mkPm = (volume) => { const m = mockYT(); return { m, pm: new NS.PlayerManager({ container: 'exp', loadApi: async () => m.YT, volume }) }; };
const timers = () => { const l = []; return { l, st: (f, ms) => { l.push({ f, ms }); return l.length; }, ct: (id) => { if (l[id - 1]) l[id - 1].f = null; },
  run: async (ms) => { const t = l.find((x) => x.f && x.ms === ms); if (t) { const f = t.f; t.f = null; await f(); } return !!t; } }; };
const PROD = { 'ls.settings': '{"volume":80}', 'ls.library': '[{"id":"x"}]', 'ls.history': '[1,2,3]', 'ls.lists': '{"a":[]}', 'ls.cache': '{}', 'otra.app': 'dato' };

// ================= Fase 13: migración segura =================
test('migración: copia previa de lo propio, esquema nuevo y producción intacta', () => {
  const st = mem(Object.assign({ nsound_experimental_state: JSON.stringify({ videoId: ids[0], position: 1, queue: items }) }, PROD));
  const mig = new NS.Migration({ storage: st, now: () => 1000 });
  const before = mig.productionFingerprint();
  const r = mig.run();
  assert.equal(r.ok, true); assert.equal(r.migrated, true); assert.equal(r.to, 1); assert.equal(r.backup, 'nsound_experimental_backup_1000');
  assert.equal(st.getItem('nsound_experimental_schema'), '1');
  const b = JSON.parse(st.getItem(r.backup)); assert.ok(b.data.nsound_experimental_state); assert.ok(Object.keys(b.data).every((k) => k.startsWith('nsound_experimental_')));
  assert.equal(mig.productionFingerprint(), before);
  for (const [k, v] of Object.entries(PROD)) assert.equal(st.getItem(k), v);
  assert.ok(st.writes.every(([, k]) => k.startsWith('nsound_experimental_')), 'solo claves propias');
});
test('migración: estado dañado se aparta (no se pierde) y la segunda ejecución no vuelve a migrar', () => {
  const st = mem(Object.assign({ nsound_experimental_state: '{roto' }, PROD));
  const mig = new NS.Migration({ storage: st, now: () => 5 });
  assert.equal(mig.run().ok, true);
  assert.equal(st.getItem('nsound_experimental_state'), null); assert.equal(st.getItem('nsound_experimental_state_corrupt'), '{roto');
  assert.ok(JSON.parse(st.getItem('nsound_experimental_backup_5')).data.nsound_experimental_state === '{roto');
  const again = new NS.Migration({ storage: st, now: () => 6 }).run(); assert.equal(again.ok, true); assert.equal(again.migrated, false);
});
test('migración: si no se puede hacer la copia, no se toca nada y no se arranca', () => {
  const st = mem(Object.assign({ nsound_experimental_state: '{"videoId":"a","queue":[],"position":0}' }, PROD));
  const orig = st.setItem.bind(st); st.setItem = (k, v) => { if (k.startsWith('nsound_experimental_backup_')) throw new Error('QuotaExceeded'); orig(k, v); };
  const r = new NS.Migration({ storage: st }).run();
  assert.deepEqual([r.ok, r.reason], [false, 'backup-failed']); assert.equal(st.getItem('nsound_experimental_schema'), null);
  assert.equal(NS.migrate(st), false);
});
test('migración: solo se podan copias propias antiguas; restore devuelve solo claves propias', () => {
  const st = mem(Object.assign({ nsound_experimental_state: '{"videoId":"a","queue":[],"position":0}' }, PROD));
  let t = 0; const mig = new NS.Migration({ storage: st, now: () => ++t, keepBackups: 2 });
  for (let i = 0; i < 5; i++) mig.run();
  assert.equal(mig.listBackups().length, 2);
  for (const k of Object.keys(PROD)) assert.equal(st.getItem(k), PROD[k]);
  st.setItem('nsound_experimental_state', 'cambiado');
  const key = mig.listBackups().at(-1); st.setItem(key, JSON.stringify({ ts: 1, data: { nsound_experimental_state: 'orig', 'ls.settings': 'MALICIOSO' } }));
  assert.equal(mig.restore(key), true); assert.equal(st.getItem('nsound_experimental_state'), 'orig'); assert.equal(st.getItem('ls.settings'), PROD['ls.settings']);
});
test('almacenamiento con candado: rechaza claves ajenas y clear solo borra lo propio', () => {
  const st = mem(Object.assign({ nsound_experimental_a: '1' }, PROD)); const safe = NS.createSafeStorage(st);
  safe.setItem('ls.settings', 'x'); safe.removeItem('ls.library'); safe.setItem('nsound_experimental_b', '2'); safe.clear();
  assert.equal(safe.violations.length, 2); for (const k of Object.keys(PROD)) assert.equal(st.getItem(k), PROD[k]);
  assert.equal(st.getItem('nsound_experimental_a'), null); assert.equal(st.getItem('nsound_experimental_b'), null);
});

// ================= Fase 14: restauración =================
test('restauración: cola, volumen, modos y segundo exacto tras reiniciar', async () => {
  const st = mem(PROD); const a = mkPm(33); a.pm.setQueue(items, 2, 'Mi lista'); a.pm.setRepeat('all'); a.pm.setShuffle(false);
  await a.pm.playIndex(2); a.m.made[0].t = 61.5;
  new NS.StateManager({ player: a.pm, storage: st }).saveNow();
  const b = mkPm(); const sm = new NS.StateManager({ player: b.pm, storage: st });
  assert.equal(await sm.restore(), true); await new Promise((r) => setImmediate(r));
  assert.equal(b.pm.queue.length, 3); assert.equal(b.pm.current().id, ids[2]); assert.equal(b.pm.playlist, 'Mi lista'); assert.equal(b.pm.repeat, 'all');
  assert.equal(b.pm.volume, 33); assert.equal(b.m.made[0].vol, 33);
  assert.deepEqual(b.m.made[0].calls[0], ['cue', ids[2], 61.5]);           // en pausa, en el segundo exacto
  for (const k of Object.keys(PROD)) assert.equal(st.getItem(k), PROD[k]);
});

// ================= Fase 14: reconexión tras corte de red =================
test('corte de red: guarda, espera 3 s, sigue sin conexión, vuelve y continúa desde el último segundo', async () => {
  const { pm, m } = mkPm(); pm.setQueue(items, 0); const st = mem(); const sm = new NS.StateManager({ player: pm, storage: st });
  const t = timers(), listeners = {}; const env = { navigator: { onLine: true }, addEventListener(e, f) { (listeners[e] = listeners[e] || []).push(f); }, removeEventListener() {} };
  const nm = new NS.NetworkManager({ player: pm, state: sm, env, setTimeout: t.st, clearTimeout: t.ct }); nm.start();
  await pm.playIndex(0); const p = m.made[0]; p.emit(1); p.t = 95; p.emit(3);
  env.navigator.onLine = false; listeners.offline[0]();
  assert.equal(JSON.parse(st.getItem('nsound_experimental_state')).position, 95);
  await t.run(3000); assert.equal(p.calls.filter((c) => c[0] === 'load').length, 1);       // sigue sin red: no se carga
  env.navigator.onLine = true; await t.run(6000); await t.run(3000);
  assert.deepEqual(p.calls.at(-1), ['load', ids[0], 95]);
  p.emit(1); assert.ok(nm.getLog().some((e) => e.event === 'recovered'));
});

// Fallo grave: la música no se podía parar (un reintento pendiente la reanudaba tras pausar)
test('pausa del usuario: cancela reintentos pendientes y nunca se reanuda sola', async () => {
  const { pm, m } = mkPm(); pm.setQueue(items, 0); const st = mem(); const sm = new NS.StateManager({ player: pm, storage: st });
  const t = timers(), env = { navigator: { onLine: true }, addEventListener() {}, removeEventListener() {} };
  const nm = new NS.NetworkManager({ player: pm, state: sm, env, setTimeout: t.st, clearTimeout: t.ct }); nm.start();
  await pm.playIndex(0); const p = m.made[0]; p.emit(1); p.t = 20; p.emit(3);
  nm.trouble('x'); await t.run(3000);                                        // 1.er reintento hecho
  const loads = () => p.calls.filter((c) => c[0] === 'load').length; const before = loads();
  pm.pause(); p.emit(2);                                                     // el usuario pausa
  await t.run(6000); await t.run(3000); await t.run(6000);
  assert.equal(loads(), before); assert.equal(nm.trouble('offline'), false);
  assert.ok(nm.getLog().some((e) => e.event === 'ignored-user-paused'));
});

// ================= Fase 14: ciclo de vida Safari iOS / Chrome iOS / iPad =================
const UAS = {
  'Safari iPhone': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Chrome iOS': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0 Mobile/15E148 Safari/604.1',
  'iPad (modo escritorio)': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
};
for (const [name, ua] of Object.entries(UAS)) {
  test(`ciclo de vida ${name}: bloquear/desbloquear y cambiar de pestaña reanudan en el segundo exacto`, async () => {
    const { pm, m } = mkPm(); pm.setQueue(items, 1); const st = mem(); const sm = new NS.StateManager({ player: pm, storage: st });
    const doc = { hidden: false, _l: {}, addEventListener(e, f) { (this._l[e] = this._l[e] || []).push(f); }, removeEventListener() {} }, ls = {};
    const env = { document: doc, navigator: { userAgent: ua, maxTouchPoints: 5 }, localStorage: mem(), addEventListener(e, f) { (ls[e] = ls[e] || []).push(f); }, removeEventListener() {} };
    const t = timers(); const ios = new NS.IOSManager({ player: pm, state: sm, env, setTimeout: t.st, clearTimeout: t.ct });
    assert.equal(ios.start(), true, 'debe actuar en ' + name);
    await pm.playIndex(1); const p = m.made[0]; p.emit(1); p.t = 140.25;
    for (let vuelta = 0; vuelta < 2; vuelta++) {                                   // 1.ª: bloqueo de pantalla; 2.ª: cambio de pestaña
      doc.hidden = true; doc._l.visibilitychange[0](); if (vuelta === 0) ls.pagehide[0]();
      assert.equal(JSON.parse(st.getItem('nsound_experimental_state')).position, 140.25);
      p.emit(2); p.t = 0;                                                          // iOS pausa el iframe
      doc.hidden = false; doc._l.visibilitychange[0](); await t.run(300); await t.run(600);
      assert.deepEqual(p.calls.at(-1), ['load', ids[1], 140.25]);
      p.emit(1); p.t = 140.25;
    }
  });
}
test('ciclo de vida: no actúa fuera de iOS', () => {
  const { pm } = mkPm(); const env = { document: { addEventListener() {}, removeEventListener() {} }, navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/123', maxTouchPoints: 0 }, addEventListener() {}, removeEventListener() {} };
  assert.equal(new NS.IOSManager({ player: pm, state: {}, env }).start(), false);
});

// ================= Fase 14: YouTube IFrame API sin afectar a los vídeos normales + sesión completa =================
function fakeDom() {
  const mk = (tag) => ({ tagName: tag.toUpperCase(), attrs: {}, children: [], nodeType: 1, id: '', setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = v; }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    hasAttribute(k) { return k in this.attrs; }, appendChild(c) { this.children.push(c); return c; }, querySelectorAll() { return []; } });
  const head = mk('head'), body = mk('body'), classes = new Set();
  const all = () => head.children.concat(body.children, body.children.flatMap((c) => c.children));
  const test = (e, sel) => [...sel.matchAll(/\[(\w+)="([^"]*)"\]/g)].every(([, k, v]) => e.attrs[k] === v) && (!/^\w+/.test(sel) || e.tagName.toLowerCase() === sel.match(/^\w+/)[0]);
  return { head, body, hidden: false, readyState: 'complete', documentElement: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } }, createElement: mk,
    getElementById: (id) => all().find((e) => e.id === id) || null, querySelector: (s) => all().find((e) => test(e, s)) || null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
}
test('sesión completa: un solo iframe experimental, #yt y vídeos normales intactos, y solo claves propias escritas', async () => {
  globalThis.ENABLE_EXPERIMENTAL_PLAYER = true; NS.instance = null;
  const ls = mem(PROD); globalThis.localStorage = ls; const doc = fakeDom(); globalThis.document = doc;
  const yt = mockYT(); globalThis.YT = yt.YT;
  const rawCalls = []; const raw = { on() {}, init() {}, state: () => ({}), mode: () => null, load: async (it) => { rawCalls.push(it.id); }, play() {}, pause() {}, seek() {}, setVolume() {}, setEq() {}, eqStatus: async () => null };
  const facade = LS.engines.wrap(raw); const out = NS.bootstrap();
  assert.ok(out);
  await facade.load({ src: 'yt', id: ids[0], kind: 'track' }, { audioOnly: true }); await facade.load({ src: 'yt', id: ids[1], kind: 'track' }, { audioOnly: true });
  assert.equal(yt.made.length, 1); assert.deepEqual(yt.made[0].calls.map((c) => c[1]), [ids[0], ids[1]]); assert.equal(yt.made[0].o.playerVars.autoplay, 0);   // misma instancia, sin recrear iframes
  assert.ok(doc.getElementById('exp-player')); assert.equal(doc.getElementById('yt'), null);                                                                   // el contenedor de #yt no se toca
  await facade.load({ src: 'yt', id: ids[2], kind: 'video' }, { audioOnly: false }); assert.deepEqual(rawCalls, [ids[2]]);                                   // vídeo normal: reproductor de siempre
  yt.made[0].t = 20; out.controller.state.saveNow(); out.controller.ios.leave('test'); out.stop();
  for (const [k, v] of Object.entries(PROD)) assert.equal(ls.getItem(k), v);
  assert.ok(ls.writes.every(([, k]) => k.startsWith('nsound_experimental_')), 'escrituras fuera del espacio propio: ' + JSON.stringify(ls.writes.filter(([, k]) => !k.startsWith('nsound_experimental_'))));
  assert.equal(NS.debug().running, false);                                                                                                                      // tras parar, ya no hay instancia
});
