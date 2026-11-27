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
  let ctx = null, filters = [], analyser = null, source = null, attachedVideo = null, swaps = 0, levelBuf = null;
  const sources = new WeakMap();   // <video> → su fuente: cada elemento solo admite UNA en toda su vida
  let gains = new Array(10).fill(0), enabled = false;
  let path = null, bands = 0, measuring = false;   // camino montado, filtros que usa y si el analizador cuelga de él
  let wantLevel = false, probeUntil = 0;           // el nivel solo se mide si la página lo pide o si alguien acaba de consultar el estado
  let watchTimer = 0, levelTimer = 0;

  // Hay algo que procesar solo con el ecualizador encendido y alguna banda movida: «Plano» no toca el sonido.
  const wanted = () => enabled && gains.some((g) => g !== 0);
  const running = () => !!ctx && ctx.state === 'running';
  function resume() {
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    try { const p = ctx.resume(); if (p && p.catch) p.catch(() => { /* el sistema no deja todavía: se reintenta */ }); } catch (e) { /* ídem */ }
  }

  // Con el ecualizador APAGADO el sonido va directo de la fuente a la salida; ENCENDIDO pasa solo por los filtros de las bandas movidas
  // (los demás no harían nada salvo gastar batería). El analizador cuelga aparte y solo mientras se mide el nivel.
  function route() {
    if (!source) return;
    const active = wanted() ? freqs.map((_, i) => i).filter((i) => gains[i] !== 0) : [];
    const measure = active.length > 0 && (wantLevel || Date.now() < probeUntil);
    const key = active.join(',') + (measure ? '+nivel' : '');
    if (key === path) return;
    try {
      source.disconnect();
      filters.forEach((f) => f.disconnect());
      let node = source;
      active.forEach((i) => { node.connect(filters[i]); node = filters[i]; });
      node.connect(ctx.destination);
      if (measure) node.connect(analyser);
      path = key; bands = active.length; measuring = measure;
    } catch (e) {
      window.__lsEqError = String(e);
      path = null; bands = 0; measuring = false;
      try { source.connect(ctx.destination); } catch (e2) { /* ya conectada */ }
    }
  }

  // El <video> que suena: YouTube puede cambiarlo (otra canción, un anuncio, recarga del reproductor). Se busca el que está sonando, o el primero.
  function currentVideo() {
    const all = document.querySelectorAll('video');
    for (let i = 0; i < all.length; i++) if (!all[i].paused && all[i].isConnected !== false) return all[i];
    return all.length ? all[0] : null;
  }

  function createChain() {
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });   // «playback»: buffers grandes, menos CPU y menos calor
    ctx.onstatechange = () => { if (running()) apply(); else if (attachedVideo && !attachedVideo.paused) resume(); };
    filters = freqs.map((hz, i) => {
      const f = ctx.createBiquadFilter();
      f.type = i === 0 ? 'lowshelf' : (i === freqs.length - 1 ? 'highshelf' : 'peaking');
      f.frequency.value = hz;
      f.Q.value = 1.1;
      f.gain.value = gains[i];
      return f;
    });
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    levelBuf = new Uint8Array(analyser.frequencyBinCount);
  }

  // Solo se engancha al <video> cuando hay algo que procesar, y solo con el procesador de audio ya en marcha: enganchado a uno parado,
  // el vídeo se quedaría MUDO. Mientras no arranque, YouTube suena como siempre y se reintenta.
  function attach(video) {
    if (!video || video === attachedVideo) return;
    try {
      if (!ctx) createChain();
      if (!running()) { resume(); if (!running()) return; }
      // En iPhone (iOS 16.4 o posterior) se declara reproducción de música, para que el sistema no la trate como un efecto de la página
      try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch (e) { /* sin esa función */ }
      let next = sources.get(video);
      if (!next) { next = ctx.createMediaElementSource(video); sources.set(video, next); }
      if (source) {                       // el elemento anterior queda sonando directo, por si YouTube vuelve a usarlo
        source.disconnect();
        source.connect(ctx.destination);
        swaps++;
      }
      source = next;
      attachedVideo = video;
      source.disconnect();
      source.connect(ctx.destination);    // hasta montar el camino, el sonido nunca queda mudo
      path = null;
      route();
    } catch (e) {
      window.__lsEqError = String(e);
    }
  }

  function level() {
    if (!measuring) return 0;
    analyser.getByteFrequencyData(levelBuf);
    let t = 0; for (let i = 0; i < levelBuf.length; i++) t += levelBuf[i];
    return t / levelBuf.length;
  }

  // Nivel para el visualizador: 8 veces por segundo, solo si la página lo pide y suena
  function sendLevel() {
    if (!running() || !attachedVideo || attachedVideo.paused) return;
    try { window.parent.postMessage({ lsLevel: Math.min(1, level() / 255) }, '*'); } catch (e) { /* sin página padre */ }
  }

  // Vigilancia, una vez por segundo: engancha lo que falte y reanuda el contexto si el sistema lo suspendió
  function watch() {
    if (wanted()) attach(currentVideo());
    if (source) { resume(); route(); }
    sync();
  }

  // Los temporizadores solo existen mientras hacen falta: sin ecualizador no se ejecuta nada
  function sync() {
    const needWatch = wanted() || !!source;
    if (needWatch && !watchTimer) watchTimer = setInterval(watch, 1000);
    if (!needWatch && watchTimer) { clearInterval(watchTimer); watchTimer = 0; }
    const needLevel = wantLevel && wanted() && !!source && window.parent !== window;
    if (needLevel && !levelTimer) levelTimer = setInterval(sendLevel, 125);
    if (!needLevel && levelTimer) { clearInterval(levelTimer); levelTimer = 0; }
  }

  function apply() {
    filters.forEach((f, i) => { f.gain.value = gains[i]; });
    if (wanted()) attach(currentVideo());
    route();
    sync();
  }

  // Al empezar a sonar un <video> se engancha al momento, sin esperar a la vigilancia (estos avisos solo se ven «capturándolos»)
  document.addEventListener('playing', (e) => {
    const v = e.target;
    if (!v || v.tagName !== 'VIDEO' || (!wanted() && !source)) return;
    if (wanted()) attach(v);
    resume();
    sync();
  }, true);

  window.__lsEq = (g, on, measure) => {
    if (Array.isArray(g)) gains = freqs.map((_, i) => { const v = Number(g[i]); return Number.isFinite(v) ? Math.max(-12, Math.min(12, v)) : 0; });
    enabled = !!on;
    if (measure !== undefined) wantLevel = !!measure;
    apply();
  };

  // routed: 'eq' (pasa por los filtros) o 'bypass' (directo). Consultarlo activa unos segundos la medida del nivel.
  window.__lsEqStatus = () => {
    probeUntil = Date.now() + 5000;
    route();
    return JSON.stringify({
      attached: !!source, routed: source ? (bands > 0 ? 'eq' : 'bypass') : null, bands, flat: !gains.some((g) => g !== 0),
      state: ctx ? ctx.state : null, videoSwaps: swaps, level: level(), error: window.__lsEqError || null,
    });
  };

  // Órdenes desde la página que contiene el iframe (iOS y Android)
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.lsEq) window.__lsEq(d.lsEq.gains, d.lsEq.on, d.lsEq.level);
    if (typeof d.lsEqLevel === 'boolean') { wantLevel = d.lsEqLevel; route(); sync(); }
    if (d.lsEqStatusReq && e.source) e.source.postMessage({ lsEqStatus: JSON.parse(window.__lsEqStatus()) }, '*');
  });
})();
