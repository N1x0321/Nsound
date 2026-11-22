// Apartado «Mi servidor» (Navidrome/Subsonic): cliente, puente del servidor con un Navidrome falso de verdad y cableado de la interfaz. No toca core.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
// Puente nativo simulado (03-player.js se engancha a LS.Native al cargarse)
const nativeListeners = [], nativeCalls = [];
globalThis.LS = globalThis.LS || {};
globalThis.LS.Native = { platform: 'web', call: async (name, payload) => { nativeCalls.push([name, payload]); return 'ok'; }, onEvent: (f) => nativeListeners.push(f) };
{   // 03-player.js toca window/document al cargarse; se simulan y su intervalo no debe mantener vivo el proceso
  const si = globalThis.setInterval; globalThis.setInterval = (f, ms) => { const t = si(f, ms); if (t && t.unref) t.unref(); return t; };
  globalThis.window = globalThis.window || { addEventListener() {} }; globalThis.location = globalThis.location || { origin: 'null' };
  require('../src/js/03-player.js'); globalThis.setInterval = si;
}
require('../src/js/03-subsonic.js');
const LS = globalThis.LS, SS = LS.Subsonic;
const root = new URL('../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8').replace(/\r\n/g, '\n');
const jsonRes = (obj, status) => ({ ok: (status || 200) < 400, status: status || 200, json: async () => obj });
const okBody = (extra) => ({ 'subsonic-response': Object.assign({ status: 'ok', version: '1.16.1' }, extra) });

// ---------- MD5 y token ----------
test('md5: vectores oficiales (RFC 1321), texto con acentos y comparación con node:crypto en muchas longitudes', () => {
  const vec = { '': 'd41d8cd98f00b204e9800998ecf8427e', a: '0cc175b9c0f1b6a831c399e269772661', abc: '900150983cd24fb0d6963f7d28e17f72',
    'message digest': 'f96b697d7cb7938d525a2f31aaf161d0', 'abcdefghijklmnopqrstuvwxyz': 'c3fcd3d76192e4007dfb496cca67e13b',
    '12345678901234567890123456789012345678901234567890123456789012345678901234567890': '57edf4a22be3c955ac49da2e2107b67a' };
  for (const [k, v] of Object.entries(vec)) assert.equal(SS.md5(k), v, JSON.stringify(k));
  for (const s of ['ñandú', 'contraseña con ✓ y 日本語', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64)]) assert.equal(SS.md5(s), createHash('md5').update(s, 'utf8').digest('hex'), s);
  for (let n = 0; n < 200; n++) { const s = String.fromCharCode(...Array.from({ length: n }, (_, i) => 32 + ((i * 7 + n) % 90))); assert.equal(SS.md5(s), createHash('md5').update(s, 'utf8').digest('hex')); }
});
test('token Subsonic: ejemplo de la documentación (sesame + c19b2d) y sal aleatoria distinta cada vez; la contraseña no aparece', () => {
  assert.deepEqual(SS.makeAuth('joe', 'sesame', 'c19b2d'), { u: 'joe', s: 'c19b2d', t: '26719a1196d2a940705a59634eb18eab' });
  const a = SS.makeAuth('joe', 'sesame'), b = SS.makeAuth('joe', 'sesame');
  assert.notEqual(a.s, b.s); assert.match(a.s, /^[0-9a-f]{16}$/); assert.equal(a.t, createHash('md5').update('sesame' + a.s).digest('hex'));
  assert.ok(!JSON.stringify(a).includes('sesame'));
});

// ---------- cliente ----------
const auth = { u: 'ana', t: 'tok', s: 'sal' };
test('URLs: parámetros del protocolo, firma solo en stream y carátulas, endpoints cerrados', () => {
  const c = new SS.SubsonicClient({ auth, sig: 'FIRMA', base: '/__nd/' });
  const u = new URL(c.url('search3', { query: 'ñandú & co', songCount: 5, vacio: '', nulo: null }), 'http://x');
  assert.equal(u.pathname, '/__nd/rest/search3'); assert.equal(u.searchParams.get('query'), 'ñandú & co');
  for (const [k, v] of Object.entries({ u: 'ana', t: 'tok', s: 'sal', v: '1.16.1', c: 'nsound', f: 'json', songCount: '5' })) assert.equal(u.searchParams.get(k), v, k);
  assert.equal(u.searchParams.has('vacio'), false); assert.equal(u.searchParams.has('nulo'), false); assert.equal(u.searchParams.has('lk'), false, 'las llamadas JSON no llevan firma');
  assert.equal(new URL(c.streamUrl('42'), 'http://x').searchParams.get('lk'), 'FIRMA'); assert.equal(new URL(c.coverUrl('al-1', 200), 'http://x').searchParams.get('lk'), 'FIRMA');
  assert.equal(new URL(c.coverUrl('al-1'), 'http://x').searchParams.get('size'), '300'); assert.equal(c.coverUrl(''), '');
  assert.throws(() => c.url('deleteUser'), (e) => e.code === 'bad-endpoint'); assert.throws(() => c.url('../x'), (e) => e.code === 'bad-endpoint');
  assert.throws(() => new SS.SubsonicClient({ auth: { u: 'a' } })); assert.throws(() => new SS.SubsonicClient({}));
  assert.equal(new SS.SubsonicClient({ auth }).base, '/__nd');
});
test('stream: audio original (con Range) salvo formatos que iOS no reproduce, que se piden en MP3', () => {
  const c = new SS.SubsonicClient({ auth });
  for (const sfx of ['mp3', 'flac', 'm4a', 'aac', 'wav', '']) { const u = new URL(c.streamUrl('7', sfx), 'http://x'); assert.equal(u.searchParams.has('format'), false, sfx); }
  for (const sfx of ['ogg', 'opus', 'OPUS', 'wma']) { const u = new URL(c.streamUrl('7', sfx), 'http://x'); assert.equal(u.searchParams.get('format'), 'mp3', sfx); assert.equal(u.searchParams.get('maxBitRate'), '320'); }
});
test('llamadas: respuestas correctas, errores del protocolo (40 = contraseña), HTTP 404 = sin ND_URL, red y JSON roto', async () => {
  const seen = [];
  const mk = (fn) => new SS.SubsonicClient({ auth, fetch: async (u, o) => { seen.push([u, o]); return fn(u); } });
  assert.equal(await mk(() => jsonRes(okBody({}))).ping(), true); assert.equal(seen[0][1].credentials, 'same-origin'); assert.equal(seen[0][1].cache, 'no-store');
  await assert.rejects(mk(() => jsonRes({ 'subsonic-response': { status: 'failed', error: { code: 40, message: 'Wrong username or password' } } })).ping(), (e) => e instanceof SS.SubsonicError && e.code === '40' && /Wrong/.test(e.message));
  await assert.rejects(mk(() => jsonRes({}, 404)).ping(), (e) => e.code === 'http-404' && /ND_URL/.test(e.message));
  await assert.rejects(mk(() => jsonRes({}, 500)).ping(), (e) => e.code === 'http-500');
  await assert.rejects(mk(() => { throw new Error('sin red'); }).ping(), (e) => e.code === 'network');
  await assert.rejects(mk(() => ({ ok: true, status: 200, json: async () => { throw new Error('x'); } })).ping(), (e) => e.code === 'bad-json');
  await assert.rejects(mk(() => jsonRes({ nada: 1 })).ping(), (e) => e.code === 'bad-response');
});
test('datos: búsqueda, álbum ordenado por pista, aleatorias, álbumes, artistas y listas; los vídeos y los datos rotos se descartan', async () => {
  const song = (id, extra) => Object.assign({ id, title: 'T' + id, artist: 'A', album: 'Al', duration: 100 + Number(id), coverArt: 'al-1', track: Number(id), suffix: 'mp3' }, extra);
  const answers = {
    search3: okBody({ searchResult3: { song: [song(1), song(2, { isVideo: true }), { sin: 'id' }], album: [{ id: 'a1', name: 'Disco', artist: 'A', year: 1999, songCount: 3 }], artist: [{ id: 'r1', name: 'Ana', albumCount: 2 }] } }),
    getAlbum: okBody({ album: { id: 'a1', name: 'Disco', artist: 'A', song: [song(3), song(1), song(2)] } }),
    getRandomSongs: okBody({ randomSongs: { song: song(9) } }),                                  // un solo elemento llega como objeto, no como lista
    getAlbumList2: okBody({ albumList2: { album: [{ id: 'a1', name: 'Disco' }, { id: 'a2', name: 'Otro' }] } }),
    getArtists: okBody({ artists: { index: [{ name: 'A', artist: [{ id: 'r1', name: 'Ana' }] }, { name: 'B', artist: { id: 'r2', name: 'Beto' } }] } }),
    getArtist: okBody({ artist: { id: 'r1', name: 'Ana', album: [{ id: 'a1', name: 'Disco' }] } }),
    getPlaylists: okBody({ playlists: { playlist: [{ id: 'p1', name: 'Mi lista', songCount: 2 }] } }),
    getPlaylist: okBody({ playlist: { id: 'p1', name: 'Mi lista', entry: [song(4), song(5)] } }),
  };
  const c = new SS.SubsonicClient({ auth, fetch: async (u) => jsonRes(answers[new URL(u, 'http://x').pathname.split('/').pop()]) });
  const r = await c.search('x'); assert.deepEqual(r.songs.map((s) => s.id), ['1']); assert.equal(r.albums[0].year, 1999); assert.equal(r.artists[0].name, 'Ana');
  assert.deepEqual(r.songs[0], { id: '1', title: 'T1', artist: 'A', album: 'Al', duration: 101, coverArt: 'al-1', track: 1, suffix: 'mp3' });
  assert.deepEqual((await c.album('a1')).songs.map((s) => s.id), ['1', '2', '3']);
  assert.deepEqual((await c.randomSongs(5)).map((s) => s.id), ['9']);
  assert.deepEqual((await c.albumList()).map((a) => a.id), ['a1', 'a2']);
  assert.deepEqual((await c.artists()).map((a) => a.name), ['Ana', 'Beto']); assert.equal((await c.artist('r1')).albums.length, 1);
  assert.deepEqual((await c.playlists())[0], { id: 'p1', name: 'Mi lista', songCount: 2 }); assert.equal((await c.playlist('p1')).songs.length, 2);
});
test('sesión: pregunta al puente y guarda solo usuario, token y sal (nunca la contraseña)', async () => {
  assert.deepEqual(await SS.fetchSession('/__nd/', async (u) => { assert.equal(u, '/__nd/session'); return jsonRes({ configured: true, sig: 'abc' }); }), { configured: true, sig: 'abc' });
  assert.deepEqual(await SS.fetchSession('/__nd', async () => jsonRes({}, 404)), { configured: false, sig: '' });
  assert.deepEqual(await SS.fetchSession('/__nd', async () => { throw new Error('x'); }), { configured: false, sig: '' });
  const mem = new Map(), st = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const a = SS.makeAuth('ana', 'mi-clave-secreta'); assert.equal(SS.saveAuth(st, a), true);
  assert.deepEqual([...mem.keys()], ['nsound_experimental_navidrome']); assert.ok(!mem.get(SS.STORE_KEY).includes('mi-clave-secreta'));
  assert.deepEqual(SS.loadSaved(st), a); SS.clearSaved(st); assert.equal(SS.loadSaved(st), null);
  mem.set(SS.STORE_KEY, '{roto'); assert.equal(SS.loadSaved(st), null); assert.equal(SS.loadSaved({ getItem() { throw new Error('x'); } }), null);
  assert.doesNotThrow(() => SS.clearSaved({}));     // el almacenamiento de reserva de la app no tiene removeItem
});

// ---------- el audio propio suena por un <audio> de verdad ----------
test('reproductor: las pistas «nd» suenan por <audio id=audio5>; las demás, por el <video id=html5> de siempre, sin cruzarse', async () => {
  const mkEl = (id) => { const l = {}; return { id, src: '', volume: 1, currentTime: 0, duration: NaN, plays: 0, pauses: 0, addEventListener: (e, f) => (l[e] = l[e] || []).push(f), fire: (e) => (l[e] || []).forEach((f) => f()),
    pause() { this.pauses++; }, play() { this.plays++; return Promise.resolve(); }, removeAttribute(k) { if (k === 'src') this.src = ''; } }; };
  const els = { html5: mkEl('html5'), audio5: mkEl('audio5') };
  globalThis.document = { getElementById: (i) => els[i] || null, querySelector: () => null }; globalThis.YT = undefined;
  const ev = []; LS.Player.on('ended', () => ev.push('ended')); LS.Player.on('state', (s) => ev.push(['state', s.playing])); LS.Player.on('error', (e) => ev.push(['error', e.code]));
  try {
    LS.Player.init();
    await LS.Player.load({ src: 'nd', id: '1', url: 'https://x/a.mp3', duration: 10 }, { audioOnly: false });
    assert.equal(els.audio5.src, 'https://x/a.mp3'); assert.equal(els.audio5.plays, 1); assert.equal(els.html5.src, ''); assert.equal(els.html5.plays, 0);
    els.audio5.fire('play'); els.html5.fire('ended'); assert.deepEqual(ev.filter((e) => e === 'ended'), [], 'el elemento que no suena no puede cerrar la pista');
    els.audio5.fire('ended'); assert.deepEqual(ev.filter((e) => e === 'ended'), ['ended']);
    LS.Player.setVolume(50); assert.equal(els.audio5.volume, 0.5); assert.equal(els.html5.volume, 0.5);
    await LS.Player.load({ src: 'cat', id: 'c1', url: 'https://x/v.mp4' }, {});
    assert.equal(els.html5.src, 'https://x/v.mp4'); assert.equal(els.audio5.src, '', 'la pista anterior se suelta'); assert.ok(els.audio5.pauses >= 1);
    els.audio5.fire('error'); assert.deepEqual(ev.filter((e) => Array.isArray(e) && e[0] === 'error'), [], 'el elemento parado no emite errores');
    els.html5.fire('error'); assert.deepEqual(ev.filter((e) => Array.isArray(e) && e[0] === 'error'), [['error', 'media']]);
    await LS.Player.load({ src: 'nd', id: '2', url: 'https://x/b.mp3' }, {}); assert.equal(els.html5.src, '', 'al volver al audio propio se suelta el vídeo'); assert.equal(els.audio5.src, 'https://x/b.mp3');
  } finally { globalThis.document = { hidden: true, getElementById: () => null, querySelector: () => null }; }   // el intervalo de 03-player.js sigue consultando document
});

// ---------- puente del servidor (servidor real + Navidrome falso) ----------
function fakeNavidrome() {
  const log = [];
  const srv = createServer((req, res) => {
    const url = new URL(req.url, 'http://x'); log.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), range: req.headers.range || '' });
    if (url.pathname === '/rest/ping') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(okBody({}))); return; }
    if (url.pathname === '/rest/stream') {
      const data = Buffer.alloc(1000, 7), m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      if (!m) { res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': 1000, 'Accept-Ranges': 'bytes' }).end(data); return; }
      const a = Number(m[1]), b = m[2] ? Number(m[2]) : 999;
      res.writeHead(206, { 'Content-Type': 'audio/mpeg', 'Content-Length': b - a + 1, 'Content-Range': `bytes ${a}-${b}/1000`, 'Accept-Ranges': 'bytes' }); req.method === 'HEAD' ? res.end() : res.end(data.subarray(a, b + 1)); return;
    }
    if (url.pathname === '/rest/getCoverArt') { res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(Buffer.from([1, 2, 3])); return; }
    res.writeHead(404).end('no');
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, log, url: 'http://127.0.0.1:' + srv.address().port })));
}
function startApp(env) {
  return new Promise((resolve, reject) => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, [new URL('../dev/server.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), String(port)], { env: Object.assign({}, process.env, { LS_HOST: '127.0.0.1', PORT: '', LS_TOKEN: '', ND_URL: '' }, env), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; const t = setTimeout(() => { child.kill(); reject(new Error('el servidor no arrancó: ' + out)); }, 8000);
    child.stdout.on('data', (d) => { out += d; if (/Nsound \(pruebas\)/.test(out)) { clearTimeout(t); resolve({ base: 'http://127.0.0.1:' + port, stop: () => child.kill() }); } });
    child.stderr.on('data', (d) => { out += d; }); child.on('exit', () => clearTimeout(t));
  });
}
const get = (url, opt) => fetch(url, Object.assign({ redirect: 'manual' }, opt));

test('puente: sin ND_URL responde «no configurado» y la sesión lo dice', async () => {
  const app = await startApp({});
  try {
    const s = await (await get(app.base + '/__nd/session')).json(); assert.deepEqual(s, { configured: false, sig: '' });
    const r = await get(app.base + '/__nd/rest/ping?u=a'); assert.equal(r.status, 404); assert.match(await r.text(), /ND_URL/);
  } finally { app.stop(); }
});
test('puente: reenvía solo lo permitido (GET/HEAD y lista cerrada), con Range y sin la firma, hacia el Navidrome configurado', async () => {
  const nd = await fakeNavidrome(), app = await startApp({ ND_URL: nd.url });
  try {
    assert.equal((await (await get(app.base + '/__nd/session')).json()).configured, true);
    const ping = await get(app.base + '/__nd/rest/ping.view?u=ana&t=tok&s=sal&f=json'); assert.equal(ping.status, 200); assert.equal((await ping.json())['subsonic-response'].status, 'ok');
    assert.deepEqual(nd.log.at(-1).query, { u: 'ana', t: 'tok', s: 'sal', f: 'json' }); assert.equal(nd.log.at(-1).path, '/rest/ping');
    const part = await get(app.base + '/__nd/rest/stream?id=1', { headers: { Range: 'bytes=100-199' } });
    assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), 'bytes 100-199/1000'); assert.equal(part.headers.get('accept-ranges'), 'bytes'); assert.equal(part.headers.get('content-type'), 'audio/mpeg');
    assert.equal((await part.arrayBuffer()).byteLength, 100); assert.equal(nd.log.at(-1).range, 'bytes=100-199');
    const whole = await get(app.base + '/__nd/rest/stream?id=1'); assert.equal(whole.status, 200); assert.equal((await whole.arrayBuffer()).byteLength, 1000);
    const head = await get(app.base + '/__nd/rest/stream?id=1', { method: 'HEAD', headers: { Range: 'bytes=0-9' } }); assert.equal(head.status, 206); assert.equal(nd.log.at(-1).method, 'HEAD');
    assert.equal((await get(app.base + '/__nd/rest/getCoverArt?id=al')).headers.get('content-type'), 'image/jpeg');
    for (const bad of ['/__nd/rest/deleteUser', '/__nd/rest/createUser', '/__nd/rest/ping/../x', '/__nd/rest/startScan']) { const n = nd.log.length; assert.equal((await get(app.base + bad)).status, 404, bad); assert.equal(nd.log.length, n, 'no llega al servidor: ' + bad); }
    const n = nd.log.length; assert.equal((await get(app.base + '/__nd/rest/ping', { method: 'POST', body: 'x' })).status, 404); assert.equal(nd.log.length, n);
  } finally { app.stop(); nd.srv.close(); }
});
test('puente con clave de acceso: sin cookie no hay nada; stream y carátulas aceptan solo la firma derivada (no la clave) y el servidor no la reenvía', async () => {
  const TOKEN = 'clave-de-prueba-123', nd = await fakeNavidrome(), app = await startApp({ ND_URL: nd.url, LS_TOKEN: TOKEN });
  const cookie = { Cookie: 'ls=' + TOKEN };
  try {
    assert.equal((await get(app.base + '/__nd/session')).status, 401); assert.equal((await get(app.base + '/__nd/rest/ping')).status, 401);
    const ses = await (await get(app.base + '/__nd/session', { headers: cookie })).json();
    const expected = createHmac('sha256', TOKEN).update('nsound-nd-media').digest('hex').slice(0, 32);
    assert.equal(ses.sig, expected); assert.notEqual(ses.sig, TOKEN); assert.equal(ses.configured, true);
    assert.equal((await get(app.base + '/__nd/rest/ping', { headers: cookie })).status, 200);
    assert.equal((await get(app.base + '/__nd/rest/ping?lk=' + expected)).status, 401, 'la firma no vale para llamadas JSON');
    assert.equal((await get(app.base + '/__nd/rest/getSong?id=1&lk=' + expected)).status, 401);
    const s = await get(app.base + '/__nd/rest/stream?id=1&lk=' + expected, { headers: { Range: 'bytes=0-9' } }); assert.equal(s.status, 206); assert.equal('lk' in nd.log.at(-1).query, false, 'la firma no sale hacia Navidrome');
    assert.equal((await get(app.base + '/__nd/rest/getCoverArt?id=1&lk=' + expected)).status, 200);
    assert.equal((await get(app.base + '/__nd/rest/stream?id=1&lk=otra')).status, 401); assert.equal((await get(app.base + '/__nd/rest/stream?id=1&lk=' + TOKEN)).status, 401, 'la clave en bruto tampoco vale como firma');
    assert.equal((await get(app.base + '/')).status, 401, 'el resto sigue protegido');
  } finally { app.stop(); nd.srv.close(); }
});
test('puente: Navidrome caído → 502 sin tumbar el servidor', async () => {
  const nd = await fakeNavidrome(), url = nd.url; nd.srv.close();
  const app = await startApp({ ND_URL: url });
  try { assert.equal((await get(app.base + '/__nd/rest/ping')).status, 502); assert.equal((await get(app.base + '/__nd/session')).status, 200); } finally { app.stop(); }
});

// ---------- cableado de la interfaz (04-app.js es un único módulo con DOM) ----------
test('interfaz: «Mi servidor» solo existe con LS.enginesEnabled y el audio propio no abre la capa de vídeo', () => {
  const a = read('app/src/js/04-app.js'), t = read('app/src/index.template.html'), p = read('app/src/js/03-player.js');
  assert.match(a, /\.concat\(LS\.enginesEnabled && LS\.Subsonic \? \['navidrome'\] : \[\]\)/);
  assert.match(a, /if \(LS\.enginesEnabled && LS\.Subsonic\) \{\s*const navBtn = document\.createElement\('button'\);/);
  assert.ok(!/data-page="navidrome"/.test(t), 'el botón no está en el HTML compartido: solo se añade con los motores encendidos');
  assert.match(a, /if \(it\.src === 'nd'\) return ndClient \? Object\.assign\(\{\}, it, \{ url: ndClient\.streamUrl\(it\.id, it\.fmt\) \}\) : it;/);
  assert.match(a, /if \(S\.audioOnly \|\| it\.src === 'nd'\) showVideo\(false\)/);
  for (const act of ['ndalbum', 'ndback', 'ndout', 'ndplayall']) assert.match(a, new RegExp(`case '${act}':`));
  assert.match(a, /e\.code === '40' \|\| e\.code === '41'/);
  assert.match(t, /<audio id="audio5" playsinline preload="auto" hidden><\/audio>/); assert.match(p, /useAudio = item\.src === 'nd'/);
  assert.ok(!a.includes('password') || !/setItem\([^)]*pass/i.test(a), 'la contraseña no se guarda');
});

// ---------- reproductor NATIVO (AVQueuePlayer) para el audio propio ----------
test('nativo: con los motores encendidos en iPhone la lista de «nd» se entrega al reproductor nativo y el WebView no reproduce nada', async () => {
  const mkEl = (id) => { const l = {}; return { id, src: '', volume: 1, plays: 0, pauses: 0, addEventListener: (e, f) => (l[e] = l[e] || []).push(f), pause() { this.pauses++; }, play() { this.plays++; return Promise.resolve(); }, removeAttribute(k) { if (k === 'src') this.src = ''; } }; };
  const els = { html5: mkEl('html5'), audio5: mkEl('audio5') };
  globalThis.document = { hidden: true, getElementById: (i) => els[i] || null, querySelector: () => null };
  const ev = []; LS.Player.on('state', (s) => ev.push(['state', s.playing, s.time, s.duration])); LS.Player.on('ended', () => ev.push(['ended'])); LS.Player.on('error', (e) => ev.push(['error', e.code, e.message]));
  const run = { tracks: [{ id: '1', url: 'https://app.test/__nd/rest/stream?id=1&lk=F' }, { id: '2', url: 'https://app.test/__nd/rest/stream?id=2&lk=F' }], index: 0, repeat: 'all' };
  const fire = (e) => nativeListeners.forEach((f) => f(e));
  LS.enginesEnabled = true; LS.Native.platform = 'ios'; nativeCalls.length = 0;
  try {
    LS.Player.init();
    await LS.Player.load({ src: 'nd', id: '1', url: run.tracks[0].url, duration: 10 }, { audioOnly: false, native: run });
    assert.equal(LS.Player.mode(), 'native');
    assert.deepEqual(nativeCalls.at(-1), ['nativeLoad', { tracks: run.tracks, index: 0, repeat: 'all', position: 0, autoplay: true }]);
    assert.equal(els.audio5.plays + els.html5.plays, 0, 'el WebView no reproduce');
    LS.Player.play(); LS.Player.pause(); LS.Player.seek(30);
    assert.deepEqual(nativeCalls.slice(-3), [['nativePlay', {}], ['nativePause', {}], ['nativeSeek', { position: 30 }]]);
    fire({ type: 'nativeState', playing: true, time: 5, duration: 200 });
    assert.deepEqual(ev.filter((e) => e[0] === 'state').at(-1), ['state', true, 5, 200]); assert.equal(LS.Player.state().duration, 200);
    fire({ type: 'nativeTrack', index: 1 }); assert.deepEqual(ev.filter((e) => e[0] === 'state').at(-1), ['state', true, 0, 200]);
    fire({ type: 'nativeError', message: 'sin red' }); assert.deepEqual(ev.at(-1), ['error', 'media', 'sin red']);
    fire({ type: 'nativeEnded' }); assert.deepEqual(ev.at(-1), ['ended']);
    // pasar a otra cosa calla al nativo; y los eventos nativos que lleguen después se ignoran
    nativeCalls.length = 0; await LS.Player.load({ src: 'cat', id: 'c', url: 'https://x/v.mp4' }, {});
    assert.deepEqual(nativeCalls, [['nativeStop', {}]]); assert.equal(els.html5.src, 'https://x/v.mp4');
    const n = ev.length; fire({ type: 'nativeEnded' }); fire({ type: 'nativeState', playing: true, time: 1, duration: 1 }); assert.equal(ev.length, n);
    // sin lista nativa (o sin ser iPhone, o con los motores apagados) el audio propio suena por el <audio> del WebView, como antes
    nativeCalls.length = 0; await LS.Player.load({ src: 'nd', id: '3', url: 'https://x/c.mp3' }, {}); assert.equal(els.audio5.src, 'https://x/c.mp3'); assert.deepEqual(nativeCalls, []);
    LS.Native.platform = 'web'; await LS.Player.load({ src: 'nd', id: '4', url: 'https://x/d.mp3' }, { native: run }); assert.equal(els.audio5.src, 'https://x/d.mp3'); assert.equal(nativeCalls.length, 0);
    LS.Native.platform = 'ios'; LS.enginesEnabled = false; await LS.Player.load({ src: 'nd', id: '5', url: 'https://x/e.mp3' }, { native: run }); assert.equal(els.audio5.src, 'https://x/e.mp3'); assert.equal(nativeCalls.length, 0);
  } finally { LS.enginesEnabled = false; LS.Native.platform = 'web'; }
});
test('nativo (Swift): AVQueuePlayer + AVAudioSession(.playback) + MPRemoteCommandCenter + MPNowPlayingInfoCenter + audio en segundo plano, sin guardar audio en disco', () => {
  const n = read('ios/LibreStream/Services/Playback/NativeStreamPlayer.swift'), w = read('ios/LibreStream/Shell/WebShell.swift'), y = read('ios/project.yml');
  for (const k of ['AVQueuePlayer()', 'setCategory(.playback, mode: .default)', 'setActive(true)', 'MPRemoteCommandCenter.shared()', 'MPNowPlayingInfoCenter.default().nowPlayingInfo',
    'playCommand', 'pauseCommand', 'togglePlayPauseCommand', 'nextTrackCommand', 'previousTrackCommand', 'changePlaybackPositionCommand', 'AVAudioSession.interruptionNotification', 'oldDeviceUnavailable',
    'MPNowPlayingInfoPropertyElapsedPlaybackTime', 'MPMediaItemPropertyArtwork', 'AVPlayerItemDidPlayToEndTime']) assert.ok(n.includes(k), k);
  assert.match(y, /UIBackgroundModes: \[audio\]/);
  assert.doesNotMatch(n, /\.download|AVAssetDownload|AVAssetExportSession/, 'no guarda audio en disco');
  assert.equal((n.match(/FileManager/g) || []).length, 1, 'el único acceso a disco es el registro de tiempos'); assert.match(n, /FileManager\.default\.urls\(for: \.documentDirectory, in: \.userDomainMask\)\.first\?\.appendingPathComponent\("nativo-tiempos\.log"\)/);
  for (const c of ['nativeLoad', 'nativePlay', 'nativePause', 'nativeSeek', 'nativeRepeat', 'nativeStop']) assert.ok(w.includes(`case "${c}":`), c);
  assert.match(w, /url\.host == host/); assert.match(w, /url\.path\.hasPrefix\("\/__nd\/rest\/stream"\)/); assert.match(w, /u\.path\.hasPrefix\("\/__nd\/rest\/getCoverArt"\)/);
  assert.equal((w.match(/if nativePlayer\.isActive \{ replyHandler\("ok", nil\); return \}/g) || []).length, 3, 'mientras suena el nativo, la pantalla de bloqueo no la pisa la interfaz');
  assert.match(w, /nativePlayer\.onEvent = \{ \[weak self\] event in self\?\.sendEvent\(event\) \}/);
  assert.match(n, /\["type": "nativeTrack", "index": index\]/); assert.match(n, /\["type": "nativeEnded"\]/); assert.match(n, /\["type": "remote", "cmd": "pause"\]/);
});
test('nativo (interfaz): solo con motores en iPhone, sin barajar, con la cola de tu servidor; los cambios de pista del nativo ponen al día la pantalla', () => {
  const a = read('app/src/js/04-app.js');
  assert.match(a, /if \(LS\.enginesEnabled && it\.src === 'nd' && Native\.platform === 'ios' && !S\.shuffle\) \{ const run = nativeRun\(\);/);
  assert.match(a, /function nativeRun\(\) \{\s*if \(!ndClient \|\| !S\.queue\.length\) return null;/);
  assert.match(a, /Native\.onEvent\(\(e\) => \{ if \(e && e\.type === 'nativeTrack' && typeof e\.index === 'number'\) adoptIndex\(\(S\.nativeBase \|\| 0\) \+ e\.index\); \}\);/);
  assert.match(a, /Native\.call\('nativeRepeat'/);
});
