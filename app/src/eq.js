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
  if (!window.__lsInstantResume) {
    window.__lsInstantResume = true;
    let userPaused = true;                 // hasta que la página diga que suena, no se fuerza nada
    let tries = [];                        // máximo 4 reanudaciones cada 5 s: si el sistema insiste (llamada, otra app), no se pelea
    window.addEventListener('message', (e) => { const d = e.data; if (d && typeof d === 'object' && 'lsUserPause' in d) userPaused = !!d.lsUserPause; });
    const hook = (v) => {
      if (v.__lsHooked) return;
      v.__lsHooked = true;
      v.addEventListener('pause', () => {
        if (userPaused || v.ended || (v.duration && v.currentTime >= v.duration - 1)) return;
        const now = Date.now();
        tries = tries.filter((t) => now - t < 5000);
        if (tries.length >= 4) return;
        tries.push(now);
        try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch (err) { /* sin permiso */ }
      }, true);
    };
    setInterval(() => { const v = document.querySelector('video'); if (v) hook(v); }, 400);
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
  let ctx = null, filters = [], analyser = null, attached = false;
  let gains = new Array(10).fill(0), enabled = false;

  function apply() {
    if (!attached) return;
    filters.forEach((f, i) => { f.gain.value = enabled ? gains[i] : 0; });
  }

  // Solo se engancha al <video> cuando el usuario activa el ecualizador: así no se toca el audio de otro modo.
  function attach(video) {
    if (attached) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const source = ctx.createMediaElementSource(video);
      filters = freqs.map((hz, i) => {
        const f = ctx.createBiquadFilter();
        f.type = i === 0 ? 'lowshelf' : (i === freqs.length - 1 ? 'highshelf' : 'peaking');
        f.frequency.value = hz;
        f.Q.value = 1.1;
        f.gain.value = 0;
        return f;
      });
      let node = source;
      filters.forEach(f => { node.connect(f); node = f; });
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      node.connect(analyser);
      analyser.connect(ctx.destination);
      attached = true;
      apply();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) {
      window.__lsEqError = String(e);
    }
  }

  function level() {
    if (!analyser) return 0;
    const d = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(d);
    return d.reduce((a, b) => a + b, 0) / d.length;
  }

  window.__lsEq = (g, on) => {
    gains = Array.isArray(g) ? g.map(Number) : gains;
    enabled = !!on;
    if (enabled && !attached) {
      const v = document.querySelector('video');
      if (v) attach(v);
    }
    apply();
  };

  window.__lsEqStatus = () => JSON.stringify({
    attached, state: ctx ? ctx.state : null, level: level(), error: window.__lsEqError || null
  });

  // Órdenes desde la página que contiene el iframe (iOS y Android)
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.lsPip) {
      const out = [], v = document.querySelector('video');
      const say = (t) => { out.push(t); };
      if (!v) say('sin elemento de vídeo');
      else {
        try { v.disablePictureInPicture = false; say('PiP no bloqueado'); } catch (err) { say('no se pudo desbloquear'); }
        try { if ('autoPictureInPicture' in v || true) { v.autoPictureInPicture = true; say('PiP automático pedido'); } } catch (err) { say('sin PiP automático'); }
        say('API estándar: ' + (document.pictureInPictureEnabled === true ? 'sí' : 'no') + ' · iOS: ' + (typeof v.webkitSupportsPresentationMode === 'function' && v.webkitSupportsPresentationMode('picture-in-picture') ? 'sí' : 'no'));
        const done = () => { try { e.source && e.source.postMessage({ lsPipResult: out.join(' · ') }, '*'); } catch (err) { /* sin página padre */ } };
        let p = null;
        try { if (typeof v.requestPictureInPicture === 'function') p = v.requestPictureInPicture(); } catch (err) { say('petición estándar: ' + err.name); }
        if (p && p.then) p.then(() => { say('PiP ACTIVADO'); done(); }, (err) => { say('petición estándar rechazada: ' + err.name); tryWebkit(); });
        else tryWebkit();
        function tryWebkit() {
          try { if (typeof v.webkitSetPresentationMode === 'function') { v.webkitSetPresentationMode('picture-in-picture'); say('modo iOS pedido (' + v.webkitPresentationMode + ')'); } } catch (err) { say('modo iOS: ' + err.name); }
          done();
        }
        return;
      }
      try { e.source && e.source.postMessage({ lsPipResult: out.join(' · ') }, '*'); } catch (err) { /* nada */ }
    }
    if (d.lsEq) window.__lsEq(d.lsEq.gains, d.lsEq.on);
    if (d.lsEqStatusReq && e.source) e.source.postMessage({ lsEqStatus: JSON.parse(window.__lsEqStatus()) }, '*');
  });

  // Con el ecualizador activo ya hay un analizador: se envía el nivel a la página (10 veces por segundo, solo si suena)
  setInterval(() => {
    if (!attached || !ctx || ctx.state !== 'running' || window.parent === window) return;
    const v = document.querySelector('video');
    if (!v || v.paused) return;
    try { window.parent.postMessage({ lsLevel: Math.min(1, level() / 255) }, '*'); } catch (e) { /* sin página padre */ }
  }, 100);

  setInterval(() => {
    if (enabled && !attached) {
      const v = document.querySelector('video');
      if (v) attach(v);
    }
    if (enabled && ctx && ctx.state === 'suspended') ctx.resume();
  }, 1000);
})();
