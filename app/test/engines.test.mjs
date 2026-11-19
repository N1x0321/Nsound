import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
const require = createRequire(import.meta.url);
require('../src/js/03-router.js');
require('../src/js/03-covers.js');
const LS = globalThis.LS;

// Reproductor «crudo» falso con la misma API que LS.Player
function fakeRaw() {
  const subs = {}, calls = [];
  const raw = {
    calls,
    on: (e, fn) => (subs[e] = subs[e] || []).push(fn),
    fire: (e, d) => (subs[e] || []).forEach((f) => f(d)),
    init() {}, state: () => ({ playing: false, time: 0, duration: 0 }), mode: () => null,
    load: async (it, o) => { calls.push(['load', it.id, o]); },
    play: () => calls.push(['play']), pause: () => calls.push(['pause']),
    seek: (t) => calls.push(['seek', t]), setVolume: (v) => calls.push(['vol', v]),
    setEq() {}, eqStatus: async () => null,
  };
  return raw;
}

test('el interruptor está apagado por defecto', () => { assert.equal(LS.enginesEnabled, false); });

test('wrap emite los mismos eventos que el motor actual', async () => {
  const raw = fakeRaw(), p = LS.engines.wrap(raw), got = [];
  p.on('state', (s) => got.push(['state', s])); p.on('ended', () => got.push(['ended'])); p.on('error', (e) => got.push(['error', e]));
  await p.load({ src: 'yt', id: 'a' }, { audioOnly: true });
  assert.deepEqual(raw.calls[0], ['load', 'a', { audioOnly: true }]);
  const st = { playing: true, time: 3, duration: 100 };
  raw.fire('state', st); raw.fire('ended'); raw.fire('error', { code: 150 });
  assert.deepEqual(got, [['state', st], ['ended'], ['error', { code: 150 }]]);
});

test('el router expone eventos normalizados state/progress/track/ended/error', async () => {
  const raw = fakeRaw(), p = LS.engines.wrap(raw), ev = [];
  p.router.on((e) => ev.push(e));
  const tr = { src: 'yt', id: 'a' };
  await p.load(tr);
  raw.fire('state', { playing: true, time: 5, duration: 60 }); raw.fire('ended'); raw.fire('error', { code: 2 });
  assert.deepEqual(ev.map((e) => e.type), ['track', 'state', 'progress', 'ended', 'error']);
  assert.equal(ev[0].track, tr);
  assert.equal(ev[1].state, 'playing'); assert.equal(ev[2].position, 5); assert.equal(ev[4].error.code, 2);
});

test('cambio de motor: para el anterior y solo reenvía eventos del activo', async () => {
  const raw = fakeRaw(), p = LS.engines.wrap(raw);
  await p.load({ src: 'yt', id: 'a' });
  assert.equal(p.router.current.id, 'yt');
  await p.load({ src: 'local', id: 'b', url: 'x' });
  assert.equal(p.router.current.id, 'html5');
  assert.deepEqual(raw.calls.map((c) => c[0]), ['load', 'pause', 'load']);
  assert.equal(p.router.setEngine('yt'), true);
  assert.equal(p.router.current.id, 'yt');
});

test('motor desconocido o pista sin motor: no cambia nada y avisa', async () => {
  const r = new LS.engines.EngineRouter([]), ev = [];
  r.on((e) => ev.push(e));
  assert.equal(r.setEngine('spotify'), false);
  assert.equal(r.current, null);
  assert.equal(await r.play({ src: 'zzz' }), false);
  assert.equal(ev[0].type, 'error'); assert.equal(ev[0].error.code, 'noengine');
});

test('play/pause/seek van al motor activo; sin motor no fallan', async () => {
  const raw = fakeRaw(), p = LS.engines.wrap(raw);
  p.pause(); p.seek(1);
  assert.equal(raw.calls.length, 0);
  await p.load({ src: 'yt', id: 'a' }); p.pause(); p.play(); p.seek(9);
  assert.deepEqual(raw.calls.slice(1), [['pause'], ['play'], ['seek', 9]]);
});

test('proxifyCover: apagado devuelve la URL igual', async () => {
  assert.equal(await LS.proxifyCover('https://i.ytimg.com/a.jpg'), 'https://i.ytimg.com/a.jpg');
});

test('proxifyCover: firma HMAC-SHA256 base64url y reglas', async () => {
  LS.covers.configure({ enabled: true, base: 'https://w.example/', key: 'k' });
  const u = 'https://i.ytimg.com/vi/a/hq.jpg';
  const sig = createHmac('sha256', 'k').update(u).digest('base64url');
  assert.equal(await LS.proxifyCover(u), `https://w.example/?url=${encodeURIComponent(u)}&sig=${sig}`);
  assert.equal(await LS.proxifyCover('http://x/a.jpg'), 'http://x/a.jpg');
  assert.equal(await LS.proxifyCover(''), '');
  const out = await LS.proxifyCover(u);
  assert.equal(await LS.proxifyCover(out), out);          // ya proxificada
  LS.covers.configure({ enabled: false });
});
