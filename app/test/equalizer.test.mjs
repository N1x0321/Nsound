// eq.js con un AudioContext FALSO: comprueba el camino del sonido (apagado o en «Plano» no se toca; encendido solo trabajan las bandas
// movidas), que nunca queda mudo y que no deja temporizadores ni medidas en marcha sin necesidad. No mide calor ni batería reales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../src/eq.js', import.meta.url), 'utf8');

/** @param {{canStart?: boolean, startsRunning?: boolean}} opts canStart: el sistema deja arrancar el audio al pedirlo */
function sandbox(opts = {}) {
  const sys = { canStart: opts.canStart !== false };
  const links = new Set(), made = { ctxOpts: null, mediaSources: 0, levelReads: 0, resumes: 0 }, timers = new Map(), posted = [];
  const key = (a, b) => a.id + '>' + b.id;
  class Node {
    constructor(id) { this.id = id; this.gain = { value: 0 }; this.frequency = { value: 0 }; this.Q = { value: 0 }; }
    connect(to) { links.add(key(this, to)); return to; }
    disconnect() { [...links].filter((l) => l.startsWith(this.id + '>')).forEach((l) => links.delete(l)); }
  }
  let filters = 0;
  class AC {
    constructor(o) { made.ctxOpts = o; made.ctx = this; this.state = opts.startsRunning === false ? 'suspended' : 'running'; this.destination = new Node('dest'); this.filters = []; }
    createMediaElementSource(el) {
      if (el.__src) throw new Error('InvalidStateError: ya tiene fuente');
      assert.equal(this.state, 'running', 'enganchar un vídeo a un procesador parado lo dejaría mudo');
      el.__src = true; made.mediaSources++; return new Node(made.mediaSources === 1 ? 'src' : 'src' + made.mediaSources);
    }
    createBiquadFilter() { const f = new Node('f' + (filters++)); this.filters.push(f); return f; }
    createAnalyser() { const a = new Node('an'); a.frequencyBinCount = 128; a.getByteFrequencyData = (b) => { made.levelReads++; b.fill(100); }; return a; }
    resume() { made.resumes++; if (sys.canStart && this.state !== 'running') { this.state = 'running'; if (this.onstatechange) this.onstatechange(); } return Promise.resolve(); }
  }
  const video = (paused = false) => ({ tagName: 'VIDEO', paused, isConnected: true });
  const videos = [video()];
  const listeners = {}, docListeners = {};
  const navigator = { audioSession: { type: 'auto' } };
  const win = { AudioContext: AC, parent: { postMessage: (m) => posted.push(m) }, addEventListener: (t, f) => { listeners[t] = f; } };
  win.window = win;
  const doc = { querySelector: () => videos[0], querySelectorAll: () => videos, addEventListener: (t, f, capture) => { docListeners[t] = { f, capture }; }, hasFocus: () => true };
  let seq = 0;
  const context = vm.createContext({
    window: win, document: doc, location: { hostname: 'www.youtube.com' }, navigator, console, Uint8Array, JSON, Math, Array, Object, Number, String, Promise, Date, WeakMap,
    Document: { prototype: {} }, MediaSession: undefined,
    setInterval: (f, ms) => { timers.set(++seq, { f, ms }); return seq; }, clearInterval: (id) => { timers.delete(id); },
  });
  vm.runInContext(code, context);
  const timer = (ms) => [...timers.values()].find((t) => t.ms === ms);
  const status = () => JSON.parse(win.__lsEqStatus());
  return {
    win, links, made, timers, timer, status, posted, video, videos, sys, navigator, docListeners,
    send: (d) => listeners.message({ data: d, source: { postMessage: (m) => posted.push(m) } }),
  };
}
const flat = () => new Array(10).fill(0);
const all = (db) => new Array(10).fill(db);
const bands = (...at) => flat().map((_, i) => (at.includes(i) ? 4 : 0));
const chain = (src, ...ids) => { const n = [src, ...ids.map((i) => 'f' + i), 'dest']; return n.slice(1).map((to, i) => n[i] + '>' + to).sort(); };
const links = (s) => [...s.links].sort();

test('apagado: no se engancha nada ni queda nada en marcha (el audio de YouTube no se toca)', () => {
  const s = sandbox();
  s.win.__lsEq(all(5), false);
  assert.equal(s.made.mediaSources, 0); assert.equal(s.links.size, 0); assert.equal(s.timers.size, 0); assert.equal(s.made.ctxOpts, null);
});

test('encendido en «Plano»: tampoco se engancha, porque no cambiaría el sonido', () => {
  const s = sandbox();
  s.win.__lsEq(flat(), true);
  assert.equal(s.made.mediaSources, 0); assert.equal(s.timers.size, 0); assert.equal(s.made.ctxOpts, null);
  assert.equal(s.status().flat, true);
});

test('solo trabajan las bandas movidas, con sus ganancias; contexto «playback» para gastar menos', () => {
  const s = sandbox();
  s.win.__lsEq([6, 5, 0, 0, 0, 0, 0, 0, 0, -3], true);
  assert.equal(JSON.stringify(s.made.ctxOpts), JSON.stringify({ latencyHint: 'playback' }));
  assert.deepEqual(links(s), chain('src', 0, 1, 9));
  assert.deepEqual(s.made.ctx.filters.map((f) => f.gain.value), [6, 5, 0, 0, 0, 0, 0, 0, 0, -3]);
  assert.equal(s.navigator.audioSession.type, 'playback');
});

test('con las 10 bandas movidas pasan por los 10 filtros, y las ganancias se limitan a ±12', () => {
  const s = sandbox();
  s.win.__lsEq([40, -40, 'x', 1, 1, 1, 1, 1, 1, 1], true);
  assert.deepEqual(s.made.ctx.filters.map((f) => f.gain.value), [12, -12, 0, 1, 1, 1, 1, 1, 1, 1]);
  s.win.__lsEq(all(2), true);
  assert.deepEqual(links(s), chain('src', 0, 1, 2, 3, 4, 5, 6, 7, 8, 9));
});

test('cambiar de bandas rehace el camino sin volver a enganchar; mover solo el valor no lo toca', () => {
  const s = sandbox();
  s.win.__lsEq(bands(0), true);
  s.win.__lsEq(bands(2, 3), true);
  assert.deepEqual(links(s), chain('src', 2, 3));
  const antes = links(s);
  s.win.__lsEq(flat().map((_, i) => (i === 2 || i === 3 ? -7 : 0)), true);
  assert.deepEqual(links(s), antes); assert.equal(s.made.ctx.filters[2].gain.value, -7); assert.equal(s.made.mediaSources, 1);
});

test('apagarlo o volver a «Plano»: camino directo fuente → salida, y nunca mudo', () => {
  const s = sandbox();
  s.win.__lsEq(all(3), true);
  s.win.__lsEq(all(3), false);
  assert.deepEqual(links(s), ['src>dest']); assert.equal(s.status().routed, 'bypass');
  s.win.__lsEq(all(3), true);
  assert.equal(s.made.mediaSources, 1); assert.equal(s.status().routed, 'eq');
  s.win.__lsEq(flat(), true);
  assert.deepEqual(links(s), ['src>dest']);
});

test('si el procesador de audio no arranca, el vídeo no se engancha (seguiría mudo); en cuanto arranca, sí', () => {
  const s = sandbox({ startsRunning: false, canStart: false });
  s.win.__lsEq(all(3), true);
  assert.equal(s.made.mediaSources, 0); assert.equal(s.status().attached, false); assert.equal(s.status().state, 'suspended');
  s.timer(1000).f();
  assert.equal(s.made.mediaSources, 0); assert.ok(s.made.resumes > 1, 'se reintenta');
  s.sys.canStart = true; s.timer(1000).f();
  assert.equal(s.made.mediaSources, 1); assert.equal(s.status().routed, 'eq');
});

test('un procesador que nace parado pero puede arrancar se engancha enseguida', () => {
  const s = sandbox({ startsRunning: false });
  s.win.__lsEq(all(3), true);
  assert.equal(s.made.mediaSources, 1);
});

test('si el sistema suspende el contexto, se reanuda aunque el ecualizador esté apagado (si no, el vídeo quedaría mudo)', () => {
  const s = sandbox(); s.win.__lsEq(all(2), true); s.win.__lsEq(all(2), false);
  for (const estado of ['suspended', 'interrupted']) {   // «interrupted» es el de iPhone
    s.made.ctx.state = estado; s.timer(1000).f();
    assert.equal(s.made.ctx.state, 'running', estado);
  }
  s.made.ctx.state = 'suspended'; s.made.ctx.onstatechange();
  assert.equal(s.made.ctx.state, 'running', 'sin esperar a la vigilancia si el vídeo suena');
});

test('el analizador solo cuelga cuando la página pide el nivel; sin pedirlo no hay medidas', () => {
  const s = sandbox();
  s.win.__lsEq(all(2), true);
  assert.equal(s.timer(125), undefined); assert.ok(!links(s).some((l) => l.endsWith('>an'))); assert.equal(s.made.levelReads, 0);

  s.send({ lsEqLevel: true });
  assert.ok(links(s).includes('f9>an')); assert.ok(links(s).includes('f9>dest'), 'el sonido sigue saliendo');
  s.timer(125).f();
  assert.ok(s.posted.some((m) => typeof m.lsLevel === 'number'));
  s.posted.length = 0; s.videos[0].paused = true; s.timer(125).f();
  assert.equal(s.posted.length, 0, 'en pausa no envía');

  s.send({ lsEqLevel: false });
  assert.equal(s.timer(125), undefined); assert.ok(!links(s).includes('f9>an'));
});

test('con el ecualizador apagado no se mide aunque se pida', () => {
  const s = sandbox(); s.win.__lsEq(all(2), true, true); assert.ok(s.timer(125));
  s.win.__lsEq(all(2), false);
  assert.equal(s.timer(125), undefined); assert.deepEqual(links(s), ['src>dest']);
});

test('consultar el estado mide unos segundos y después deja de hacerlo', () => {
  const s = sandbox(); s.win.__lsEq(bands(4), true);
  assert.ok(s.status().level > 0); assert.ok(links(s).includes('f4>an'));
  const real = Date.now;
  try { Date.now = () => real() + 6000; s.timer(1000).f(); } finally { Date.now = real; }
});

test('las órdenes por postMessage aplican las ganancias y responden al estado', () => {
  const s = sandbox();
  s.send({ lsEq: { gains: all(1), on: true, level: false } });
  assert.equal(s.made.mediaSources, 1);
  s.send({ lsEqStatusReq: true });
  const r = s.posted.find((m) => m.lsEqStatus); assert.equal(r.lsEqStatus.attached, true); assert.equal(r.lsEqStatus.routed, 'eq'); assert.equal(r.lsEqStatus.bands, 10);
});

test('si YouTube cambia de <video> el ecualizador se engancha al nuevo, y el viejo no se queda mudo', () => {
  const s = sandbox();
  s.win.__lsEq(bands(0), true);
  const viejo = s.videos[0], nuevo = s.video();
  s.videos.length = 0; s.videos.push(nuevo);
  s.timer(1000).f();
  assert.deepEqual(links(s), [...chain('src2', 0), 'src>dest'].sort());
  assert.equal(s.status().videoSwaps, 1);
  s.timer(1000).f(); assert.equal(s.made.mediaSources, 2, 'no se engancha dos veces al mismo elemento');

  // Y si vuelve al de antes (un anuncio), se reutiliza su fuente en vez de pedir otra
  s.videos.length = 0; s.videos.push(viejo); s.status(); s.timer(1000).f();
  assert.equal(s.made.mediaSources, 2);
  assert.ok(links(s).includes('src>f0'), 'el de antes vuelve a pasar por los filtros');
  assert.ok(links(s).includes('src2>dest'), 'y el otro sigue sonando directo');
});

test('un <video> que empieza a sonar se engancha al momento, sin esperar a la vigilancia', () => {
  const s = sandbox(); s.videos.length = 0;
  s.win.__lsEq(bands(0), true);
  assert.equal(s.made.mediaSources, 0);
  assert.equal(s.docListeners.playing.capture, true);
  const v = s.video(); s.videos.push(v); s.docListeners.playing.f({ target: v });
  assert.equal(s.made.mediaSources, 1);
});

test('sin ecualizador, que empiece a sonar un vídeo no hace nada', () => {
  const s = sandbox(); s.docListeners.playing.f({ target: s.videos[0] });
  assert.equal(s.made.ctxOpts, null); assert.equal(s.timers.size, 0);
});

test('con dos <video>, se engancha al que está sonando', () => {
  const s = sandbox(); s.videos.length = 0;
  const callado = s.video(true), suena = s.video(); s.videos.push(callado, suena);
  s.win.__lsEq(all(1), true);
  assert.equal(suena.__src, true); assert.equal(callado.__src, undefined);
});
