import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { generateExperimentalAssets, decodePng } from '../assets-experimental.mjs';
const require = createRequire(import.meta.url);

// Sin document al cargar: así el arranque automático no se dispara y se prueba a mano
require('../src/js/03-router.js');
for (const f of ['config', 'migration', 'playerManager', 'stateManager', 'networkManager', 'mediaSession', 'iosManager', 'updateManager', 'experimentalBootstrap']) require(`../src/experimental/${f}.js`);
const NS = globalThis.NSoundExperimental, LS = globalThis.LS;

// ---- DOM mínimo ----
function fakeDom(preHead) {
  const matches = (el, sel) => [...sel.matchAll(/\[(\w+)="([^"]*)"\]/g)].every(([, k, v]) => el.attrs[k] === v) && (!/^\w+/.test(sel) || el.tagName.toLowerCase() === sel.match(/^\w+/)[0]);
  const mkEl = (tag) => ({ tagName: tag.toUpperCase(), attrs: {}, children: [], nodeType: 1, id: '', textContent: '',
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = v; }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, hasAttribute(k) { return k in this.attrs; },
    appendChild(c) { this.children.push(c); return c; }, querySelectorAll(sel) { return this.children.filter((c) => matches(c, sel)); } });
  const head = mkEl('head'), body = mkEl('body'), classes = new Set(), listeners = {};
  (preHead || []).forEach(([tag, attrs]) => { const e = mkEl(tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); head.appendChild(e); });
  const doc = { head, body, hidden: false, readyState: 'complete', documentElement: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), has: (c) => classes.has(c) } }, classes,
    createElement: mkEl, getElementById(id) { return [...head.children, ...body.children, ...body.children.flatMap((c) => c.children)].find((e) => e.id === id) || null; },
    querySelector(sel) { return head.children.concat(body.children).find((c) => matches(c, sel)) || null; },
    querySelectorAll(sel) { return head.children.concat(body.children, body.children.flatMap((c) => c.children)).filter((c) => matches(c, sel)); },
    addEventListener(e, f) { (listeners[e] = listeners[e] || []).push(f); }, removeEventListener() {}, fire(e) { (listeners[e] || []).forEach((f) => f()); } };
  return doc;
}
function mockYT() {
  const made = [];
  class Player {
    constructor(el, o) { this.calls = []; this.t = 0; this.o = o; made.push(this); Promise.resolve().then(() => o.events.onReady()); }
    loadVideoById(p) { this.calls.push(['load', p.videoId, p.startSeconds]); } cueVideoById(p) { this.calls.push(['cue', p.videoId]); }
    playVideo() { this.calls.push(['play']); } pauseVideo() { this.calls.push(['pause']); } seekTo(s) { this.calls.push(['seek', s]); }
    setVolume(v) { this.vol = v; } getCurrentTime() { return this.t; } getDuration() { return 180; }
    emit(c) { this.o.events.onStateChange({ data: c }); } err(c) { this.o.events.onError({ data: c }); }
  }
  return { made, YT: { Player } };
}
function fakeRaw() {
  const subs = {}, calls = [];
  return { calls, on: (e, f) => (subs[e] = subs[e] || []).push(f), init() {}, state: () => ({ playing: false, time: 0, duration: 0 }), mode: () => null,
    load: async (it, o) => { calls.push(['load', it.id, o]); }, play: () => calls.push(['play']), pause: () => calls.push(['pause']),
    seek() {}, setVolume() {}, setEq() {}, eqStatus: async () => null };
}
const tick = () => new Promise((r) => setImmediate(r));
const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb'];

// ---- config y apagado ----
test('config.js: el interruptor existe tal cual se pidió y el modo exige además la marca de la app de pruebas', () => {
  assert.match(readFileSync(new URL('../src/experimental/config.js', import.meta.url), 'utf8'), /const ENABLE_EXPERIMENTAL_PLAYER = true;/);
  assert.equal(NS.enabled(), false);                                    // config true, pero esta app no declara la marca
  globalThis.ENABLE_EXPERIMENTAL_PLAYER = true; assert.equal(NS.enabled(), true);
  NS.config.ENABLE_EXPERIMENTAL_PLAYER = false; assert.equal(NS.enabled(), false);
  NS.config.ENABLE_EXPERIMENTAL_PLAYER = true; NS.config.REQUIRE_NATIVE_FLAG = false; delete globalThis.ENABLE_EXPERIMENTAL_PLAYER; assert.equal(NS.enabled(), true);
  NS.config.REQUIRE_NATIVE_FLAG = true;
});
test('apagado: bootstrap devuelve null y no toca nada', () => {
  delete globalThis.ENABLE_EXPERIMENTAL_PLAYER;
  const doc = fakeDom(); globalThis.document = doc;
  assert.equal(NS.bootstrap(), null); assert.equal(NS.create({ container: 'x' }), null);
  assert.equal(doc.head.children.length, 0); assert.equal(doc.body.children.length, 0);
});

// ---- Fase 9 ----
test('PWA: solo se añade lo que falta (no duplica lo que ya trae la página)', () => {
  const doc = fakeDom([['meta', { name: 'theme-color', content: '#121214' }], ['meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }], ['link', { rel: 'apple-touch-icon', href: 'data:x' }]]);
  const added = NS.injectPwa(doc);
  assert.ok(!added.includes('meta:theme-color') && !added.includes('meta:apple-mobile-web-app-capable'));
  assert.ok(added.includes('meta:apple-mobile-web-app-title') && added.includes('meta:apple-mobile-web-app-status-bar-style') && added.includes('link:manifest'));
  assert.equal(added.filter((a) => a.startsWith('link:apple-touch-startup-image')).length, NS.SPLASH.length);
  assert.ok(added.includes('link:apple-touch-icon:180x180'));
  assert.deepEqual(NS.injectPwa(doc), []);                              // segunda vez: nada
  const sp = doc.head.children.find((c) => c.attrs.rel === 'apple-touch-startup-image');
  assert.match(sp.attrs.media, /device-width: 430px.*device-height: 932px.*pixel-ratio: 3.*portrait/);
});
test('recursos PWA generados: iconos, pantallas de arranque con el tamaño exacto y manifest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nsexp-'));
  const files = generateExperimentalAssets(dir, readFileSync(new URL('../src/logo.png', import.meta.url)));
  const png = (f) => decodePng(readFileSync(join(dir, f)));
  assert.equal(png('experimental/icons/icon-180.png').w, 180); assert.equal(png('experimental/icons/icon-512.png').h, 512);
  const s = png('experimental/splash/splash-1290x2796.png'); assert.deepEqual([s.w, s.h], [1290, 2796]);
  assert.deepEqual([...s.data.subarray(0, 4)], [18, 18, 20, 255]);       // fondo de la app
  for (const [w, h, r] of NS.SPLASH) assert.ok(existsSync(join(dir, `experimental/splash/splash-${w * r}x${h * r}.png`)), `${w}x${h}`);
  const m = JSON.parse(readFileSync(join(dir, 'experimental/manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone'); assert.equal(m.icons.length, 2); assert.ok(files.length >= 16);
});

// ---- Fase 10 ----
test('rendimiento: lazy loading por lotes, precarga acotada, pausa con página oculta y poca batería', async () => {
  const doc = fakeDom(); const queued = []; let observerCb, ImgCount = 0;
  const env = { document: doc, navigator: { connection: { saveData: true } }, MutationObserver: class { constructor(f) { observerCb = f; } observe() {} disconnect() {} },
    Image: class { constructor() { ImgCount++; } }, requestIdleCallback: (f) => f(), raf: null };
  const p = new NS.Perf({ env, maxImages: 3, raf: (f) => queued.push(f) });
  const keep = doc.createElement('img'); keep.setAttribute('loading', 'eager'); const eager = doc.createElement('img'); eager.setAttribute('data-eager', '1'); doc.body.appendChild(keep); doc.body.appendChild(eager);
  assert.equal(p.start(), true);
  assert.equal(keep.getAttribute('loading'), 'eager'); assert.equal(eager.hasAttribute('loading'), false); assert.equal(keep.getAttribute('decoding'), 'async');
  const a = doc.createElement('img'), b = doc.createElement('img'); observerCb([{ addedNodes: [a] }]); observerCb([{ addedNodes: [b] }]);
  assert.equal(queued.length, 1);                                       // dos cambios, un solo fotograma de trabajo
  queued[0](); assert.equal(a.getAttribute('loading'), 'lazy'); assert.equal(b.getAttribute('loading'), 'lazy');
  for (let i = 0; i < 6; i++) p.preloadImage('https://i.ytimg.com/vi/' + i + '.jpg');
  assert.equal(p.images.length, 3); assert.equal(p.preloadImage('https://i.ytimg.com/vi/5.jpg'), false); assert.equal(p.preloadImage('http://x/a.jpg'), false);
  doc.hidden = true; doc.fire('visibilitychange'); assert.ok(doc.classes.has('exp-hidden')); assert.equal(p.images.length, 0);
  doc.hidden = false; doc.fire('visibilitychange'); assert.ok(!doc.classes.has('exp-hidden'));
  assert.ok(doc.classes.has('exp-lowpower'));                           // ahorro de datos activado
  assert.ok(doc.head.children.some((c) => c.attrs.rel === 'preconnect' && c.attrs.href === 'https://i.ytimg.com'));
  assert.ok(doc.head.children.some((c) => c.attrs.rel === 'preload' && c.attrs.as === 'script'));
  assert.ok(doc.head.children.some((c) => c.id === 'exp-perf-style'));
});

// ---- Fase 12: intercepta solo la música ----
async function boot() {
  globalThis.ENABLE_EXPERIMENTAL_PLAYER = true; NS.instance = null;
  const d = new Map(); globalThis.localStorage = { get length() { return d.size; }, key: (i) => [...d.keys()][i] ?? null, getItem: (k) => (d.has(k) ? d.get(k) : null), setItem: (k, v) => d.set(k, String(v)), removeItem: (k) => d.delete(k) };
  const doc = fakeDom(); globalThis.document = doc;
  const m = mockYT(); globalThis.YT = m.YT;
  const raw = fakeRaw(); const facade = LS.engines.wrap(raw);
  const out = NS.bootstrap();
  return { doc, m, raw, facade, out };
}
test('bootstrap encendido: contenedor propio, motor delante del actual y PWA inyectada', async () => {
  const { doc, out, facade } = await boot();
  assert.ok(out && out.controller && out.engine);
  assert.ok(doc.getElementById('exp-player')); assert.notEqual(out.controller.player.container, 'yt');
  assert.equal([...facade.router.engines.keys()][0], 'exp-yt'); assert.deepEqual([...facade.router.engines.keys()], ['exp-yt', 'yt', 'html5']);
  assert.ok(out.pwa.includes('link:manifest'));
  assert.equal(NS.bootstrap(), out);                                    // idempotente
  out.stop();
});
test('solo la música pasa por el motor experimental; vídeos normales y catálogo siguen por el de siempre', async () => {
  const { m, raw, facade, out } = await boot();
  await facade.load({ src: 'yt', id: ids[0], kind: 'track', title: 'T', sub: 'Art' }, { audioOnly: true });
  assert.equal(m.made.length, 1); assert.deepEqual(m.made[0].calls[0], ['load', ids[0], 0]); assert.equal(raw.calls.length, 0);
  await facade.load({ src: 'yt', id: ids[1], kind: 'video' }, { audioOnly: false });                         // vídeo normal
  assert.deepEqual(raw.calls.at(-1), ['load', ids[1], { audioOnly: false }]);
  assert.ok(m.made[0].calls.some((c) => c[0] === 'pause'));                                                   // la música se paró al cambiar de motor
  await facade.load({ src: 'yt', id: ids[1], kind: 'video' }, { audioOnly: true });                           // marcado vídeo aunque venga en solo audio
  assert.equal(m.made[0].calls.filter((c) => c[0] === 'load').length, 1);
  await facade.load({ src: 'cat', id: 'x', url: 'u' }, {});                                                   // catálogo libre
  assert.equal(raw.calls.at(-1)[1], 'x'); assert.equal(m.made.length, 1);
  out.stop();
});
test('la app sigue recibiendo state/ended/error con la misma forma, y volumen, pausa y seek llegan al motor', async () => {
  const { m, facade, out } = await boot(); const got = [];
  facade.on('state', (s) => got.push(['state', s.playing, s.time, s.duration])); facade.on('ended', () => got.push(['ended'])); facade.on('error', (e) => got.push(['error', e.code]));
  facade.setVolume(42);
  await facade.load({ src: 'yt', id: ids[0], kind: 'track' }, { audioOnly: true }); await tick();
  const p = m.made[0]; assert.equal(p.vol, 42);
  p.t = 12; p.emit(1); assert.deepEqual(got.at(-1), ['state', true, 12, 180]);
  facade.pause(); assert.deepEqual(p.calls.at(-1), ['pause']); facade.play(); assert.deepEqual(p.calls.at(-1), ['play']);
  facade.seek(30); assert.deepEqual(p.calls.at(-1), ['seek', 30]);
  assert.equal(facade.state().playing, true);
  p.emit(0); assert.ok(got.some((g) => g[0] === 'ended') && got.filter((g) => g[0] === 'ended').length === 1);
  p.err(5); await tick(); assert.ok(!got.some((g) => g[0] === 'error'));   // recuperable: lo reintenta networkManager
  p.err(150); await tick(); assert.deepEqual(got.at(-1), ['error', 150]);
  out.stop();
});
