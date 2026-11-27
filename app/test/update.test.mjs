import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../src/js/00-update.js');
const LS = globalThis.LS;

// Mismo orden y mismos casos que windows/LibreStream.Core.Tests/Updates/UpdateTests.cs
const ORDERED = ['0.7.9', '0.8.0-alpha', '0.8.0-beta.2', '0.8.0-beta.9', '0.8.0-beta.10', '0.8.0-beta.11', '0.8.0-rc.1',
  '0.8.0', '0.8.1-beta.1', '0.8.10', '0.9.0-beta.1', '0.10.0', '1.0.0'];

test('orden de las versiones: beta.9 < beta.10 < final', () => {
  ORDERED.forEach((a, i) => ORDERED.forEach((b, j) =>
    assert.equal(LS.compareVersions(LS.parseVersion(a), LS.parseVersion(b)), Math.sign(i - j), `${a} frente a ${b}`)));
});

test('lectura de versiones', () => {
  assert.equal(LS.parseVersion('v0.8.0-beta.11').text, '0.8.0-beta.11');
  assert.equal(LS.parseVersion('0.8.0-beta.11+eb2bc0d').text, '0.8.0-beta.11');
  assert.equal(LS.parseVersion('0.0.0-dev+abc1234').dev, true);
  for (const bad of [null, undefined, '', 'dev-eb2bc0d', '0.8', '0.8.0.11', '0.8.0-', '0.8.0-beta.11/../x', '__NSOUND_VERSION__'])
    assert.equal(LS.parseVersion(bad), null, String(bad));
});

const release = (tag, extra = {}, suffix = '-android.apk', state = 'uploaded') => Object.assign(
  { tag_name: tag, draft: false, html_url: 'https://example.test/otra', assets: [{ name: `Nsound-${tag.slice(1)}${suffix}`, state }] }, extra);

test('elige la Release más alta que ya tiene el fichero de la plataforma', () => {
  const list = [release('v0.8.0-beta.12'), release('v0.8.0-beta.13'), release('v0.8.0-beta.9'), release('v0.9.0', { draft: true }),
    release('v0.8.0-beta.15', {}, '-unsigned.ipa'), release('v0.8.0-beta.16', {}, '-android.apk', 'open'), release('experimento'), null, { tag_name: 5 }];
  assert.equal(LS.latestRelease(list, 'android'), 'v0.8.0-beta.13');
  assert.equal(LS.latestRelease(list, 'ios'), 'v0.8.0-beta.15');
  assert.equal(LS.latestRelease(list, 'web'), 'v0.8.0-beta.16');
  assert.equal(LS.latestRelease([], 'android'), null);
  assert.throws(() => LS.latestRelease({ message: 'API rate limit exceeded' }, 'android'));
});

function setup(installed = '0.8.0-beta.11') {
  const data = {};
  const env = {
    requests: 0, time: Date.UTC(2026, 10, 28, 10), releases: [release('v0.8.0-beta.12')], online: true, data,
    storage: { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } },
  };
  env.checker = (version = installed) => LS.createUpdateChecker({
    storage: env.storage, installed: version, platform: 'android', now: () => env.time, online: () => env.online,
    fetchJson: async (url) => { env.requests++; assert.equal(url, LS.RELEASES_API); if (env.releases instanceof Error) throw env.releases; return env.releases; },
  });
  return env;
}
const HOUR = 3600 * 1000;

test('avisa de una versión más nueva con la página de su Release', async () => {
  const env = setup();
  assert.deepEqual(await env.checker().check(), { version: '0.8.0-beta.12', url: 'https://github.com/N1x0321/Nsound/releases/tag/v0.8.0-beta.12' });
});

test('al día o por delante: no dice nada', async () => {
  for (const tag of ['v0.8.0-beta.11', 'v0.8.0-beta.10']) {
    const env = setup();
    env.releases = [release(tag)];
    assert.equal(await env.checker().check(), null, tag);
  }
});

test('las compilaciones de desarrollo no consultan', async () => {
  for (const installed of ['0.0.0-dev', '', '__NSOUND_VERSION__']) {
    const env = setup();
    assert.equal(await env.checker(installed).check(), null);
    assert.equal(env.requests, 0);
  }
});

test('consulta como máximo una vez al día y recuerda la respuesta', async () => {
  const env = setup();
  await env.checker().check();
  env.time += 23 * HOUR;
  const restarted = env.checker();
  assert.equal(restarted.current().version, '0.8.0-beta.12');
  await restarted.check();
  assert.equal(env.requests, 1);
  env.time += 2 * HOUR;
  env.releases = [release('v0.8.0-beta.13')];
  assert.equal((await restarted.check()).version, '0.8.0-beta.13');
  assert.equal(env.requests, 2);
});

test('dos comprobaciones a la vez hacen una sola consulta', async () => {
  const env = setup();
  const checker = env.checker();
  const [a, b] = await Promise.all([checker.check(), checker.check()]);
  assert.equal(env.requests, 1);
  assert.equal(a.version, '0.8.0-beta.12');
  assert.equal(b.version, '0.8.0-beta.12');
});

test('después de actualizar, el aviso desaparece', async () => {
  const env = setup();
  await env.checker().check();
  assert.equal(env.checker('0.8.0-beta.12').current(), null);
});

test('los errores de red no se ven y cuentan como el intento del día', async () => {
  const env = setup();
  env.releases = new Error('sin red');
  assert.equal(await env.checker().check(), null);
  env.releases = [release('v0.8.0-beta.12')];
  assert.equal(await env.checker().check(), null);
  assert.equal(env.requests, 1);
  env.time += 24 * HOUR;
  assert.equal((await env.checker().check()).version, '0.8.0-beta.12');
  env.time += 24 * HOUR;
  env.releases = { message: 'API rate limit exceeded' };
  assert.equal((await env.checker().check()).version, '0.8.0-beta.12');   // conserva lo último que supo
});

test('sin conexión no gasta el intento del día', async () => {
  const env = setup();
  env.online = false;
  assert.equal(await env.checker().check(), null);
  env.online = true;
  assert.equal((await env.checker().check()).version, '0.8.0-beta.12');
});

test('una versión descartada no vuelve; la siguiente sí', async () => {
  const env = setup();
  const checker = env.checker();
  checker.dismiss((await checker.check()).version);
  assert.equal(checker.current(), null);
  assert.equal(env.checker().current(), null);
  env.time += 24 * HOUR;
  env.releases = [release('v0.8.0-beta.13'), release('v0.8.0-beta.12')];
  assert.equal((await env.checker().check()).version, '0.8.0-beta.13');
});

test('ni un estado roto ni un reloj atrasado bloquean la comprobación', async () => {
  const env = setup();
  env.data['ls.update'] = '{roto';
  assert.ok(await env.checker().check());
  env.time -= 30 * 24 * HOUR;
  await env.checker().check();
  assert.equal(env.requests, 2);
});
