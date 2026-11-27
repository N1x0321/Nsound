// eq.js con un AudioContext FALSO: comprueba el camino del sonido (con el ecualizador apagado va directo, sin filtros procesando en vacío),
// que nunca queda mudo y que el nivel para el visualizador solo se calcula con el ecualizador encendido. No mide calor real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../src/eq.js', import.meta.url), 'utf8');

function sandbox() {
  const links = new Set(), made = { ctxOpts: null, mediaSources: 0, levelReads: 0 }, intervals = [], posted = [];
  const key = (a, b) => a.id + '>' + b.id;
  class Node {
    constructor(id, kind) { this.id = id; this.kind = kind; this.gain = { value: 0 }; this.frequency = { value: 0 }; this.Q = { value: 0 }; }
    connect(to) { links.add(key(this, to)); return to; }
    disconnect() { [...links].filter((l) => l.startsWith(this.id + '>')).forEach((l) => links.delete(l)); }
  }
  let n = 0;
  class AC {
    constructor(opts) { made.ctxOpts = opts; made.ctx = this; this.state = 'running'; this.destination = new Node('dest', 'dest'); }
    createMediaElementSource() { made.mediaSources++; return new Node('src', 'source'); }
    createBiquadFilter() { return new Node('f' + (n++), 'filter'); }
    createAnalyser() { const a = new Node('an', 'analyser'); a.frequencyBinCount = 128; a.getByteFrequencyData = (b) => { made.levelReads++; b.fill(100); }; return a; }
    resume() { this.state = 'running'; return Promise.resolve(); }
  }
  const video = { paused: false };
  const listeners = {};
  const win = {
    AudioContext: AC, parent: { postMessage: (m) => posted.push(m) }, addEventListener: (t, f) => { listeners[t] = f; },
  };
  win.window = win;
  const doc = { querySelector: () => video, addEventListener() {}, hasFocus: () => true };
  const ctx = vm.createContext({
    window: win, document: doc, location: { hostname: 'www.youtube.com' }, navigator: {}, console, Uint8Array, JSON, Math, Array, Object, Number, String, Promise,
    Document: { prototype: {} }, MediaSession: undefined,
    setInterval: (f, ms) => { intervals.push({ f, ms }); return intervals.length; }, clearInterval() {},
  });
  vm.runInContext(code, ctx);
  return { win, links, made, intervals, posted, video, send: (d) => listeners.message({ data: d, source: { postMessage: (m) => posted.push(m) } }) };
}
const chain = (links) => ['src>f0', 'f0>f1', 'f1>f2', 'f2>f3', 'f3>f4', 'f4>f5', 'f5>f6', 'f6>f7', 'f7>f8', 'f8>f9', 'f9>an', 'an>dest'];

test('apagado: no se engancha nada (el audio de YouTube no se toca)', () => {
  const s = sandbox();
  s.win.__lsEq([0, 0, 0, 0, 0, 0, 0, 0, 0, 0], false);
  assert.equal(s.made.mediaSources, 0); assert.equal(s.links.size, 0);
});

test('encendido: el sonido pasa por los 10 filtros y el analizador; contexto «playback» para gastar menos', () => {
  const s = sandbox();
  s.win.__lsEq([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], true);
  assert.equal(s.made.mediaSources, 1); assert.equal(JSON.stringify(s.made.ctxOpts), JSON.stringify({ latencyHint: 'playback' }));
  assert.deepEqual([...s.links].sort(), chain().sort());
  assert.equal(JSON.parse(s.win.__lsEqStatus()).routed, 'eq');
});

test('apagarlo después: camino directo fuente → salida, sin filtros ni analizador conectados, y nunca mudo', () => {
  const s = sandbox();
  s.win.__lsEq(new Array(10).fill(3), true);
  s.win.__lsEq(new Array(10).fill(3), false);
  assert.deepEqual([...s.links], ['src>dest']);
  assert.equal(JSON.parse(s.win.__lsEqStatus()).routed, 'bypass');
  s.win.__lsEq(new Array(10).fill(3), true);                           // se puede volver a encender sin enganchar otra vez
  assert.equal(s.made.mediaSources, 1); assert.deepEqual([...s.links].sort(), chain().sort());
});

test('el nivel del visualizador solo se calcula y envía con el ecualizador encendido y sonando', () => {
  const s = sandbox(); const level = s.intervals.find((i) => i.ms === 125); assert.ok(level, 'cada 125 ms');
  s.win.__lsEq(new Array(10).fill(0), true); const reads = s.made.levelReads;
  level.f(); assert.ok(s.made.levelReads > reads); assert.ok(s.posted.some((m) => typeof m.lsLevel === 'number'));
  s.posted.length = 0; s.win.__lsEq(new Array(10).fill(0), false); const r2 = s.made.levelReads;
  level.f(); assert.equal(s.made.levelReads, r2, 'apagado: no lee el analizador'); assert.equal(s.posted.length, 0);
  s.win.__lsEq(new Array(10).fill(0), true); s.video.paused = true; level.f();
  assert.equal(s.posted.length, 0, 'en pausa no envía');
});

test('si el sistema suspende el contexto, se reanuda aunque el ecualizador esté apagado (si no, el vídeo quedaría mudo)', () => {
  const s = sandbox(); s.win.__lsEq(new Array(10).fill(0), true); s.win.__lsEq(new Array(10).fill(0), false);
  const maint = s.intervals.find((i) => i.ms === 1000);
  assert.equal(JSON.parse(s.win.__lsEqStatus()).routed, 'bypass');
  s.made.ctx.state = 'suspended'; maint.f();
  assert.equal(s.made.ctx.state, 'running');
});

test('las órdenes por postMessage aplican las ganancias y responden al estado', () => {
  const s = sandbox();
  s.send({ lsEq: { gains: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], on: true } });
  assert.equal(s.made.mediaSources, 1);
  s.send({ lsEqStatusReq: true });
  const r = s.posted.find((m) => m.lsEqStatus); assert.equal(r.lsEqStatus.attached, true); assert.equal(r.lsEqStatus.routed, 'eq');
});
