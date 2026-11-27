/* Ajustes → «Música en segundo plano (Android)» y su aviso inicial.
   El puente (NativeBridge.kt) ya entrega objetos y cadenas decodificadas: no hay que pasar sus respuestas por JSON.parse. */
var LS = globalThis.LS = globalThis.LS || {};
(function (LS) {
  'use strict';

  const HINT_KEY = 'ls.bgHint';

  /** `call` es Native.call; `$`, `esc`, `toast` y `storage` los pone la interfaz. */
  LS.createBgPanel = function ({ call, $, esc, toast, storage }) {
    const action = async (name, okMsg) => {
      try {
        const r = await call(name, {});
        toast(r === 'ninguna' ? 'No se pudo abrir esa pantalla en tu móvil: ve a Ajustes → Aplicaciones → Nsound.' : okMsg(r), 6000);
      } catch (e) { toast('No se pudo abrir: ' + e.message, 5000); }
    };

    return {
      /** Datos del móvil, estado de la restricción de batería y pasos según el fabricante. */
      async refresh() {
        const info = $('#bgInfo'), steps = $('#bgSteps');
        if (!info) return;
        try {
          const b = await call('batteryInfo', {});
          const guide = LS.bgSteps(b.manufacturer, b.brand);
          if (!$('#bgInfo')) return;
          info.innerHTML = `<b>${esc(b.manufacturer)} ${esc(b.model)}</b> · Android ${esc(b.release)} · Restricción de batería: <b>${b.ignoring ? 'quitada ✓' : 'activa (puede cerrar la música en segundo plano)'}</b>`;
          steps.innerHTML = `<b>Pasos para ${esc(guide.name)}</b> (orientativos; cambian según el modelo):<br>${guide.steps.map((t, i) => `${i + 1}. ${esc(t)}`).join('<br>')}`;
        } catch (e) { info.textContent = 'No se pudo leer la información del móvil.'; }
      },
      battery: () => action('batteryRequest', (r) => r === 'peticion' ? 'Pulsa «Permitir» en el aviso del sistema.' : 'Busca Nsound en la lista y elige «Sin restricciones».'),
      autostart: () => action('autostartSettings', (r) => r === 'fabricante' ? 'Activa Nsound en esa pantalla.' : 'No hay pantalla de inicio automático en tu móvil: se abrieron los ajustes de la app (Batería → Sin restricciones).'),
      appSettings: () => action('appSettings', () => 'En Batería, elige «Sin restricciones».'),
      async report() {
        try {
          const text = await call('bgReport', {});
          const el = $('#bgReport');
          if (!el) return;
          el.value = text; el.style.display = 'block'; $('#bgCopy').style.display = ''; el.scrollTop = el.scrollHeight;
        } catch (e) { toast('No se pudo generar el informe: ' + e.message, 5000); }
      },
      /** Aviso, una sola vez, si Android sigue restringiendo la batería de Nsound. */
      async hint() {
        try {
          const b = await call('batteryInfo', {});
          let seen = false; try { seen = storage.getItem(HINT_KEY) === '1'; } catch (e) { /* sin almacenamiento */ }
          if (!b.ignoring && !seen) {
            try { storage.setItem(HINT_KEY, '1'); } catch (e) { /* ya */ }
            toast('Para que suene con la pantalla apagada, revisa Ajustes → Música en segundo plano.', 9000);
          }
        } catch (e) { /* sin datos no se avisa */ }
      },
    };
  };
})(LS);
if (typeof module !== 'undefined' && module.exports) module.exports = LS;
