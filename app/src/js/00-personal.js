/* Lo personal (solo en este dispositivo): historial de escucha, «Hecho para ti», «Tu semana» y carátulas cuadradas.
   Mismas reglas que la app de Windows (ListenHistory, WeekSummary, CoverArt). Sin DOM: se prueba con Node. */
var LS = globalThis.LS = globalThis.LS || {};
(function (LS) {
  'use strict';

  const DAY = 864e5;
  const key = (it) => it.src + ':' + it.id;

  // ---------- Historial ----------
  LS.HISTORY_MAX = 1000;
  /** Segundos que tiene que sonar una canción para contar como escuchada: 30, o la mitad si es más corta. */
  LS.countsAfter = (duration) => (duration > 0 ? Math.min(30, duration / 2) : 30);

  /** «Seguir escuchando»: lo último que sonó, sin repetir. entries: [{ item, artist, at }] de la más reciente a la más antigua. */
  LS.recentDistinct = function (entries, n) {
    const seen = new Set(), out = [];
    for (const e of entries || []) { if (!e || !e.item || seen.has(key(e.item))) continue; seen.add(key(e.item)); out.push(e.item); if (out.length >= n) break; }
    return out;
  };

  /** Artistas más escuchados desde `since` (ms): [{ artist, plays, top }] (top = su canción más escuchada). */
  LS.topArtists = function (entries, since, n) {
    const groups = new Map();
    for (const e of entries || []) {
      const f = LS.fold(e && e.artist || '');
      if (!f || e.at < since) continue;
      if (!groups.has(f)) groups.set(f, { artist: e.artist, plays: 0, last: 0, songs: new Map() });
      const g = groups.get(f);
      g.plays++; g.last = Math.max(g.last, e.at);
      const sk = key(e.item), s = g.songs.get(sk) || { item: e.item, n: 0 };
      s.n++; g.songs.set(sk, s);
    }
    return [...groups.values()]
      .sort((a, b) => b.plays - a.plays || b.last - a.last)
      .slice(0, n)
      .map((g) => ({ artist: g.artist, plays: g.plays, top: [...g.songs.values()].sort((a, b) => b.n - a.n)[0].item }));
  };

  /**
   * Mezclas de «Hecho para ti» (como mucho 4): «Mezcla de <artista>» para los artistas escuchados al menos 2 veces en 30 días (hasta 2)
   * y «Porque escuchaste <canción>» con las últimas canciones de otros artistas (hasta 2). Devuelve [{ kind, title, artist, seed }].
   */
  LS.mixesFrom = function (entries, now) {
    const res = [], used = new Set(), recent = (entries || []).filter((e) => e.at >= now - 30 * DAY);
    for (const a of LS.topArtists(recent, 0, 2)) {
      if (a.plays < 2) break;
      res.push({ kind: 'artist', title: 'Mezcla de ' + a.artist, artist: a.artist, seed: a.top });
      used.add(LS.fold(a.artist));
    }
    let because = 0;
    for (const it of LS.recentDistinct(entries, 50)) {
      if (res.length >= 4 || because >= 2) break;
      const e = entries.find((x) => key(x.item) === key(it));
      const f = LS.fold(e.artist || '') || key(it);
      if (used.has(f)) continue;
      used.add(f);
      res.push({ kind: 'because', title: 'Porque escuchaste «' + it.title + '»', artist: e.artist || '', seed: it });
      because++;
    }
    return res;
  };

  /** Mezcla varias listas alternándolas (A1, B1, A2, B2…), sin repetir ni incluir `exclude`. */
  LS.interleave = function (lists, keyOf, exclude, max) {
    const seen = new Set(exclude || []), out = [];
    const longest = Math.max(0, ...lists.map((l) => l.length));
    for (let i = 0; i < longest && out.length < max; i++) {
      for (const l of lists) { if (i < l.length && out.length < max && !seen.has(keyOf(l[i]))) { seen.add(keyOf(l[i])); out.push(l[i]); } }
    }
    return out;
  };

  /**
   * «Tu semana»: lo escuchado en los últimos 7 días (hoy incluido). Los minutos son aproximados: cada escucha suma la duración de la
   * canción (como mucho 10 min). Devuelve { from, minutes, plays, songs, artists, topArtists, topSongs, byDay[7], days[7], previous, change }.
   */
  LS.weekSummary = function (entries, now, top) {
    const n = top || 5;
    const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
    const from = d0.getTime() - 6 * DAY;
    const mins = (e) => Math.min(600, Math.max(0, (e.item && e.item.duration) || 0)) / 60;
    const all = entries || [];
    const week = all.filter((e) => e.at >= from && e.at <= now);
    const previous = all.filter((e) => e.at >= from - 7 * DAY && e.at < from).reduce((s, e) => s + mins(e), 0);
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(from); d.setDate(d.getDate() + i); return d.getTime(); });
    const byDay = days.map((d, i) => week.filter((e) => e.at >= d && e.at < (i < 6 ? days[i + 1] : d + DAY)).reduce((s, e) => s + mins(e), 0));
    const songMap = new Map();
    week.forEach((e, i) => { const k = key(e.item); const s = songMap.get(k) || { song: e.item, artist: e.artist || '', plays: 0, first: i }; s.plays++; songMap.set(k, s); });
    const songs = [...songMap.values()].sort((a, b) => b.plays - a.plays || a.first - b.first);
    const artists = LS.topArtists(week, from, 1e9);
    const minutes = week.reduce((s, e) => s + mins(e), 0);
    return {
      from, minutes, plays: week.length, songs: songs.length, artists: artists.length,
      topArtists: artists.slice(0, n), topSongs: songs.slice(0, n), byDay, days, previous,
      change: previous >= 1 ? minutes / previous - 1 : null,
    };
  };

  // ---------- Carátulas cuadradas oficiales ----------
  /** ¿Portada cuadrada de YouTube Music? (las del CDN de Google, no las miniaturas de vídeo de i.ytimg.com) */
  LS.isSquareCover = (url) => /^https:\/\/[^/]+\.(googleusercontent\.com|ggpht\.com)\//i.test(url || '');
  /** La misma portada diminuta (para el fondo desenfocado); '' si no es de YouTube Music. */
  LS.tinyCover = (url, px) => (LS.isSquareCover(url) ? String(url).replace(/=w\d+.*$/, '') + '=w' + (px || 48) + '-h' + (px || 48) : '');
  /** Lo que se busca en YouTube Music para un vídeo: «artista título», sin «(Official Video)» ni el «VEVO» del canal. */
  LS.coverQuery = (title, channel) => { const g = LS.guessTrack(title, channel); return (g.artist + ' ' + g.title).trim(); };
  /**
   * De las canciones encontradas, la misma que el vídeo y con portada cuadrada: primero el mismo id; si no, mismo título (igual o contenido)
   * y mismo artista. null si ninguna encaja (mejor el fotograma que la portada de otra canción).
   */
  LS.pickCoverSong = function (songs, videoId, title, channel) {
    const list = (songs || []).filter((s) => LS.isSquareCover(s.art));
    const same = list.find((s) => s.id === videoId);
    if (same) return same;
    const g = LS.guessTrack(title, channel), want = LS.fold(g.title), who = LS.fold(g.artist), whole = LS.fold(title);
    if (!want) return null;
    const titleOk = (s) => { const t = LS.fold(LS.cleanTitle(s.title).title); return !!t && (t === want || (t.length >= 3 && want.includes(t)) || (want.length >= 3 && t.includes(want))); };
    const artistOk = (s) => { if (!who) return true; const a = LS.fold(String(s.channel || '').split(' · ')[0]); return !!a && (a.includes(who) || who.includes(a) || whole.includes(a)); };
    return list.find((s) => titleOk(s) && artistOk(s)) || null;
  };

})(LS);
if (typeof module !== 'undefined' && module.exports) module.exports = LS;
