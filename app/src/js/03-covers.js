/* EXPERIMENTO: carátulas a través de un Cloudflare Worker (PRUEBAS-NSOUND/propuesta-arquitectura/cover-worker.js).
   Desactivado por defecto: aún no hay Worker desplegado. Apagado devuelve la URL tal cual. */
var LS = globalThis.LS = globalThis.LS || {};
(function (LS) {
  'use strict';
  const cfg = { enabled: false, base: '', key: '' };
  const memo = new Map();
  let keyP = null, keyFor = null;
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const getKey = () => {
    if (!keyP || keyFor !== cfg.key) {
      keyFor = cfg.key;
      keyP = crypto.subtle.importKey('raw', new TextEncoder().encode(cfg.key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    }
    return keyP;
  };

  LS.covers = {
    configure(o) { Object.assign(cfg, o || {}); memo.clear(); },
    /** URL del Worker firmada (sig = base64url(HMAC-SHA256(clave, url))); la original si está apagado, no es https o falta config. */
    async proxifyCover(url) {
      if (!cfg.enabled || !cfg.base || !cfg.key) return url;
      if (!url || !/^https:/i.test(url) || url.startsWith(cfg.base)) return url;
      if (memo.has(url)) return memo.get(url);
      try {
        const sig = b64url(await crypto.subtle.sign('HMAC', await getKey(), new TextEncoder().encode(url)));
        const out = `${cfg.base}${cfg.base.includes('?') ? '&' : '?'}url=${encodeURIComponent(url)}&sig=${sig}`;
        memo.set(url, out);
        return out;
      } catch (e) { return url; }   // sin crypto.subtle se deja la carátula original
    },
  };
  LS.proxifyCover = (url) => LS.covers.proxifyCover(url);
})(LS);
if (typeof module !== 'undefined' && module.exports) module.exports = LS;
