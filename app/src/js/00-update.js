/* Aviso de versiones nuevas: pregunta a las Releases públicas de GitHub como máximo una vez al día, sin cuentas ni telemetría.
   Misma lógica que windows/LibreStream.Core/Services/Updates. */
var LS = globalThis.LS = globalThis.LS || {};
(function (LS) {
  'use strict';

  LS.RELEASES_API = 'https://api.github.com/repos/N1x0321/Nsound/releases?per_page=20';
  const RELEASE_PAGE = 'https://github.com/N1x0321/Nsound/releases/tag/';
  const DAY = 24 * 60 * 60 * 1000;
  const KEY = 'ls.update';
  /** Fichero que tiene que llevar la Release para anunciarla en cada plataforma (en un navegador no hay fichero). */
  const ASSET = { android: '-android.apk', ios: '-unsigned.ipa' };
  const VERSION = /^v?(\d+\.\d+\.\d+(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?)(?:\+[0-9A-Za-z.-]+)?$/;

  /** Versión de la página: la escribe app/build.mjs (en las apps móviles manda la versión nativa). */
  LS.BUILD_VERSION = '__NSOUND_VERSION__';

  LS.parseVersion = function (text) {
    const m = VERSION.exec(String(text == null ? '' : text).trim());
    if (!m) return null;
    const pre = m[2] ? m[2].split('.') : [];
    return { text: m[1], numbers: m[1].split('-')[0].split('.').map(Number), pre, dev: pre.includes('dev') };
  };

  /** Las partes numéricas se comparan como números y van antes que las de texto. */
  function comparePart(a, b) {
    const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
    if (na !== nb) return na ? -1 : 1;
    if (na) return Math.sign(Number(a) - Number(b));
    return a < b ? -1 : a > b ? 1 : 0;
  }

  /** -1, 0 o 1, como en SemVer: beta.9 < beta.10 < final. Recibe lo que devuelve parseVersion. */
  LS.compareVersions = function (a, b) {
    for (let i = 0; i < 3; i++) if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] < b.numbers[i] ? -1 : 1;
    if (!a.pre.length || !b.pre.length) return Math.sign(b.pre.length - a.pre.length);   // la final va después de sus previas
    for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
      const c = comparePart(a.pre[i], b.pre[i]);
      if (c) return c;
    }
    return Math.sign(a.pre.length - b.pre.length);
  };

  /** Etiqueta de la Release más alta (sin contar borradores) que ya tiene el fichero de esta plataforma, o null. */
  LS.latestRelease = function (releases, platform) {
    if (!Array.isArray(releases)) throw new Error('Se esperaba una lista de versiones.');
    const suffix = ASSET[platform];
    let best = null, tag = null;
    for (const r of releases) {
      if (!r || r.draft === true || typeof r.tag_name !== 'string') continue;
      const v = LS.parseVersion(r.tag_name);
      if (!v || v.dev) continue;
      if (suffix && !(Array.isArray(r.assets) && r.assets.some((a) => a && typeof a.name === 'string' && a.name.endsWith(suffix) && (a.state === undefined || a.state === 'uploaded')))) continue;
      if (!best || LS.compareVersions(v, best) > 0) { best = v; tag = r.tag_name; }
    }
    return tag;
  };

  /** Descarga la lista de Releases: sin cookies, sin referente y sin ningún dato del usuario. */
  LS.fetchReleases = async function (url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json' }, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(timer); }
  };

  /**
   * opts: storage (getItem/setItem), installed (versión instalada), platform, fetchJson(url), now() y online().
   * current() y check() devuelven { version, url } si hay una versión nueva sin descartar, o null.
   */
  LS.createUpdateChecker = function (opts) {
    const storage = opts.storage, installed = LS.parseVersion(opts.installed);
    const now = opts.now || (() => Date.now()), online = opts.online || (() => true);
    const usable = !!installed && !installed.dev;
    let busy = null;
    let state = {};
    try { const s = JSON.parse(storage.getItem(KEY) || '{}'); if (s && typeof s === 'object') state = s; } catch (e) { /* estado roto: se empieza de cero */ }
    const save = () => { try { storage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* sin espacio o bloqueado */ } };

    function current() {
      const latest = LS.parseVersion(state.tag);
      if (!usable || !latest || LS.compareVersions(latest, installed) <= 0 || latest.text === state.dismissed) return null;
      return { version: latest.text, url: RELEASE_PAGE + encodeURIComponent(state.tag) };
    }

    async function ask() {
      state.lastCheck = now();    // el intento cuenta aunque falle: nunca más de una consulta al día
      save();
      try {
        state.tag = LS.latestRelease(await opts.fetchJson(LS.RELEASES_API), opts.platform);
        save();
      } catch (e) { /* sin conexión, límite de GitHub o respuesta rara: se volverá a mirar otro día */ }
    }

    return {
      current,
      async check() {
        const since = now() - state.lastCheck;     // NaN la primera vez
        if (!busy && usable && online() && !(since >= 0 && since < DAY)) busy = ask().finally(() => { busy = null; });
        await busy;      // quien llegue mientras se pregunta recibe la misma respuesta
        return current();
      },
      /** No volver a avisar de esta versión (de las siguientes, sí). */
      dismiss(version) { state.dismissed = version; save(); },
    };
  };
})(LS);
if (typeof module !== 'undefined' && module.exports) module.exports = LS;
