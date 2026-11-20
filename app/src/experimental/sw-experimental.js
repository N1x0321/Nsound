/* EXPERIMENTAL: service worker con Stale While Revalidate para la interfaz (html, css, js, iconos, imágenes, manifest, fuentes).
   Nunca toca YouTube: youtube.com, music.youtube.com, youtu.be, ytimg.com y googlevideo.com (y subdominios) pasan directos a la red.
   La versión sale de ?v=… en la URL de registro: al cambiar, nace un worker nuevo que borra las cachés antiguas. */
(function (root) {
  'use strict';
  const PREFIX = 'nsound-exp-';
  const EXCLUDED = ['youtube.com', 'music.youtube.com', 'youtu.be', 'ytimg.com', 'googlevideo.com'];

  function isExcluded(hostname) {
    const h = String(hostname || '').toLowerCase();
    return EXCLUDED.some((d) => h === d || h.endsWith('.' + d));
  }

  /** ¿Debe gestionarlo este worker? (GET http/s, no excluido, no la comprobación de versión, no el puente /__ de desarrollo, sin Range) */
  function shouldHandle(req, ownOrigin) {
    if (req.method !== 'GET') return false;
    let u; try { u = new URL(req.url); } catch (e) { return false; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (isExcluded(u.hostname)) return false;
    if (/\/version\.json$/.test(u.pathname)) return false;      // siempre de la red: es lo que detecta las versiones nuevas
    if (u.origin === ownOrigin) return !u.pathname.startsWith('/__');
    return ['style', 'font', 'image', 'script'].includes(req.destination) || /\.(woff2?|ttf|otf|css)$/i.test(u.pathname);   // fuentes/estilos de terceros
  }

  function createWorker(env) {
    const cacheName = PREFIX + env.version;

    async function onActivate() {
      const keys = await env.caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== cacheName).map((k) => env.caches.delete(k)));
      if (env.claim) await env.claim();
    }

    async function staleWhileRevalidate(req) {
      const cache = await env.caches.open(cacheName);
      const cached = await cache.match(req, { ignoreVary: true });
      const update = env.fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
        return res;
      });
      if (cached) { update.catch(() => {}); return cached; }   // se sirve lo guardado y se actualiza detrás
      try { return await update; }
      catch (e) {
        if (req.mode === 'navigate') { const home = await cache.match('./'); if (home) return home; }
        throw e;
      }
    }

    return { cacheName, onActivate, staleWhileRevalidate, shouldHandle: (req) => shouldHandle(req, env.origin) };
  }

  const api = { PREFIX, EXCLUDED, isExcluded, shouldHandle, createWorker };

  if (typeof ServiceWorkerGlobalScope !== 'undefined' && root instanceof ServiceWorkerGlobalScope) {
    let version = '0';
    try { version = new URL(root.location.href).searchParams.get('v') || '0'; } catch (e) { /* sin versión */ }
    const w = createWorker({ version, caches: root.caches, fetch: (r) => root.fetch(r), origin: root.location.origin, claim: () => root.clients.claim() });
    root.addEventListener('install', (e) => { root.skipWaiting(); });
    root.addEventListener('activate', (e) => e.waitUntil(w.onActivate()));
    root.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') root.skipWaiting(); });
    root.addEventListener('fetch', (e) => { if (w.shouldHandle(e.request)) e.respondWith(w.staleWhileRevalidate(e.request)); });
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
