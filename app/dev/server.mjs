// Servidor de pruebas: sirve dist/ y hace de puente para leer YouTube/LRCLIB y otros servicios (en un navegador no hay CORS).
// Uso local:  node app/build.mjs && node app/dev/server.mjs [puerto]
// En la nube (Render, ver render.yaml): usa PORT, escucha en 0.0.0.0 y exige la clave LS_TOKEN (la primera vez: /?k=CLAVE).
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT) || Number(process.argv[2]) || 5173;
const host = process.env.LS_HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const TOKEN = process.env.LS_TOKEN || '';                     // vacío = sin clave (solo en local)
const ALLOWED = ['www.youtube.com', 'lrclib.net', 'n1x0321.github.io', 'open.spotify.com', 'api.deezer.com', 'music.apple.com', 'soundcloud.com'];
const POST_ALLOWED = ['music.youtube.com'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.html': 'text/html; charset=utf-8' };
const MAX_BODY = 200 * 1024;

// Navidrome / Subsonic (opcional, tu propio servidor de música). Navidrome no envía cabeceras CORS: el navegador no puede llamarlo directamente,
// así que este servidor lo reenvía en /__nd/rest/<endpoint> (solo una lista cerrada de endpoints, solo GET/HEAD, con Range para el audio).
// ND_URL = dirección del servidor, p. ej. http://127.0.0.1:4533 o https://musica.tudominio.com. Sin ND_URL el puente responde «no configurado».
const ND_URL = (process.env.ND_URL || '').replace(/\/+$/, '');
if (ND_URL && !/^https?:\/\//.test(ND_URL)) throw new Error('ND_URL debe empezar por http:// o https://');
const ND_ENDPOINTS = ['ping', 'search3', 'getAlbumList2', 'getAlbum', 'getArtists', 'getArtist', 'getRandomSongs', 'getPlaylists', 'getPlaylist', 'getSong', 'stream', 'getCoverArt'];
const ND_MEDIA = ['stream', 'getCoverArt'];   // los pide la etiqueta <audio> / <img>, que en iOS puede no llevar la cookie: se autorizan con una firma derivada de LS_TOKEN
const ND_SIG = TOKEN ? createHmac('sha256', TOKEN).update('nsound-nd-media').digest('hex').slice(0, 32) : '';
const ND_PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag', 'cache-control'];

const cookieKey = (req) => /(?:^|;\s*)ls=([^;]+)/.exec(req.headers.cookie || '')?.[1];

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok'); return; }

  const nd = /^\/__nd\/rest\/([A-Za-z0-9]+?)(?:\.view)?$/.exec(url.pathname);
  const ndMediaOk = !!(nd && ND_SIG && ND_MEDIA.includes(nd[1]) && url.searchParams.get('lk') === ND_SIG);

  // Clave de acceso: en la nube nadie usa el puente sin ella
  if (TOKEN && !ndMediaOk) {
    if (url.searchParams.get('k') === TOKEN) {
      res.writeHead(302, { 'Set-Cookie': `ls=${TOKEN}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`, Location: '/' }).end();
      return;
    }
    if (cookieKey(req) !== TOKEN) { res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Acceso privado. Abre el enlace con la clave: /?k=CLAVE'); return; }
  }

  if (url.pathname === '/__nd/session') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ configured: !!ND_URL, sig: ND_SIG }));
    return;
  }
  if (nd) {
    if (!ND_URL) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Navidrome no configurado (falta ND_URL)'); return; }
    if (!ND_ENDPOINTS.includes(nd[1]) || (req.method !== 'GET' && req.method !== 'HEAD')) { res.writeHead(404).end('no permitido'); return; }
    const ctl = new AbortController();
    res.on('close', () => ctl.abort());
    try {
      const q = new URLSearchParams(url.searchParams); q.delete('lk');
      const headers = { 'User-Agent': UA };
      for (const h of ['range', 'if-range', 'accept']) if (req.headers[h]) headers[h] = req.headers[h];
      const r = await fetch(ND_URL + '/rest/' + nd[1] + '?' + q.toString(), { method: req.method, headers, redirect: 'manual', signal: ctl.signal });
      const out = {}; for (const h of ND_PASS) { const v = r.headers.get(h); if (v) out[h] = v; }
      res.writeHead(r.status, out);
      if (req.method === 'HEAD' || !r.body) { res.end(); return; }
      Readable.fromWeb(r.body).on('error', () => res.destroy()).pipe(res);
    } catch (e) { if (!res.headersSent) res.writeHead(502).end('Navidrome no responde'); else res.destroy(); }
    return;
  }
  if (url.pathname === '/__proxy') {
    try {
      const target = new URL(url.searchParams.get('url') || '');
      if (target.protocol !== 'https:' || !ALLOWED.includes(target.hostname)) { res.writeHead(403).end('host no permitido'); return; }
      const r = await fetch(target, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9' } });
      const t = await r.text(); res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'text/plain' }).end(t);
    } catch (e) { if (!res.headersSent) res.writeHead(502).end(String(e)); else res.destroy(); }
    return;
  }
  if (url.pathname === '/__post' && req.method === 'POST') {
    try {
      const target = new URL(url.searchParams.get('url') || '');
      if (target.protocol !== 'https:' || !POST_ALLOWED.includes(target.hostname)) { res.writeHead(403).end('host no permitido'); return; }
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > MAX_BODY) { res.writeHead(413).end('demasiado grande'); return; } }
      const r = await fetch(target, { method: 'POST', body, headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Origin: 'https://music.youtube.com', Referer: 'https://music.youtube.com/', 'Accept-Language': 'es-ES,es;q=0.9' } });
      const t = await r.text(); res.writeHead(r.status, { 'Content-Type': 'application/json' }).end(t);
    } catch (e) { if (!res.headersSent) res.writeHead(502).end(String(e)); else res.destroy(); }
    return;
  }
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/\.\./g, '');
  const file = join(dist, rel);
  if (!existsSync(file)) { res.writeHead(404).end('no encontrado'); return; }
  const ext = rel.slice(rel.lastIndexOf('.'));
  res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' }).end(readFileSync(file));
}).listen(port, host, () => console.log(`Nsound (pruebas) en http://${host}:${port}${TOKEN ? ' (con clave)' : ''}`));

process.on('uncaughtException', (e) => console.error('Error no controlado (el servidor sigue):', e));
process.on('unhandledRejection', (e) => console.error('Promesa rechazada (el servidor sigue):', e));
