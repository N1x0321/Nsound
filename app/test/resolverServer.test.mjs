// Servidor de ejemplo del conector (tools/stream-resolver-server.js) probado de verdad por HTTP y con el StreamResolver del reproductor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:38457';   // el servidor construye sus URLs a partir de esto
const { server, parseRange } = require('../../tools/stream-resolver-server.js');
require('../src/experimental/audioPlayerManager.js');
const NS = globalThis.NSoundExperimental;

let base;
test.before(async () => { await new Promise((r) => server.listen(38457, '127.0.0.1', r)); base = 'http://127.0.0.1:38457'; });
test.after(() => new Promise((r) => server.close(r)));

test('parseRange: normal, abierto, sufijo e inválidos', () => {
  assert.deepEqual(parseRange('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 }, 'sufijo = últimos 10 bytes');
  assert.deepEqual(parseRange('bytes=50-500', 100), { start: 50, end: 99 });
  for (const bad of ['bytes=-', 'bytes=100-', 'bytes=9-3', 'items=0-1', 'bytes=-0']) assert.equal(parseRange(bad, 100), null, bad);
});

test('/api/stream devuelve JSON válido y rechaza ids malos', async () => {
  const ok = await fetch(base + '/api/stream?trackId=abc-1'); const j = await ok.json();
  assert.equal(ok.status, 200); assert.equal(j.mimeType, 'audio/wav'); assert.ok(j.url.includes('/api/demo-audio'));
  assert.equal((await fetch(base + '/api/stream?trackId=' + encodeURIComponent('a b'))).status, 400);
  assert.equal((await fetch(base + '/api/stream')).status, 400);
  assert.equal((await fetch(base + '/otra')).status, 404);
});

test('/api/demo-audio: 200 completo, 206 con Range, 416 fuera de rango', async () => {
  const full = await fetch(base + '/api/demo-audio'); const buf = Buffer.from(await full.arrayBuffer());
  assert.equal(full.status, 200); assert.equal(full.headers.get('accept-ranges'), 'bytes'); assert.equal(buf.length, 44 + 64000); assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  const part = await fetch(base + '/api/demo-audio', { headers: { Range: 'bytes=0-99' } });
  assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), 'bytes 0-99/' + buf.length); assert.equal((await part.arrayBuffer()).byteLength, 100);
  const tail = await fetch(base + '/api/demo-audio', { headers: { Range: 'bytes=-10' } });
  assert.equal(tail.status, 206); assert.equal((await tail.arrayBuffer()).byteLength, 10);
  assert.equal((await fetch(base + '/api/demo-audio', { headers: { Range: 'bytes=999999-' } })).status, 416);
});

test('el StreamResolver del reproductor acepta la respuesta del servidor (URL local http permitida)', async () => {
  const r = new NS.StreamResolver({ url: base + '/api/stream' });
  const info = await r.resolve('pista1');
  assert.equal(info.duration, 8); assert.ok(NS.isAllowedAudioUrl(info.url));
  const head = await fetch(info.url, { headers: { Range: 'bytes=0-43' } });
  assert.equal(head.status, 206);
});
