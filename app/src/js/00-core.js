/* Núcleo compartido (iOS, Android y navegador). Sin dependencias del DOM: se prueba con Node.
   Es un puerto de LibreStream.Core (C#): mismas reglas de filtro, mismas letras sincronizadas. */
var LS = globalThis.LS = globalThis.LS || {};
(function (LS) {
  'use strict';

  // ---------- Datos fijos ----------
  LS.GENRES = ['Éxitos', 'Reggaetón', 'Pop', 'Rock', 'Electrónica', 'Hip hop', 'Latino', 'Lo-fi'];
  LS.EQ_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
  LS.EQ_PRESETS = {
    'Plano': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    'Graves': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
    'Agudos': [0, 0, 0, 0, 0, 1, 3, 5, 6, 7],
    'Voz': [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1],
    'Rock': [5, 4, 2, -1, -2, -1, 2, 4, 5, 6],
    'Pop': [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2],
    'Hip hop': [6, 5, 2, 3, -1, -1, 2, 0, 2, 3],
    'Electrónica': [6, 5, 2, 0, -2, 2, 1, 2, 5, 6],
    'Clásica': [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
  };
  LS.EQ_CUSTOM = 'Personalizado';
  // Estilos de la interfaz: [id, nombre, fondo, acento]
  LS.LOOKS = [
    ['nsound', 'Nsound', '#0b0c10', '#ff4d62'], ['neon', 'Neón', '#07060d', '#ff2bd6'],
    ['oceano', 'Océano', '#05111b', '#2dd4bf'], ['atardecer', 'Atardecer', '#130b0d', '#ff8a3d'],
    ['amoled', 'AMOLED', '#000000', '#ff4d62'], ['claro', 'Claro', '#f4f5f8', '#e11d48'],
    ['clasico', 'Clásico', '#121214', '#ff6b6b'], ['auto', 'Automático', '#0b0c10', '#8b5cf6'],
  ];
  LS.SHELVES = [
    { title: 'Eventos del año', queries: ['La Velada del Año', 'Kings League resumen'] },
    { title: 'Series y tráilers', queries: ['tráiler oficial serie 2026', 'series estreno tráiler'] },
    { title: 'YouTubers', queries: ['Ibai', 'AuronPlay', 'TheGrefg'] },
    { title: 'Deporte', queries: ['resumen partido goles'] },
    { title: 'Documentales', queries: ['documental completo en español'] },
    { title: 'Humor y entretenimiento', queries: ['monólogo humor', 'programa entretenimiento'] },
  ];

  /**
   * Estanterías de «Vídeos» según el país: lo de esta semana (week) se pide con el filtro «esta semana» de YouTube, así que se renueva solo.
   * En España se mantienen los eventos y creadores de siempre; en el resto, búsquedas con el nombre del país.
   */
  LS.shelvesFor = function (cc, countryName) {
    const n = countryName || '', es = String(cc).toUpperCase() === 'ES';
    return [
      { title: n ? 'Novedades en ' + n : 'Novedades', queries: [{ q: 'vídeos nuevos ' + n, week: true }, { q: 'lo más visto hoy ' + n, week: true }] },
      { title: 'Videoclips nuevos', queries: [{ q: 'videoclip oficial nuevo ' + n, week: true }, { q: 'estreno video oficial ' + n, week: true }] },
      { title: 'Series y tráilers', queries: [{ q: 'tráiler oficial serie estreno', week: true }, { q: 'tráiler oficial película estreno', week: true }] },
      { title: es ? 'Eventos del año' : 'Eventos y conciertos', queries: es ? [{ q: 'La Velada del Año' }, { q: 'Kings League resumen' }] : [{ q: 'evento en vivo resumen ' + n }, { q: 'concierto completo ' + n }] },
      { title: 'YouTubers', queries: es ? [{ q: 'Ibai' }, { q: 'AuronPlay' }, { q: 'TheGrefg' }] : [{ q: 'youtubers ' + n + ' vídeo nuevo', week: true }, { q: 'reto youtuber ' + n }] },
      { title: 'Deporte', queries: [{ q: 'resumen partido goles ' + n, week: true }] },
      { title: 'Documentales', queries: [{ q: 'documental completo en español ' + n }] },
      { title: 'Humor y entretenimiento', queries: [{ q: 'humor ' + n + ' vídeo', week: true }, { q: 'programa entretenimiento ' + n }] },
    ];
  };

  // ---------- Utilidades ----------
  LS.fold = function (s) {
    return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  };

  LS.formatTime = function (sec) {
    sec = Number.isFinite(sec) ? Math.max(0, Math.floor(sec)) : 0;
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  };

  /** "3:25" → 205, "1:02:03" → 3723; nulo o no numérico (directos) → 0. */
  LS.parseLength = function (text) {
    if (!text || !String(text).trim()) return 0;
    let total = 0;
    for (const part of String(text).split(':')) {
      if (!/^\d+$/.test(part)) return 0;
      total = total * 60 + parseInt(part, 10);
    }
    return total;
  };

  LS.isValidVideoId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id);

  // ---------- YouTube: URL y análisis de resultados ----------
  // sp=EgQIAxAB → "Esta semana" + "Vídeo"; sp=EgIQAQ%3D%3D → solo "Vídeo"
  LS.searchUrl = function (query, opts) {
    opts = opts || {};
    let url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(String(query).trim());
    if (opts.thisWeek) url += '&sp=EgQIAxAB';
    else if (opts.videosOnly) url += '&sp=EgIQAQ%3D%3D';
    return url;
  };

  function text(t) {
    if (!t || typeof t !== 'object') return '';
    if (typeof t.simpleText === 'string') return t.simpleText;
    return (Array.isArray(t.runs) && t.runs[0] && typeof t.runs[0].text === 'string') ? t.runs[0].text : '';
  }

  function readVideo(v) {
    if (!v || typeof v !== 'object' || !LS.isValidVideoId(v.videoId)) return null;
    const title = text(v.title);
    if (!title) return null;
    return {
      id: v.videoId,
      title,
      channel: text(v.ownerText) || text(v.longBylineText),
      duration: LS.parseLength(v.lengthText && v.lengthText.simpleText),
      published: text(v.publishedTimeText) || null,
    };
  }

  LS.parseYouTube = function (html) {
    const m = /var ytInitialData = (\{.*?\});<\/script>/s.exec(String(html || ''));
    if (!m) return [];
    let data;
    try { data = JSON.parse(m[1]); } catch (e) { return []; }
    const out = [], seen = new Set();
    (function walk(o, depth) {
      if (depth > 40 || o === null || typeof o !== 'object') return;
      if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
      for (const k of Object.keys(o)) {
        if (k === 'videoRenderer') {
          const v = readVideo(o[k]);
          if (v && !seen.has(v.id)) { seen.add(v.id); out.push(v); }
        } else walk(o[k], depth + 1);
      }
    })(data, 0);
    return out;
  };

  /** Explica en una frase por qué una página de YouTube no trae vídeos (para no mostrar un «sin resultados» mudo). */
  LS.diagnoseYouTube = function (html) {
    const h = String(html || '');
    const kb = Math.round(h.length / 1024);
    if (!h.length) return 'respuesta vacía';
    if (/consent\.youtube\.com|consent\.google\.com/i.test(h)) return `pantalla de consentimiento de cookies (${kb} KB)`;
    if (/unusual traffic|captcha|not a bot|confirm you.{0,10}re not a bot/i.test(h)) return `YouTube pide comprobar que no eres un robot (${kb} KB)`;
    if (!h.includes('ytInitialData')) return `página con otro formato, sin datos de vídeo (${kb} KB)`;
    return `página sin vídeos para esta búsqueda (${kb} KB)`;
  };

  // ---------- YouTube Music: solo canciones (versiones de audio, sin intros ni charla) ----------
  LS.MUSIC_SEARCH_URL = 'https://music.youtube.com/youtubei/v1/search?prettyPrint=false';
  LS.MUSIC_SONGS_PARAMS = 'EgWKAQIIAWoMEA4QChADEAQQCRAF';   // filtro «Canciones» de YouTube Music

  // Otros filtros de la búsqueda de YouTube Music: álbumes y artistas (para páginas de artista y álbumes completos)
  LS.MUSIC_ALBUMS_PARAMS = 'EgWKAQIYAWoMEA4QChADEAQQCRAF';
  LS.MUSIC_ARTISTS_PARAMS = 'EgWKAQIgAWoMEA4QChADEAQQCRAF';
  LS.MUSIC_BROWSE_URL = 'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false';
  const ytmContext = { client: { clientName: 'WEB_REMIX', clientVersion: '1.20241106.01.00', hl: 'es', gl: 'ES' } };

  LS.musicSearchBody = (query, params) => JSON.stringify({ context: ytmContext, query: String(query).trim(), params: params || LS.MUSIC_SONGS_PARAMS });
  /** Una página de YouTube Music: un álbum (MPREb_…), un artista (UC…) o una lista (VL…). */
  LS.musicBrowseBody = (browseId, country) => JSON.stringify(Object.assign({ context: ytmContext, browseId: String(browseId) },
    /^[A-Z]{2}$/.test(country || '') ? { formData: { selectedValues: [country] } } : {}));   // país: las listas de éxitos cambian según el país
  /** País del usuario («ES», «MX»…) por el idioma del sistema; si no se sabe, España. */
  LS.userCountry = function (langs) {
    for (const l of [].concat(langs || [])) { const m = /[-_]([A-Za-z]{2})$/.exec(String(l || '')); if (m) return m[1].toUpperCase(); }
    return 'ES';
  };
  LS.isBrowseId = (s) => typeof s === 'string' && /^(MPRE[\w-]{4,60}|UC[\w-]{20,30}|VL[\w-]{6,60})$/.test(s);

  // --- Lectura de las respuestas (solo metadatos públicos: títulos, artistas, portadas e identificadores) ---
  const ytmText = (cell) => {
    const t = cell && cell.musicResponsiveListItemFlexColumnRenderer && cell.musicResponsiveListItemFlexColumnRenderer.text;
    return t && Array.isArray(t.runs) ? t.runs.map((r) => (typeof r.text === 'string' ? r.text : '')) : [];
  };
  const ytmThumb = (node) => {
    const th = node && node.thumbnail && node.thumbnail.musicThumbnailRenderer && node.thumbnail.musicThumbnailRenderer.thumbnail && node.thumbnail.musicThumbnailRenderer.thumbnail.thumbnails;
    const url = Array.isArray(th) && th.length ? th[th.length - 1].url : '';
    return /^https:\/\//.test(url || '') ? url.replace(/=w\d+-h\d+.*$/, '=w544-h544') : '';
  };
  const ytmWalk = (data, fn) => {
    (function walk(o, depth) {
      if (depth > 40 || o === null || typeof o !== 'object') return;
      if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
      for (const k of Object.keys(o)) { if (!fn(k, o[k])) walk(o[k], depth + 1); }
    })(data, 0);
  };
  const ytmParse = (json) => { try { return typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return null; } };
  const dot = (t) => !t || /^[\s•·]+$/.test(t);

  /** Búsqueda con filtro «Álbumes» → [{ id: 'MPREb_…', title, kind: 'Álbum'|'EP'|'Single', artist, year, art }] */
  LS.parseYtmAlbums = function (json) {
    const data = ytmParse(json), out = [], seen = new Set();
    if (!data) return out;
    ytmWalk(data, (k, v) => {
      if (k !== 'musicResponsiveListItemRenderer') return false;
      const be = v && v.navigationEndpoint && v.navigationEndpoint.browseEndpoint, id = be && be.browseId;
      if (!LS.isBrowseId(id) || !/^MPRE/.test(id) || seen.has(id)) return true;
      const cols = Array.isArray(v.flexColumns) ? v.flexColumns : [];
      const title = (ytmText(cols[0])[0] || '').trim();
      const parts = ytmText(cols[1]).map((t) => t.trim()).filter((t) => !dot(t));      // «Álbum • Artista • 2022»
      if (!title) return true;
      seen.add(id);
      const year = parts.find((t) => /^(19|20)\d{2}$/.test(t)) || '';
      out.push({ id, title, kind: parts[0] || 'Álbum', artist: parts[1] && parts[1] !== year ? parts[1] : '', year, art: ytmThumb(v) });
      return true;
    });
    return out;
  };

  /** Búsqueda con filtro «Artistas» → [{ id: 'UC…', name, art }] */
  LS.parseYtmArtists = function (json) {
    const data = ytmParse(json), out = [], seen = new Set();
    if (!data) return out;
    ytmWalk(data, (k, v) => {
      if (k !== 'musicResponsiveListItemRenderer') return false;
      const be = v && v.navigationEndpoint && v.navigationEndpoint.browseEndpoint, id = be && be.browseId;
      if (!LS.isBrowseId(id) || !/^UC/.test(id) || seen.has(id)) return true;
      const name = ((Array.isArray(v.flexColumns) ? ytmText(v.flexColumns[0]) : [])[0] || '').trim();
      if (!name) return true;
      seen.add(id); out.push({ id, name, art: ytmThumb(v) });
      return true;
    });
    return out;
  };

  /**
   * Filas de canciones de un álbum, de la lista «todas las canciones» de un artista o de una lista → [{ id, title, channel, album, duration, art }].
   * ctx = { artist, album, art } rellena lo que la fila no trae (en un álbum todas las canciones comparten portada y a veces no dicen el artista).
   */
  LS.parseYtmTracks = function (json, ctx) {
    const data = ytmParse(json), out = [], seen = new Set(), c = ctx || {};
    if (!data) return out;
    ytmWalk(data, (k, v) => {
      if (k !== 'musicResponsiveListItemRenderer') return false;
      const cols = Array.isArray(v.flexColumns) ? v.flexColumns : [];
      let id = v.playlistItemData && v.playlistItemData.videoId;
      if (!id) { const w = v.overlay && v.overlay.musicItemThumbnailOverlayRenderer && v.overlay.musicItemThumbnailOverlayRenderer.content
        && v.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer && v.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer.playNavigationEndpoint;
        id = w && w.watchEndpoint && w.watchEndpoint.videoId; }
      if (!LS.isValidVideoId(id) || seen.has(id) || !cols.length) return true;
      const title = (ytmText(cols[0])[0] || '').trim();
      if (!title) return true;
      const parts = (cols[1] ? ytmText(cols[1]) : []).map((t) => t.trim()).filter((t) => !dot(t));
      let duration = 0;
      const fixed = Array.isArray(v.fixedColumns) ? v.fixedColumns : [];
      const ft = fixed[0] && fixed[0].musicResponsiveListItemFixedColumnRenderer && fixed[0].musicResponsiveListItemFixedColumnRenderer.text;
      const fts = ft && Array.isArray(ft.runs) && ft.runs[0] && ft.runs[0].text;
      if (/^\d+(:\d{2})+$/.test(fts || '')) duration = LS.parseLength(fts);
      else { const last = parts[parts.length - 1] || ''; if (/^\d+(:\d{2})+$/.test(last)) { duration = LS.parseLength(last); parts.pop(); } }
      // artista: primera parte que no sea la duración ni un contador de reproducciones; si no hay, el del contexto
      const artist = parts.find((t) => !/reproducciones|plays|views|visualizaciones/i.test(t) && !/^\d+(:\d{2})+$/.test(t)) || c.artist || '';
      seen.add(id);
      out.push({ id, title, channel: artist, album: c.album || (parts.length >= 3 ? parts[1] : ''), duration, art: ytmThumb(v) || c.art || '' });
      return true;
    });
    return out;
  };

  /**
   * Página de un artista → { songs (las más escuchadas), allSongsId ('VL…' de «todas las canciones»), releases: [{ id, title, kind, year, art }] }.
   * Los discos salen de los carruseles (álbumes, singles y EP); el tipo se ve en el subtítulo, no en el título del carrusel (que cambia de idioma).
   */
  LS.parseYtmArtistPage = function (json, artistName) {
    const data = ytmParse(json), res = { songs: [], allSongsId: '', releases: [] };
    if (!data) return res;
    const seen = new Set();
    ytmWalk(data, (k, v) => {
      if (k === 'musicShelfRenderer') {
        const be = v && v.bottomEndpoint && v.bottomEndpoint.browseEndpoint;
        if (be && /^VL/.test(be.browseId || '') && !res.allSongsId) res.allSongsId = be.browseId;
        if (!res.songs.length) res.songs = LS.parseYtmTracks({ shelf: v }, { artist: artistName });
        return true;
      }
      if (k === 'musicTwoRowItemRenderer') {
        const be = v && v.navigationEndpoint && v.navigationEndpoint.browseEndpoint, id = be && be.browseId;
        if (!LS.isBrowseId(id) || !/^MPRE/.test(id) || seen.has(id)) return true;
        const title = v.title && Array.isArray(v.title.runs) && v.title.runs[0] ? String(v.title.runs[0].text || '').trim() : '';
        const sub = v.subtitle && Array.isArray(v.subtitle.runs) ? v.subtitle.runs.map((r) => String(r.text || '').trim()).filter((t) => !dot(t)) : [];
        if (!title) return true;
        seen.add(id);
        const th = v.thumbnailRenderer && v.thumbnailRenderer.musicThumbnailRenderer && v.thumbnailRenderer.musicThumbnailRenderer.thumbnail && v.thumbnailRenderer.musicThumbnailRenderer.thumbnail.thumbnails;
        const url = Array.isArray(th) && th.length ? th[th.length - 1].url : '';
        res.releases.push({ id, title, kind: sub.find((t) => !/^(19|20)\d{2}$/.test(t)) || 'Álbum', year: sub.find((t) => /^(19|20)\d{2}$/.test(t)) || '',
          art: /^https:\/\//.test(url || '') ? url.replace(/=w\d+-h\d+.*$/, '=w544-h544') : '' });
        return true;
      }
      return false;
    });
    return res;
  };

  /** Página de listas de éxitos de YouTube Music («Artistas principales»): se actualiza sola. */
  LS.CHARTS_BROWSE_ID = 'FEmusic_charts';

  /** Respuesta de las listas de éxitos → artistas del ranking [{ id: 'UC…', name, art }] en el orden del ranking, sin repetir. */
  LS.parseYtmChartArtists = function (json) {
    const data = ytmParse(json), out = [], seen = new Set();
    if (!data) return out;
    ytmWalk(data, (k, v) => {
      if (k !== 'musicResponsiveListItemRenderer' && k !== 'musicTwoRowItemRenderer') return false;
      const be = v && v.navigationEndpoint && v.navigationEndpoint.browseEndpoint, id = be && be.browseId;
      if (!LS.isBrowseId(id) || !/^UC/.test(id) || seen.has(id)) return true;
      let name = '';
      if (k === 'musicTwoRowItemRenderer') name = v.title && Array.isArray(v.title.runs) && v.title.runs[0] ? String(v.title.runs[0].text || '').trim() : '';
      else name = ((Array.isArray(v.flexColumns) ? ytmText(v.flexColumns[0]) : [])[0] || '').trim();
      if (!name) return true;
      let art = ytmThumb(v);
      if (!art && v.thumbnailRenderer) art = ytmThumb({ thumbnail: v.thumbnailRenderer });
      seen.add(id); out.push({ id, name, art });
      return true;
    });
    return out;
  };

  /** Página de listas de éxitos de YouTube Music («Artistas principales»): se actualiza sola. */
  LS.CHARTS_BROWSE_ID = 'FEmusic_charts';

  /** Respuesta de las listas de éxitos → artistas del ranking [{ id: 'UC…', name, art }] en el orden del ranking, sin repetir. */
  LS.parseYtmChartArtists = function (json) {
    const data = ytmParse(json), out = [], seen = new Set();
    if (!data) return out;
    ytmWalk(data, (k, v) => {
      if (k !== 'musicResponsiveListItemRenderer' && k !== 'musicTwoRowItemRenderer') return false;
      const be = v && v.navigationEndpoint && v.navigationEndpoint.browseEndpoint, id = be && be.browseId;
      if (!LS.isBrowseId(id) || !/^UC/.test(id) || seen.has(id)) return true;
      let name = '';
      if (k === 'musicTwoRowItemRenderer') name = v.title && Array.isArray(v.title.runs) && v.title.runs[0] ? String(v.title.runs[0].text || '').trim() : '';
      else name = ((Array.isArray(v.flexColumns) ? ytmText(v.flexColumns[0]) : [])[0] || '').trim();
      if (!name) return true;
      let art = ytmThumb(v);
      if (!art && v.thumbnailRenderer) art = ytmThumb({ thumbnail: v.thumbnailRenderer });
      seen.add(id); out.push({ id, name, art });
      return true;
    });
    return out;
  };

  const COUNTRIES = { ES: 'España', MX: 'México', AR: 'Argentina', CO: 'Colombia', CL: 'Chile', PE: 'Perú', VE: 'Venezuela', EC: 'Ecuador', UY: 'Uruguay', PY: 'Paraguay',
    BO: 'Bolivia', DO: 'República Dominicana', PR: 'Puerto Rico', CR: 'Costa Rica', PA: 'Panamá', GT: 'Guatemala', SV: 'El Salvador', HN: 'Honduras', NI: 'Nicaragua',
    CU: 'Cuba', US: 'Estados Unidos', BR: 'Brasil', PT: 'Portugal', FR: 'Francia', IT: 'Italia', DE: 'Alemania', GB: 'Reino Unido', CA: 'Canadá' };
  /** Nombre del país en español («CO» → «Colombia»); si no se conoce, el propio código. */
  LS.countryName = (cc) => COUNTRIES[String(cc || '').toUpperCase()] || String(cc || '');

  /** Listas de éxitos oficiales del país (en la página de listas de YouTube Music) → [{ id: 'VL…', title }] */
  LS.parseYtmChartLists = function (json) {
    const data = ytmParse(json), out = [], seen = new Set();
    if (!data) return out;
    ytmWalk(data, (k, v) => {
      if (k !== 'musicTwoRowItemRenderer') return false;
      const be = v && v.navigationEndpoint && v.navigationEndpoint.browseEndpoint, id = be && be.browseId;
      if (!LS.isBrowseId(id) || !/^VL/.test(id) || seen.has(id)) return true;
      const title = v.title && Array.isArray(v.title.runs) ? v.title.runs.map((r) => r.text || '').join('').trim() : '';
      seen.add(id); out.push({ id, title });
      return true;
    });
    return out;
  };

  /** De las listas de éxitos, la mejor para «Éxitos»: los 100 más populares, si no el top diario, si no las tendencias. */
  LS.pickHitsList = function (lists) {
    const l = lists || [];
    return l.find((x) => /100|m[aá]s populares|most popular/i.test(x.title)) || l.find((x) => /top diario|daily/i.test(x.title)) || l.find((x) => /tendencias|trending/i.test(x.title)) || l[0] || null;
  };

  /** De varios álbumes encontrados, el que mejor encaja con título (y artista): igual > contiene; el primero si ninguno encaja del todo. */
  LS.pickAlbum = function (albums, title, artist) {
    const want = LS.normName(title), who = LS.normName(artist || '');
    const ok = (a) => !who || !a.artist || LS.normName(a.artist).includes(who) || who.includes(LS.normName(a.artist));
    const list = (albums || []).filter(ok);
    return list.find((a) => LS.normName(a.title) === want) || list.find((a) => LS.normName(a.title).includes(want) || want.includes(LS.normName(a.title))) || null;
  };

  /** Búsqueda de YouTube Music por género (las canciones salen mejor con palabras sueltas). */
  LS.genreQuery = function (genre, year) {
    switch (genre) {
      case 'Éxitos': return 'éxitos ' + year;
      case 'Reggaetón': return 'reggaeton';
      case 'Pop': return 'pop hits';
      case 'Rock': return 'rock';
      case 'Electrónica': return 'electronica';
      case 'Hip hop': return 'hip hop';
      case 'Latino': return 'latino';
      case 'Lo-fi': return 'lofi';
      default: return String(genre);
    }
  };

  /**
   * Pasos para que Android no cierre la música en segundo plano, según el fabricante. Son orientativos: los nombres cambian según el modelo y la
   * versión del sistema. Más información: https://dontkillmyapp.com
   */
  LS.bgSteps = function (manufacturer, brand) {
    const m = (String(manufacturer || '') + ' ' + String(brand || '')).toLowerCase();
    const pick = (re) => re.test(m);
    if (pick(/oppo|realme|oneplus|coloros/)) return { name: 'Oppo / Realme / OnePlus (ColorOS)', steps: [
      'Ajustes → Batería → Nsound (o «Más ajustes» → Optimización de batería): elige «Permitir actividad en segundo plano» o «Sin restricciones».',
      'Ajustes → Aplicaciones → Gestión de aplicaciones → Nsound → Ahorro de batería: «Sin restricciones»; y activa «Inicio automático».',
      'Abre las apps recientes, mantén pulsada la tarjeta de Nsound (o toca el menú de la tarjeta) y elige «Bloquear» para que no la cierre.'] };
    if (pick(/xiaomi|redmi|poco|miui/)) return { name: 'Xiaomi / Redmi / POCO (MIUI, HyperOS)', steps: [
      'Ajustes → Aplicaciones → Permisos → Inicio automático → activa Nsound.',
      'Ajustes → Batería → Ahorro de batería de las apps → Nsound → «Sin restricciones».',
      'En las apps recientes, mantén pulsada Nsound y toca el candado.'] };
    if (pick(/samsung/)) return { name: 'Samsung (One UI)', steps: [
      'Ajustes → Aplicaciones → Nsound → Batería → «Sin restricciones».',
      'Ajustes → Batería → Límites de uso en segundo plano: quita Nsound de «Apps en suspensión» y de «Apps en suspensión profunda».'] };
    if (pick(/huawei|honor/)) return { name: 'Huawei / Honor', steps: [
      'Ajustes → Batería → Inicio de aplicaciones → Nsound → «Gestionar manualmente» y activa las tres opciones.'] };
    if (pick(/vivo|iqoo/)) return { name: 'Vivo / iQOO', steps: [
      'Ajustes → Batería → Consumo en segundo plano → Nsound → «Permitir».',
      'Ajustes → Aplicaciones → Inicio automático → activa Nsound.'] };
    return { name: 'Tu móvil', steps: [
      'Ajustes → Aplicaciones → Nsound → Batería → «Sin restricciones» (el nombre cambia según el fabricante).',
      'Si hay «Inicio automático» o «Actividad en segundo plano», actívalo para Nsound.'] };
  };

  /** Búsqueda de lo recién publicado (últimos 7 días en YouTube) de un género: se muestra antes que el fondo de catálogo. */
  LS.recentQuery = function (genre, year) {
    switch (genre) {
      case 'Reggaetón': return 'reggaeton nuevo video oficial ' + year;
      case 'Pop': return 'pop new official music video ' + year;
      case 'Rock': return 'rock new official video ' + year;
      case 'Electrónica': return 'electronic dance new official video ' + year;
      case 'Hip hop': return 'hip hop rap new official video ' + year;
      case 'Latino': return 'latino nuevo video oficial ' + year;
      case 'Lo-fi': return 'lofi new music ' + year;
      default: return 'nuevo lanzamiento oficial video musical ' + year;
    }
  };

  /** Respuesta de YouTube Music → [{ id, title, channel (artista), album, duration, art }] */
  LS.parseYtMusic = function (json) {
    let data;
    try { data = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return []; }
    const out = [], seen = new Set();
    const runs = (cols, i) => {
      const t = cols[i] && cols[i].musicResponsiveListItemFlexColumnRenderer && cols[i].musicResponsiveListItemFlexColumnRenderer.text;
      return t && Array.isArray(t.runs) ? t.runs.map((r) => (typeof r.text === 'string' ? r.text : '')) : [];
    };
    (function walk(o, depth) {
      if (depth > 40 || o === null || typeof o !== 'object') return;
      if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
      for (const k of Object.keys(o)) {
        if (k !== 'musicResponsiveListItemRenderer') { walk(o[k], depth + 1); continue; }
        const r = o[k] || {};
        const id = r.playlistItemData && r.playlistItemData.videoId;
        const cols = Array.isArray(r.flexColumns) ? r.flexColumns : [];
        if (!LS.isValidVideoId(id) || seen.has(id) || !cols.length) continue;
        const title = (runs(cols, 0)[0] || '').trim();
        const parts = runs(cols, 1).map((t) => t.trim()).filter((t) => t && !/^[•·]+$/.test(t));
        if (!title || !parts.length) continue;
        const last = parts[parts.length - 1];
        const duration = /^\d+(:\d{2})+$/.test(last) ? LS.parseLength(last) : 0;
        const thumbs = r.thumbnail && r.thumbnail.musicThumbnailRenderer && r.thumbnail.musicThumbnailRenderer.thumbnail && r.thumbnail.musicThumbnailRenderer.thumbnail.thumbnails;
        const url = Array.isArray(thumbs) && thumbs.length ? thumbs[thumbs.length - 1].url : '';
        seen.add(id);
        out.push({
          id, title, channel: parts[0], album: parts.length >= 3 ? parts[1] : '', duration,
          art: /^https:\/\//.test(url || '') ? url.replace(/=w\d+-h\d+.*$/, '=w544-h544') : '',
        });
      }
    })(data, 0);
    return out;
  };

  // ---------- Filtro música / vídeo ----------
  // JS no tiene \b con acentos: se delimita con "no letra ni número" a cada lado.
  const NOT_A_SONG = /(^|[^\p{L}\p{N}_])(tutorial|lesson|lecci[oó]n|reaction|reacci[oó]n|karaoke|how to|c[oó]mo tocar|review|podcast|interview|entrevista|nightcore|slowed|sped up|8d audio|full album|[aá]lbum completo|playlist|mix|megamix|compilation|recopilaci[oó]n)(?![\p{L}\p{N}_])|\d+\s*(hours?|horas?)/iu;
  const AUDIO_ONLY = /(^|[^\p{L}\p{N}_])(audio|lyrics?|letra|visuali[sz]er|topic|full album|[aá]lbum completo)(?![\p{L}\p{N}_])/iu;

  LS.isLive = (v) => !(v.duration > 0);
  LS.isSong = (v) => !LS.isLive(v) && v.duration > 60 && v.duration <= 720 && !NOT_A_SONG.test(v.title);
  LS.isVideo = (v) => !LS.isLive(v) && !AUDIO_ONLY.test(v.title);

  /** Mezcla resultados de varias búsquedas alternándolos; solo vídeos de verdad (≥ 45 s), sin repetidos. */
  LS.mergeShelf = function (lists, take) {
    const merged = [], most = Math.max(0, ...lists.map((l) => l.length));
    for (let i = 0; i < most; i++) for (const l of lists) if (i < l.length) merged.push(l[i]);
    const seen = new Set();
    return merged.filter((v) => LS.isVideo(v) && v.duration >= 45 && !seen.has(v.id) && seen.add(v.id)).slice(0, take);
  };

  // ---------- Títulos (puerto de MetadataMatcher) ----------
  const NOISE = /\s*[\(\[\{][^\)\]\}]*?\b(official|oficial|video|vídeo|audio|lyrics?|letra|visualizer|hd|hq|4k|1080p|720p|explicit|clean|mv|m\/v|remaster(?:ed)?|\d{4}\s+remaster(?:ed)?)\b[^\)\]\}]*[\)\]\}]/gi;
  const NOISE_TAIL = /\s+[-–|]\s+(official\s+)?(music\s+)?(video|audio|lyrics?|visualizer)\s*$/i;
  const REMASTER_TAIL = /\s+[-–]\s+(\d{4}\s+)?remaster(ed)?(\s+\d{4})?(\s+version)?\s*$/i;
  const FEAT = /\s*[\(\[]?\b(?:feat\.?|ft\.?|featuring)\s+([^\)\]]+?)[\)\]]?(?=\s*[\(\[\-–]|$)/i;
  const VERSION_GROUP = /\s*[\(\[]([^\)\]]*)[\)\]]|\s+[-–]\s+([^\-–]+)$/g;
  const VERSIONS = [
    ['remix', /\b(remix|rmx|mix|bootleg|rework)\b/i],
    ['live', /\b(live|en vivo|en directo|unplugged)\b/i],
    ['acoustic', /\b(acoustic|acústic[oa])\b/i],
    ['instrumental', /\b(instrumental|karaoke)\b/i],
    ['cover', /\bcover\b/i],
    ['edit', /\b(radio edit|edit|extended)\b/i],
  ];

  LS.cleanTitle = function (raw) {
    let t = String(raw).replace(NOISE, '').replace(NOISE_TAIL, '').replace(REMASTER_TAIL, '');
    let featuring = [];
    const m = FEAT.exec(t);
    if (m) {
      featuring = m[1].split(/,|&| y | and /i).map((s) => s.trim()).filter(Boolean);
      t = t.slice(0, m.index) + t.slice(m.index + m[0].length);
    }
    let version = 'original';
    for (const g of t.matchAll(VERSION_GROUP)) {
      const chunk = g[1] !== undefined ? g[1] : (g[2] || '');
      const hit = VERSIONS.find((v) => v[1].test(chunk));
      if (!hit) continue;
      version = hit[0];
      t = t.replace(g[0], '');
      break;
    }
    t = t.replace(/\s+/g, ' ').replace(/^[ \-–|]+|[ \-–|]+$/g, '');
    return { title: t, featuring, version };
  };

  /** Deduce artista y título de un vídeo de YouTube ("Artista - Canción (Official Video)", canal "ArtistaVEVO"). */
  LS.guessTrack = function (videoTitle, channel) {
    const clean = LS.cleanTitle(videoTitle).title;
    const artist = String(channel || '').replace(/\s*(-\s*Topic|VEVO|Official|Oficial)\s*$/i, '').trim();
    for (const sep of [' - ', ' – ', ' — ']) {
      const i = clean.indexOf(sep);
      if (i > 0) return { artist: clean.slice(0, i).trim(), title: clean.slice(i + sep.length).trim() };
    }
    return { artist, title: clean };
  };

  // ---------- Letras (LRC) ----------
  /** "[01:02.50] línea" → líneas ordenadas por tiempo; una línea con varias marcas se repite. */
  LS.parseLrc = function (lrc) {
    const lines = [];
    if (!lrc || !String(lrc).trim()) return lines;
    const tag = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
    for (const raw of String(lrc).split('\n')) {
      const tags = [...raw.matchAll(tag)];
      if (!tags.length) continue;
      const txt = raw.replace(tag, '').trim();
      for (const t of tags) {
        const frac = t[3] ? parseFloat('0.' + t[3]) : 0;
        lines.push({ time: parseInt(t[1], 10) * 60 + parseInt(t[2], 10) + frac, text: txt });
      }
    }
    return lines.sort((a, b) => a.time - b.time);
  };

  /** Índice de la línea que suena en `position` (−1 si aún no ha empezado). */
  LS.lyricIndexAt = function (lines, position) {
    let index = -1;
    for (let i = 0; i < lines.length && lines[i].time <= position; i++) index = i;
    return index;
  };

  /** Elige el mejor resultado de LRCLIB: primero sincronizado, luego duración más cercana. */
  LS.pickLyrics = function (json, durationSec) {
    let arr;
    try { arr = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return null; }
    if (!Array.isArray(arr)) return null;
    let best = null, bestScore = Infinity;
    for (const e of arr) {
      if (!e || typeof e !== 'object') continue;
      const synced = LS.parseLrc(e.syncedLyrics);
      const plain = typeof e.plainLyrics === 'string' ? e.plainLyrics : '';
      if (!synced.length && !plain.trim()) continue;
      const d = typeof e.duration === 'number' ? e.duration : 0;
      const diff = durationSec > 0 && d > 0 ? Math.abs(d - durationSec) : 30;
      const score = diff + (synced.length ? 0 : 1000);
      if (score >= bestScore) continue;
      bestScore = score;
      best = synced.length ? { synced: true, lines: synced }
        : { synced: false, lines: plain.split('\n').map((l) => ({ time: -1, text: l.trim() })) };
    }
    return best;
  };

  // ---------- Ecualizador ----------
  LS.eqMatch = function (bands) {
    for (const [name, p] of Object.entries(LS.EQ_PRESETS)) if (p.every((v, i) => v === bands[i])) return name;
    return LS.EQ_CUSTOM;
  };

  // ---------- Reglas de anuncios (las usan los envoltorios nativos y se prueban aquí) ----------
  LS.AD_HOSTS = ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'googletagservices.com',
    'googletagmanager.com', 'google-analytics.com', 'adservice.google.com', '2mdn.net', 'imasdk.googleapis.com',
    'moatads.com', 'scorecardresearch.com', 'adsrvr.org', 'amazon-adsystem.com'];
  LS.AD_PATHS = ['/pagead/', '/api/stats/ads', '/get_midroll_info', '/ptracking', '/youtubei/v1/player/ad_break'];

  LS.isAdUrl = function (url) {
    let u;
    try { u = new URL(url); } catch (e) { return false; }
    const host = u.hostname.toLowerCase();
    if (LS.AD_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return true;
    const yt = host === 'youtube.com' || host.endsWith('.youtube.com') || host.endsWith('.youtube-nocookie.com');
    return yt && LS.AD_PATHS.some((p) => u.pathname.toLowerCase().startsWith(p));
  };
})(LS);
if (typeof module !== 'undefined' && module.exports) module.exports = LS;
