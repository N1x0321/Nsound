/* EXPERIMENTO (solo la app de iPhone «Nsound Motores»): interfaces de motores y proveedores + EngineRouter.
   Sin DOM: se prueba con Node. Con LS.enginesEnabled apagado (por defecto) no se usa nada de esto y Player es el de siempre. */
var LS = globalThis.LS = globalThis.LS || {};
(function (LS) {
  'use strict';

  // Interruptor: solo lo enciende la app de iPhone de pruebas (ios/ inyecta window.__LS_ENGINES__ = true según el bundle id)
  LS.enginesEnabled = !!(typeof window !== 'undefined' && window.__LS_ENGINES__ === true);

  /** Evento normalizado: { type:'state'|'progress'|'track'|'ended'|'error', state?:'idle'|'loading'|'playing'|'paused',
   *  position?, duration?, track?, error?:{code,message,recoverable}, raw? } */
  class PlaybackEngineAdapter {
    constructor() { this._subs = []; }
    get id() { throw new Error('id no implementado'); }
    get capabilities() { return { seek: true, volume: true, eq: false, crossfade: false, offline: false, background: true, needsLogin: false }; }
    canPlay(/* track */) { return false; }
    async prepare(/* track */) {}
    async play(/* track, opts */) { throw new Error('play no implementado'); }
    async pause() {}
    async resume() {}
    async seek(/* seconds */) {}
    async setVolume(/* v */) {}
    async stop() {}
    on(handler) { this._subs.push(handler); return () => { this._subs = this._subs.filter((h) => h !== handler); }; }
    _emit(evt) { this._subs.slice().forEach((h) => { try { h(evt); } catch (e) { /* un oyente roto no debe afectar a los demás */ } }); }
  }

  /** Fuentes sin DRM que dan una URL reproducible (aún sin implementaciones). */
  class StreamProvider {
    get id() { throw new Error('id no implementado'); }
    async search(/* query */) { return []; }
    async resolve(/* track */) { throw new Error('resolve no implementado'); }
    async metadata(/* ref */) { return null; }
  }

  // Envuelve el reproductor actual (LS.Player): su API y sus eventos de siempre se traducen a eventos normalizados.
  class RawPlayerEngine extends PlaybackEngineAdapter {
    constructor(raw, engineId, accepts) {
      super();
      this.raw = raw; this._id = engineId; this._accepts = accepts;
      raw.on('state', (s) => {
        this._emit({ type: 'state', state: s.playing ? 'playing' : 'paused', position: s.time, duration: s.duration, raw: s });
        this._emit({ type: 'progress', position: s.time, duration: s.duration });
      });
      raw.on('ended', () => this._emit({ type: 'ended' }));
      raw.on('error', (e) => this._emit({ type: 'error', error: { code: e && e.code, message: e && e.message, recoverable: true }, raw: e }));
    }
    get id() { return this._id; }
    canPlay(track) { return !!track && this._accepts(track); }
    async prepare(track) { if (typeof this.raw.prepare === 'function') this.raw.prepare(track); }   // precarga lógica de la siguiente (miniatura)
    async play(track, opts) { return this.raw.load(track, opts); }
    async pause() { this.raw.pause(); }
    async resume() { this.raw.play(); }
    async seek(s) { this.raw.seek(s); }
    async setVolume(v) { this.raw.setVolume(v); }
    async stop() { this.raw.pause(); }
  }
  class YouTubeEngine extends RawPlayerEngine {
    constructor(raw) { super(raw, 'yt', (t) => t.src === 'yt'); }
  }
  class Html5Engine extends RawPlayerEngine {
    constructor(raw) { super(raw, 'html5', (t) => t.src !== 'yt'); }
  }

  class EngineRouter {
    constructor(engines) {
      this.engines = new Map();
      this.current = null;
      this._subs = [];
      (engines || []).forEach((e) => this.register(e));
    }
    /** first=true coloca el motor delante de los demás (el primero que diga canPlay gana). */
    register(engine, first) {
      if (first) { const rest = [...this.engines.entries()]; this.engines = new Map([[engine.id, engine]].concat(rest)); }
      else this.engines.set(engine.id, engine);
      // Solo se reenvían los eventos del motor activo (solo suena uno a la vez)
      engine.on((evt) => { if (engine === this.current) this._dispatch(evt); });
    }
    /** Fuerza el motor activo por id; false si no existe (no cambia nada). */
    setEngine(id) {
      const e = this.engines.get(id);
      if (!e) return false;
      if (this.current && this.current !== e) this.current.stop();
      this.current = e;
      return true;
    }
    pick(track, opts) { for (const e of this.engines.values()) if (e.canPlay(track, opts)) return e; return null; }
    /** Elige motor por pista. false (y evento de error) si ninguno sabe reproducirla. */
    async play(track, opts) {
      const e = this.pick(track, opts);
      if (!e) {
        this._dispatch({ type: 'error', error: { code: 'noengine', message: 'Ningún motor sabe reproducir esta pista', recoverable: false } });
        return false;
      }
      if (this.current && this.current !== e) await this.current.stop();
      this.current = e;
      this._dispatch({ type: 'track', track });
      await e.play(track, opts);
      return true;
    }
    on(handler) { this._subs.push(handler); return () => { this._subs = this._subs.filter((h) => h !== handler); }; }
    _dispatch(evt) { this._subs.slice().forEach((h) => { try { h(evt); } catch (e) { console.error(e); } }); }
  }

  /** Fachada con la misma API que LS.Player (on('state'|'ended'|'error'|'eqstatus'), load, play...), pero pasando por el router. */
  function wrap(raw) {
    const router = new EngineRouter([new YouTubeEngine(raw), new Html5Engine(raw)]);
    const subs = {};
    const emit = (evt, data) => (subs[evt] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });
    let lastVolume = null;
    router.on((e) => {
      if (e.type === 'state') emit('state', e.raw);
      else if (e.type === 'ended') emit('ended', e.queueEnd ? { queueEnd: true } : undefined);   // queueEnd: la cola del motor llegó al final
      else if (e.type === 'queueTrack') emit('track', e);                                          // la cola del motor pasó sola a otra pista
      else if (e.type === 'error') emit('error', e.raw || { code: e.error.code, message: e.error.message });
    });
    raw.on('eqstatus', (d) => emit('eqstatus', d));
    const facade = {
      router,
      on(evt, fn) { (subs[evt] = subs[evt] || []).push(fn); },
      init: () => raw.init(),
      state: () => (router.current && typeof router.current.snapshot === 'function' ? router.current.snapshot() : raw.state()),
      mode: () => raw.mode(),
      load: (item, o) => router.play(item, o),
      /** Precarga lógica de la pista siguiente en el motor que la reproduciría (solo con los motores encendidos). */
      prepare: (item, o) => { const e = router.pick(item, o); return e ? e.prepare(item, o) : undefined; },
      /** Con el modo experimental, la cola del motor manda en siguiente/anterior/fin de pista. */
      ownsQueue: () => !!(router.current && typeof router.current.ownsQueue === 'function' && router.current.ownsQueue()),
      syncQueue: (q) => (router.current && typeof router.current.syncQueue === 'function' ? router.current.syncQueue(q) : false),
      next() { return this.ownsQueue() ? router.current.next() : false; },
      prev() { return this.ownsQueue() ? router.current.prev() : false; },
      play() { if (router.current) router.current.resume(); },
      pause() { if (router.current) router.current.pause(); },
      toggle() { raw.state().playing ? this.pause() : this.play(); },
      seek(t) { if (router.current) router.current.seek(t); },
      setVolume: (v) => { lastVolume = v; raw.setVolume(v); if (router.current && router.current.id !== 'yt' && router.current.id !== 'html5') router.current.setVolume(v); },
      volume: () => lastVolume,
      setEq: (g, en) => raw.setEq(g, en),
      eqStatus: () => raw.eqStatus(),
    };
    LS.engines.current = facade;          // para que el arranque experimental pueda registrar motores nuevos
    return facade;
  }

  LS.engines = { PlaybackEngineAdapter, StreamProvider, YouTubeEngine, Html5Engine, EngineRouter, wrap };
})(LS);
if (typeof module !== 'undefined' && module.exports) module.exports = LS;
