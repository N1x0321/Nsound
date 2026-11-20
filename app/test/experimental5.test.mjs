// Puente web ↔ contenedor nativo iOS (experimental/nativeBridge.js) y comprobaciones estáticas de ios-wrapper/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../src/js/03-router.js');
for (const f of ['config', 'migration', 'playerManager', 'stateManager', 'networkManager', 'mediaSession', 'iosManager', 'updateManager', 'nativeBridge', 'experimentalBootstrap']) require(`../src/experimental/${f}.js`);
const NS = globalThis.NSoundExperimental, LS = globalThis.LS;
const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb'];
const items = ids.map((id, i) => ({ id, title: 'Tema ' + i, artist: 'Artista', art: 'https://i.ytimg.com/vi/' + id + '/hq.jpg', duration: 200 }));

function mockYT() {
  const made = [];
  class Player {
    constructor(el, o) { this.calls = []; this.t = 0; this.o = o; made.push(this); Promise.resolve().then(() => o.events.onReady()); }
    loadVideoById(p) { this.calls.push(['load', p.videoId]); } cueVideoById(p) { this.calls.push(['cue', p.videoId]); }
    playVideo() { this.calls.push(['play']); } pauseVideo() { this.calls.push(['pause']); } seekTo(s) { this.calls.push(['seek', s]); }
    setVolume() {} getCurrentTime() { return this.t; } getDuration() { return 200; } emit(c) { this.o.events.onStateChange({ data: c }); }
  }
  return { made, YT: { Player } };
}
function setup(opts) {
  const m = mockYT(); const pm = new NS.PlayerManager({ container: 'exp', loadApi: async () => m.YT }); pm.setQueue(items, 0, 'Mi lista');
  const posted = []; const env = { webkit: { messageHandlers: { nsoundAudio: { postMessage: (x) => posted.push(x) } } }, __nativeEvent: (e) => (env.events = env.events || []).push(e) };
  let tick; const b = new NS.NativeBridge(Object.assign({ player: pm, env, setInterval: (f, ms) => { tick = { f, ms }; return 1; }, clearInterval() {} }, opts));
  return { m, pm, env, posted, b, tick: () => tick };
}

test('fuera del contenedor (sin nsoundAudio) no hace nada', () => {
  const { pm } = setup(); const env = {}; const b = new NS.NativeBridge({ player: pm, env });
  assert.equal(b.available, false); assert.equal(b.start(), false); assert.equal(env.NSoundNativeBridge, undefined);
});
test('web → nativo: ready, metadatos completos y estado', async () => {
  const s = setup(); assert.equal(s.b.start(), true);
  assert.deepEqual(s.posted.map((p) => p.type), ['ready', 'nowPlaying']);               // la cola ya tiene pista actual
  await s.pm.playIndex(0); const p = s.m.made[0]; p.t = 12;
  const np = s.posted.find((x) => x.type === 'nowPlaying');
  assert.deepEqual([np.title, np.artist, np.album, np.playing, np.videoId], ['Tema 0', 'Artista', 'Mi lista', false, ids[0]]);
  assert.match(np.artwork, /ytimg\.com/); assert.equal(np.duration, 200);
  p.t = 30; p.emit(1);
  assert.deepEqual(s.posted.at(-1), { type: 'state', position: 30, duration: 200, playing: true });
  p.t = 45; p.emit(2); assert.deepEqual(s.posted.at(-1), { type: 'state', position: 45, duration: 200, playing: false });
  assert.equal(s.tick().ms, 15000); p.t = 50; s.tick().f(); assert.equal(s.posted.at(-1).position, 50);   // corrección periódica de la barra de tiempo
  await s.pm.next({ auto: false }); await new Promise((r) => setImmediate(r));
  assert.equal(s.posted.filter((x) => x.type === 'nowPlaying').at(-1).title, 'Tema 1');                   // cambio de pista: metadatos nuevos
});
test('nativo → web (modo reproductor): play, pause, next, previous, seek y rechazos', async () => {
  const s = setup(); s.b.start(); await s.pm.playIndex(0); const p = s.m.made[0]; p.t = 1;
  assert.equal(typeof s.env.NSoundNativeBridge.onCommand, 'function');
  assert.equal(s.b.handle({ cmd: 'pause' }), true); assert.deepEqual(p.calls.at(-1), ['pause']);
  s.b.handle({ cmd: 'play' }); assert.deepEqual(p.calls.at(-1), ['play']);
  s.b.handle({ cmd: 'seek', position: 77 }); assert.deepEqual(p.calls.at(-1), ['seek', 77]);
  s.b.handle({ cmd: 'next' }); await new Promise((r) => setImmediate(r)); assert.equal(s.pm.current().id, ids[1]);
  s.b.handle({ cmd: 'prev' }); await new Promise((r) => setImmediate(r)); assert.equal(s.pm.current().id, ids[0]);
  for (const bad of [null, 'x', { cmd: 'borrar' }, { cmd: 'seek' }, { cmd: 'seek', position: -3 }, { cmd: 'seek', position: 'a' }]) assert.equal(s.b.handle(bad), false);
});
test('nativo → web (modo app): las órdenes llegan como eventos «remote» de la app de siempre', async () => {
  const s = setup({ commandTarget: 'app' }); s.b.start(); await s.pm.playIndex(0); s.m.made[0].emit(1);
  s.b.handle({ cmd: 'next' }); s.b.handle({ cmd: 'previous' }); s.b.handle({ cmd: 'seek', position: 9 }); s.b.handle({ cmd: 'toggle' });
  assert.deepEqual(s.env.events, [{ type: 'remote', cmd: 'next' }, { type: 'remote', cmd: 'prev' }, { type: 'remote', cmd: 'seek', position: 9 }, { type: 'remote', cmd: 'pause' }]);
  assert.equal(s.m.made[0].calls.filter((c) => c[0] === 'pause').length, 0);                                // la cola es de la app: el reproductor no se toca
});
test('al volver a primer plano reenvía todo; al parar se desengancha', async () => {
  const s = setup(); s.b.start(); await s.pm.playIndex(0);
  const n = s.posted.length; s.env.NSoundNativeBridge.onLifecycle('foreground'); assert.equal(s.posted.at(-1).type, 'nowPlaying'); assert.ok(s.posted.length > n);
  s.b.stop(); assert.equal(s.env.NSoundNativeBridge, undefined); const m = s.posted.length; s.m.made[0].emit(1); assert.equal(s.posted.length, m);
});
test('integrado en bootstrap: solo dentro del contenedor y sin mezclar vídeos normales', async () => {
  globalThis.ENABLE_EXPERIMENTAL_PLAYER = true; NS.instance = null;
  const d = new Map(); globalThis.localStorage = { get length() { return d.size; }, key: (i) => [...d.keys()][i] ?? null, getItem: (k) => (d.has(k) ? d.get(k) : null), setItem: (k, v) => d.set(k, String(v)), removeItem: (k) => d.delete(k) };
  const mk = (tag) => ({ tagName: tag.toUpperCase(), attrs: {}, children: [], nodeType: 1, id: '', setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = v; }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, hasAttribute(k) { return k in this.attrs; }, appendChild(c) { this.children.push(c); return c; }, querySelectorAll() { return []; } });
  const head = mk('head'), body = mk('body'); const all = () => head.children.concat(body.children, body.children.flatMap((c) => c.children));
  globalThis.document = { head, body, hidden: false, readyState: 'complete', documentElement: { classList: { add() {}, remove() {} } }, createElement: mk, getElementById: (id) => all().find((e) => e.id === id) || null,
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  const yt = mockYT(); globalThis.YT = yt.YT;
  const sent = []; globalThis.webkit = { messageHandlers: { nsoundAudio: { postMessage: (x) => sent.push(x) } } };
  const remote = []; globalThis.__nativeEvent = (e) => remote.push(e);
  const rawCalls = []; const raw = { on() {}, init() {}, state: () => ({}), mode: () => null, load: async (it) => { rawCalls.push(it.id); }, play() {}, pause() {}, seek() {}, setVolume() {}, setEq() {}, eqStatus: async () => null };
  const facade = LS.engines.wrap(raw); const out = NS.bootstrap();
  assert.ok(out.controller.bridge.active); assert.equal(typeof globalThis.NSoundNativeBridge.onCommand, 'function');
  await facade.load({ src: 'yt', id: ids[0], kind: 'track', title: 'Canción', sub: 'Quien' }, { audioOnly: true });
  const np = sent.find((x) => x.type === 'nowPlaying'); assert.equal(np.title, 'Canción'); assert.equal(np.artist, 'Quien');
  const before = sent.length;
  await facade.load({ src: 'yt', id: ids[1], kind: 'video' }, { audioOnly: false });                          // vídeo normal: no va al reproductor experimental
  assert.deepEqual(rawCalls, [ids[1]]);
  globalThis.NSoundNativeBridge.onCommand({ cmd: 'next' }); assert.deepEqual(remote, [{ type: 'remote', cmd: 'next' }]);
  assert.ok(Array.isArray(NS.debug().bridge)); void before;
  out.stop(); delete globalThis.webkit; delete globalThis.__nativeEvent;
});

// ---- Comprobaciones estáticas del contenedor nativo (no se puede compilar Swift aquí: lo hace el flujo de macOS) ----
const read = (p) => readFileSync(new URL('../../ios-wrapper/' + p, import.meta.url), 'utf8');
test('ios-wrapper: Info.plist, sesión de audio y WebView con lo pedido', () => {
  const plist = read('NSoundWrapper/Info.plist');
  assert.match(plist, /<key>UIBackgroundModes<\/key>\s*<array>\s*<string>audio<\/string>/);
  assert.match(plist, /UIApplicationSceneManifest/); assert.match(plist, /NSAllowsLocalNetworking/); assert.match(plist, /NSLocalNetworkUsageDescription/);
  assert.match(read('NSoundWrapper/AppDelegate.swift'), /setCategory\(\.playback, mode: \.default, options: \[\]\)/);
  assert.match(read('NSoundWrapper/AppDelegate.swift'), /setActive\(true\)/);
  const vc = read('NSoundWrapper/ViewController.swift');
  assert.match(vc, /allowsInlineMediaPlayback = true/); assert.match(vc, /mediaTypesRequiringUserActionForPlayback = \[\]/);
  assert.match(vc, /handlerName = "nsoundAudio"/);
  const np = read('NSoundWrapper/NowPlayingBridge.swift');
  for (const c of ['playCommand', 'pauseCommand', 'nextTrackCommand', 'previousTrackCommand', 'changePlaybackPositionCommand']) assert.ok(np.includes(c), c);
  assert.match(np, /MPNowPlayingInfoCenter/);
  assert.ok(existsSync(new URL('../../ios-wrapper/project.yml', import.meta.url)));
});
test('ios-wrapper: no guarda audio/vídeo ni toca la web ni el catálogo', () => {
  for (const f of ['AppDelegate', 'SceneDelegate', 'ViewController', 'NowPlayingBridge']) {
    const s = read(`NSoundWrapper/${f}.swift`);
    assert.doesNotMatch(s, /write\(to|FileManager|AVAssetDownload|downloadTask|AVAssetExportSession/, f);
  }
  assert.match(read('NSoundWrapper/NowPlayingBridge.swift'), /"ytimg\.com", "googleusercontent\.com", "ggpht\.com"/);   // la única descarga es la carátula, de hosts de YouTube
});

test('resume (ráfagas del contenedor): solo reanuda si debía sonar y no la pausó el usuario', async () => {
  const s = setup(); s.b.start(); await s.pm.playIndex(0); const p = s.m.made[0]; p.t = 33; p.emit(2);          // iOS pausó el iframe
  const loads = () => p.calls.filter((c) => c[0] === 'load').length;
  assert.equal(s.b.handle({ cmd: 'resume' }), true); await new Promise((r) => setImmediate(r)); assert.equal(loads(), 2); assert.deepEqual(p.calls.at(-1), ['load', ids[0]]);
  p.emit(1); s.b.handle({ cmd: 'resume' }); await new Promise((r) => setImmediate(r)); assert.equal(loads(), 2);                                              // ya suena: nada
  s.pm.pause(); p.emit(2); s.b.handle({ cmd: 'resume' }); await new Promise((r) => setImmediate(r)); assert.equal(loads(), 2);                                // pausa del usuario: se respeta
  const a = setup({ commandTarget: 'app' }); a.b.start(); a.b.handle({ cmd: 'resume' });
  assert.deepEqual(a.env.events, [{ type: 'remote', cmd: 'resume' }]);
});
test('ios-wrapper: eq.js se inyecta en todos los marcos (sin él YouTube se pausa al pasar a segundo plano)', () => {
  const vc = read('NSoundWrapper/ViewController.swift');
  assert.match(vc, /forResource: "eq", withExtension: "js"[\s\S]*?forMainFrameOnly: false/);
  assert.match(read('project.yml'), /\.\.\/app\/src\/eq\.js/);
  assert.match(readFileSync(new URL('../src/eq.js', import.meta.url), 'utf8'), /fixed\(Document\.prototype, 'visibilityState', 'visible'\)/);
});
test('el contenedor se entera de si suena algo por el reproductor de siempre (appState)', async () => {
  const s = setup(); let cb; s.env.LS = { engines: { current: { on: (e, f) => { if (e === 'state') cb = f; } } } };
  s.b.start(); assert.equal(typeof cb, 'function'); cb({ playing: true, time: 4 });
  assert.deepEqual(s.posted.at(-1), { type: 'appState', playing: true, position: 4 }); cb({ playing: false, time: 5 });
  assert.equal(s.posted.at(-1).playing, false);
});
test('ios-wrapper: silencio nativo para mantener viva la app en segundo plano', () => {
  const k = read('NSoundWrapper/SilentKeeper.swift'), vc = read('NSoundWrapper/ViewController.swift');
  assert.match(k, /numberOfLoops = -1/); assert.match(k, /Data\(repeating: 128/); assert.doesNotMatch(k, /write\(to|FileManager/);
  assert.match(vc, /keeper\.start\(\)/); assert.match(vc, /keeper\.stop\(\)/); assert.match(vc, /case "appState"/);
});
test('ios-wrapper: ráfagas de reanudación y sin audio de mantenimiento web dentro del contenedor', () => {
  const vc = read('NSoundWrapper/ViewController.swift');
  assert.match(vc, /resumeBursts/); assert.match(vc, /\[0\.1, 0\.25, 0\.4, 0\.6, 0\.9, 1\.3, 2\.0, 3\.0, 5\.0\]/);
  assert.match(readFileSync(new URL('../src/js/04-app.js', import.meta.url), 'utf8'), /window\.NSOUND_WRAPPER \|\| typeof Audio/);
});
