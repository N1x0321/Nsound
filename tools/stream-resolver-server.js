'use strict';
/* EXPERIMENTAL: conector de URLs de audio (AUDIO_STREAM_RESOLVER_URL) para el reproductor de audio puro.
   GET /api/stream?trackId=<id>  → 200 JSON { url, mimeType, duration, title, artist, art, expiresAt }
   GET /api/demo-audio           → WAV silencioso de 8 s con soporte de cabeceras Range (para probar la reproducción y el segundo plano).
   Solo entrega lo que tú declaras en CUSTOM_TRACKS (audio propio o con licencia). Las pistas no declaradas reciben el WAV de demostración.
   Arranque:  node tools/stream-resolver-server.js
   Desde el iPhone en red local:  PUBLIC_BASE_URL=http://TU_IP_LOCAL:3000 node tools/stream-resolver-server.js */

const http = require('node:http');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const ID_RE = /^[A-Za-z0-9_.:-]{1,200}$/;

const CUSTOM_TRACKS = new Map([
  // Ejemplo de pista propia:
  // ['mi-pista-1', {
  //   url: 'https://tu-servidor.com/audio/pista1.mp3',
  //   mimeType: 'audio/mpeg',
  //   duration: 185,
  //   title: 'Título',
  //   artist: 'Artista',
  //   art: 'https://tu-servidor.com/img/portada.jpg',
  // }],
]);

function buildSilentWavBuffer(seconds = 8, sampleRate = 8000) {
  const numChannels = 1;
  const bitsPerSample = 8;
  const numSamples = Math.max(1, Math.floor(seconds * sampleRate));
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  buf.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  buf.fill(128, 44);
  return buf;
}

const DEMO_WAV = buildSilentWavBuffer(8, 8000);

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/** Interpreta «Range: bytes=a-b», «bytes=a-» y «bytes=-n» (últimos n bytes). Devuelve null si no es válido. */
function parseRange(header, total) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end;
  if (m[1] === '') {                                   // sufijo: los últimos n bytes
    const n = Number(m[2]);
    if (!(n > 0)) return null;
    start = Math.max(0, total - n); end = total - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) return null;
  return { start, end };
}

function serveAudioWithRange(req, res, buffer, mimeType) {
  const total = buffer.length;
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
  };

  if (req.headers.range) {
    const r = parseRange(req.headers.range, total);
    if (!r) {
      res.writeHead(416, { ...corsHeaders, 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }
    const chunk = buffer.subarray(r.start, r.end + 1);
    res.writeHead(206, {
      ...corsHeaders,
      'Content-Type': mimeType,
      'Content-Length': chunk.length,
      'Content-Range': `bytes ${r.start}-${r.end}/${total}`,
    });
    res.end(req.method === 'HEAD' ? undefined : chunk);
    return;
  }

  res.writeHead(200, { ...corsHeaders, 'Content-Type': mimeType, 'Content-Length': total });
  res.end(req.method === 'HEAD' ? undefined : buffer);
}

async function resolveTrack(trackId) {
  if (CUSTOM_TRACKS.has(trackId)) {
    const entry = CUSTOM_TRACKS.get(trackId);
    return {
      url: entry.url,
      mimeType: entry.mimeType || 'audio/mpeg',
      duration: entry.duration || 0,
      title: entry.title || trackId,
      artist: entry.artist || '',
      art: entry.art || '',
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    };
  }

  return {
    url: `${PUBLIC_BASE_URL}/api/demo-audio?trackId=${encodeURIComponent(trackId)}`,
    mimeType: 'audio/wav',
    duration: 8,
    title: `Pista ${trackId}`,
    artist: 'NSound Stream',
    art: '',
    expiresAt: Math.floor(Date.now() / 1000) + 600,
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range',
    });
    res.end();
    return;
  }

  const parsed = new URL(req.url, PUBLIC_BASE_URL);

  if (parsed.pathname === '/api/stream') {
    const trackId = parsed.searchParams.get('trackId') || '';
    if (!ID_RE.test(trackId)) {
      sendJson(res, 400, { error: 'trackId no válido' });
      return;
    }
    try {
      sendJson(res, 200, await resolveTrack(trackId));
    } catch (err) {
      sendJson(res, 502, { error: 'No se pudo resolver la pista', detail: String(err.message || err) });
    }
    return;
  }

  if (parsed.pathname === '/api/demo-audio') {
    serveAudioWithRange(req, res, DEMO_WAV, 'audio/wav');
    return;
  }

  sendJson(res, 404, { error: 'Ruta no encontrada' });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`StreamResolver escuchando en ${PUBLIC_BASE_URL}/api/stream?trackId=...`);
  });
}

module.exports = { server, parseRange, buildSilentWavBuffer };
