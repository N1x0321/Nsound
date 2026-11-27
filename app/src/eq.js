// Ecualizador de 10 bandas para el vídeo de YouTube incrustado (Web Audio API).
// Se inyecta en el marco (iframe) de YouTube: Windows con WebView2, iOS con WKUserScript y Android con
// addDocumentStartJavaScript. La app lo controla con window.__lsEq(gananciasDb, activado) o, desde la
// página, con postMessage({ lsEq: { gains, on } }). Un único archivo para todas las plataformas.
(() => {
  // Solo en YouTube: sobre medios de otros orígenes (sin CORS) el audio quedaría en silencio
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname)) return;
  // Segundo plano: el reproductor de YouTube se pausa solo cuando la página pasa a «oculta» (pantalla bloqueada o app en segundo
  // plano). Aquí se le indica que sigue visible y se descartan los avisos de cambio de visibilidad, como hace la
  // «reproducción en segundo plano» de Brave. Solo afecta al marco de YouTube; la interfaz de Nsound no se toca.
  // Pantalla de bloqueo, Centro de control y cascos: iOS usa la sesión multimedia del marco que reproduce (el de YouTube), que por
  // defecto trae su título de página, «±10 s» y ninguna portada. Aquí se ignoran las llamadas del propio YouTube y se usa la sesión
  // con los datos y botones de Nsound: la página los envía por postMessage y los botones vuelven a ella igual.
  if (!window.__lsMsOwn) {
    window.__lsMsOwn = true;
    try {
      const P = window.MediaSession && window.MediaSession.prototype, ms = navigator.mediaSession;
      if (P && ms) {
        const origSet = P.setActionHandler, origPos = P.setPositionState;
        const md = Object.getOwnPropertyDescriptor(P, 'metadata'), ps = Object.getOwnPropertyDescriptor(P, 'playbackState');
        const toParent = (m) => { try { window.parent.postMessage(m, '*'); } catch (e) { /* sin página padre */ } };
        const diag = {};
        const report = () => toParent({ lsMsDiag: Object.assign({}, diag) });
        const handlers = () => {
          const bad = [];
          for (const a of ['play', 'pause', 'previoustrack', 'nexttrack']) { try { origSet.call(ms, a, () => toParent({ lsMsAction: a })); } catch (e) { bad.push(a + ':' + e.message); } }
          try { origSet.call(ms, 'seekto', (d) => toParent({ lsMsAction: 'seekto', seekTime: d && d.seekTime })); } catch (e) { bad.push('seekto:' + e.message); }
          for (const a of ['seekbackward', 'seekforward']) { try { origSet.call(ms, a, null); } catch (e) { bad.push(a + ':' + e.message); } }
          diag.botones = bad.length ? 'ERROR ' + bad.join(',') : 'ok';
        };
        P.setActionHandler = function () { /* las de YouTube se ignoran */ };
        P.setPositionState = function () { /* ídem */ };
        if (md) Object.defineProperty(P, 'metadata', { configurable: true, get() { return md.get.call(this); }, set() { /* ignorado */ } });
        if (ps) Object.defineProperty(P, 'playbackState', { configurable: true, get() { return ps.get.call(this); }, set() { /* ignorado */ } });
        handlers();
        window.addEventListener('message', (e) => {
          const d = e.data;
          if (!d || typeof d !== 'object') return;
          try {
            if (d.lsMedia && md) {
              md.set.call(ms, new MediaMetadata(d.lsMedia)); handlers();
              toParent({ lsMsAck: true });   // la página sabe que sus datos y botones ya están puestos
              const got = md.get.call(ms);
              diag.datos = got ? 'ok «' + String(got.title).slice(0, 18) + '»' : 'vacío';
              const art = d.lsMedia.artwork && d.lsMedia.artwork[0] && d.lsMedia.artwork[0].src;
              if (art) { diag.portada = 'cargando'; const im = new Image(); im.onload = () => { diag.portada = 'ok ' + im.naturalWidth + 'px'; report(); }; im.onerror = () => { diag.portada = 'ERROR al descargar'; report(); }; im.src = art; } else diag.portada = 'sin imagen';
              report();
            }
            if (d.lsMsState && ps) ps.set.call(ms, d.lsMsState);
            if (d.lsMsPos) origPos.call(ms, d.lsMsPos);
          } catch (err) { diag.datos = 'ERROR ' + err.message; report(); }
        });
        report();
        toParent({ lsMsHello: true });   // el marco ya está listo: la página (re)envía los datos de la canción
      }
    } catch (e) { /* si no se puede, queda como antes */ }
  }
  if (!window.__lsKeepAlive) {
    window.__lsKeepAlive = true;
    try {
      const fixed = (proto, name, value) => { try { Object.defineProperty(proto, name, { configurable: true, get: () => value }); } catch (e) { /* ya definido */ } };
      fixed(Document.prototype, 'hidden', false);
      fixed(Document.prototype, 'webkitHidden', false);
      fixed(Document.prototype, 'visibilityState', 'visible');
      fixed(Document.prototype, 'webkitVisibilityState', 'visible');
      const swallow = (e) => e.stopImmediatePropagation();
      ['visibilitychange', 'webkitvisibilitychange'].forEach((t) => { document.addEventListener(t, swallow, true); window.addEventListener(t, swallow, true); });
      document.hasFocus = () => true;
    } catch (e) { /* si el navegador no lo permite, queda como antes */ }
  }
  if (window.__lsEqInstalled) return;
  window.__lsEqInstalled = true;

  const freqs = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  let ctx = null, source = null, filters = [], analyser = null, attached = false, routed = null;   // routed: 'eq' | 'bypass'
  let swaps = 0, attachedVideo = null; const hooked = new WeakSet();   // el <video> enganchado ahora y los que ya tuvieron fuente (solo se permite una por elemento)
  let gains = new Array(10).fill(0), enabled = false, levelBuf = null;

  // Un <video> solo admite UN createMediaElementSource en toda su vida y no se puede deshacer: una vez enganchado, el audio pasa siempre por el
  // AudioContext. Lo que sí se puede es elegir el camino: con el ecualizador APAGADO el sonido va directo de la fuente a la salida (sin 10 filtros
  // ni analizador procesando en vacío, que era lo que calentaba), y con él ENCENDIDO pasa por los filtros.
  function route(mode) {
    if (!attached || routed === mode) return;
    try {
      source.disconnect();
      filters.forEach((f) => f.disconnect());
      analyser.disconnect();
      if (mode === 'eq') {
        let node = source;
        filters.forEach((f) => { node.connect(f); node = f; });
        node.connect(analyser);
        analyser.connect(ctx.destination);
      } else {
        source.connect(ctx.destination);
      }
      routed = mode;
    } catch (e) { window.__lsEqError = String(e); }
  }

  function apply() {
    if (!attached) return;
    filters.forEach((f, i) => { f.gain.value = gains[i]; });
    route(enabled ? 'eq' : 'bypass');
  }

  // El <video> que suena: YouTube puede cambiarlo (otra canción, un anuncio, recarga del reproductor). Si el ecualizador se quedaba enganchado al
  // elemento VIEJO, el nuevo sonaba directo y el ecualizador «no hacía nada». Se busca siempre el que está sonando, o el primero.
  function currentVideo() {
    const all = document.querySelectorAll('video');
    for (let i = 0; i < all.length; i++) if (!all[i].paused && all[i].isConnected !== false) return all[i];
    return all.length ? all[0] : null;
  }

  // Solo se engancha al <video> cuando el usuario activa el ecualizador: así no se toca el audio de otro modo.
  // Un <video> admite UNA sola fuente en su vida; el contexto y los filtros se reutilizan al cambiar de elemento.
  function attach(video) {
    if (!video || video === attachedVideo || hooked.has(video)) return;
    try {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });   // «playback»: buffers grandes, menos CPU y menos calor
        filters = freqs.map((hz, i) => {
          const f = ctx.createBiquadFilter();
          f.type = i === 0 ? 'lowshelf' : (i === freqs.length - 1 ? 'highshelf' : 'peaking');
          f.frequency.value = hz;
          f.Q.value = 1.1;
          f.gain.value = 0;
          return f;
        });
        analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        levelBuf = new Uint8Array(analyser.frequencyBinCount);
      }
      const next = ctx.createMediaElementSource(video);
      hooked.add(video);
      if (source) { try { source.disconnect(); } catch (e) { /* ya suelto */ } }   // el elemento viejo deja de alimentar la cadena
      source = next;
      if (attachedVideo) swaps++;
      attachedVideo = video;
      attached = true;
      routed = null;
      source.connect(ctx.destination);      // hasta decidir el camino, el sonido nunca queda mudo
      apply();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) {
      window.__lsEqError = String(e);
    }
  }

  function level() {
    if (!analyser || routed !== 'eq') return 0;
    analyser.getByteFrequencyData(levelBuf);
    let t = 0; for (let i = 0; i < levelBuf.length; i++) t += levelBuf[i];
    return t / levelBuf.length;
  }

  window.__lsEq = (g, on) => {
    gains = Array.isArray(g) ? g.map(Number) : gains;
    enabled = !!on;
    if (enabled) attach(currentVideo());
    apply();
  };

  window.__lsEqStatus = () => JSON.stringify({
    attached, routed, state: ctx ? ctx.state : null, videoSwaps: swaps, level: level(), error: window.__lsEqError || null
  });

  // Órdenes desde la página que contiene el iframe (iOS y Android)
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.lsEq) window.__lsEq(d.lsEq.gains, d.lsEq.on);
    if (d.lsEqStatusReq && e.source) e.source.postMessage({ lsEqStatus: JSON.parse(window.__lsEqStatus()) }, '*');
  });

  // Nivel para el visualizador: solo con el ecualizador ENCENDIDO, sonando y 8 veces por segundo (antes 10, aunque estuviera apagado)
  setInterval(() => {
    if (!attached || routed !== 'eq' || !ctx || ctx.state !== 'running' || window.parent === window) return;
    const v = attachedVideo;
    if (!v || v.paused) return;
    try { window.parent.postMessage({ lsLevel: Math.min(1, level() / 255) }, '*'); } catch (e) { /* sin página padre */ }
  }, 125);

  // Mantenimiento: engancha si hace falta y reanuda el contexto si el sistema lo suspendió
  setInterval(() => {
    if (enabled) {                                   // si YouTube cambió de <video>, se engancha al nuevo
      const v = currentVideo();
      if (v && v !== attachedVideo) attach(v);
    }
    if (attached && ctx && ctx.state === 'suspended') ctx.resume();
  }, 1000);
})();
