// PRUEBA TEMPORAL (se quita después): ecualizador en un emulador de Android, hablando con el WebView por DevTools.
// Mide: si el sonido pasa por el ecualizador, si la música sigue fuera de la app y con la pantalla apagada, consumo de CPU y la vuelta atrás.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const PKG = 'org.librestream.app', OUT = 'eq-out';
mkdirSync(OUT, { recursive: true });
const adb = (...a) => execFileSync('adb', a, { encoding: 'utf8', timeout: 90000, maxBuffer: 50e6 });
const sh = (c) => { try { return adb('shell', c); } catch (e) { return String(e.stdout || ''); } };
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const lines = [];
const log = (...m) => { const t = m.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); console.log(t); lines.push(t); writeFileSync(`${OUT}/resultado.txt`, lines.join('\n') + '\n'); };
const shot = (name) => { try { writeFileSync(`${OUT}/${name}.png`, execFileSync('adb', ['exec-out', 'screencap', '-p'], { timeout: 60000, maxBuffer: 30e6 })); } catch (e) { log('captura fallida', name); } };

function cdp(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0; const waiting = new Map(), contexts = new Map();
    ws.onerror = (e) => reject(new Error('websocket: ' + (e.message || 'error')));
    ws.onclose = () => { for (const w of waiting.values()) w.reject(new Error('conexión cerrada')); waiting.clear(); };
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id) { const w = waiting.get(d.id); waiting.delete(d.id); if (w) d.error ? w.reject(new Error(d.error.message)) : w.resolve(d.result); }
      if (d.method === 'Runtime.executionContextCreated') contexts.set(d.params.context.id, d.params.context);
      if (d.method === 'Runtime.executionContextDestroyed') contexts.delete(d.params.executionContextId);
      if (d.method === 'Runtime.executionContextsCleared') contexts.clear();
    };
    const send = (method, params) => new Promise((res, rej) => {
      const n = ++id; waiting.set(n, { resolve: res, reject: rej });
      ws.send(JSON.stringify({ id: n, method, params }));
      setTimeout(() => { if (waiting.delete(n)) rej(new Error('sin respuesta a ' + method)); }, 20000);
    });
    const evaluate = async (expression, contextId) => {
      const r = await send('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    ws.onopen = async () => { await send('Runtime.enable', {}); resolve({ send, evaluate, contexts, close: () => ws.close() }); };
  });
}

let page, frameConn = null, frameId = '';
const targets = async () => (await fetch('http://127.0.0.1:9222/json/list')).json();
const isYT = (u) => /^https:\/\/www\.youtube(-nocookie)?\.com/.test(u || '');

async function connect() {
  const pid = sh(`pidof ${PKG}`).trim().split(/\s+/)[0];
  adb('forward', 'tcp:9222', `localabstract:webview_devtools_remote_${pid}`);
  const list = await targets();
  log('destinos:', list.map((t) => `${t.type} ${t.url.slice(0, 60)}`));
  page = await cdp(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
}

/** Ejecuta en el marco de YouTube (sea un contexto de la página o un destino aparte). */
async function inFrame(expression) {
  const separate = (await targets()).filter((t) => t.type === 'iframe' && isYT(t.url));
  if (separate.length) {
    const t = separate[separate.length - 1];
    if (t.id !== frameId) { frameConn?.close(); frameConn = await cdp(t.webSocketDebuggerUrl); frameId = t.id; }
    return frameConn.evaluate(expression);
  }
  const ctx = [...page.contexts.values()].filter((c) => isYT(c.origin) && c.auxData?.isDefault);
  if (!ctx.length) throw new Error('no hay marco de YouTube');
  return page.evaluate(expression, ctx[ctx.length - 1].id);
}

const VIDEO = `(() => { const all = [...document.querySelectorAll('video')]; const v = all.find((x) => !x.paused) || all[0];
  return { videos: all.length, paused: v ? v.paused : null, t: v ? Math.round(v.currentTime * 10) / 10 : null, propio: !!(v && v.dataset.prueba), eqjs: !!window.__lsEqStatus }; })()`;
const video = () => inFrame(VIDEO).catch((e) => ({ error: e.message }));
const eqStatus = () => inFrame('JSON.parse(window.__lsEqStatus())').catch((e) => ({ error: e.message }));
const advancing = async (secs = 6) => { const a = await video(); await sleep(secs); const b = await video(); return { de: a.t, a: b.t, paused: b.paused, ok: b.t > a.t + secs / 2 }; };

// Tono con ruido dentro del marco de YouTube, por si YouTube no sirve vídeo a las máquinas de GitHub
const SYNTH = `(() => { const rate = 8000, secs = 900, n = rate * secs, buf = new Uint8Array(44 + n), dv = new DataView(buf.buffer);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) buf[o + i] = t.charCodeAt(i); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true); dv.setUint32(24, rate, true); dv.setUint32(28, rate, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true); str(36, 'data'); dv.setUint32(40, n, true);
  for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round(40 * Math.sin(i * 2 * Math.PI * 220 / rate) + (Math.random() * 30 - 15));
  document.querySelectorAll('video').forEach((x) => x.pause());
  const v = document.createElement('video'); v.dataset.prueba = '1'; v.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  v.setAttribute('playsinline', ''); document.body.appendChild(v); return v.play().then(() => 'sonando', (e) => 'error ' + e.message); })()`;

/** CPU gastada por la app, el motor web y el servidor de audio, en % de un núcleo. */
async function cpu(secs = 40) {
  const ticks = () => sh('ps -A -o PID,NAME').split('\n').map((l) => l.trim().split(/\s+/))
    .filter(([, n]) => n && /librestream|webview|sandboxed|audioserver/i.test(n))
    .reduce((sum, [pid]) => { const f = sh(`cat /proc/${pid}/stat`).split(') ')[1]?.split(' '); return sum + (f ? Number(f[11]) + Number(f[12]) : 0); }, 0);
  const a = ticks(), t0 = Date.now(); await sleep(secs); const b = ticks();
  return Math.round(((b - a) / 100) / ((Date.now() - t0) / 1000) * 1000) / 10;
}

async function background(label) {
  const a = await video();
  adb('shell', 'input', 'keyevent', '3'); await sleep(45);
  const b = await video(), sb = await eqStatus();
  log(`[${label}] fuera de la app 45 s: tiempo ${a.t} -> ${b.t} · pausado ${b.paused} · eq ${sb.attached ? sb.routed + ' ' + sb.state + ' nivel ' + Math.round(sb.level) : 'sin enganchar'}`);
  await sleep(3); const sb2 = await eqStatus(); if (sb2.attached) log(`[${label}]   nivel en segundo plano (2.ª lectura): ${Math.round(sb2.level)} estado ${sb2.state}`);
  adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`); await sleep(8);
  const c = await video();
  adb('shell', 'input', 'keyevent', '223'); await sleep(45);
  const d = await video(), sd = await eqStatus();
  log(`[${label}] pantalla apagada 45 s: tiempo ${c.t} -> ${d.t} · pausado ${d.paused} · eq ${sd.attached ? sd.routed + ' ' + sd.state : 'sin enganchar'}`);
  adb('shell', 'input', 'keyevent', '224'); adb('shell', 'input', 'keyevent', '82'); await sleep(2);
  adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`); await sleep(8);
  const bg = sh(`run-as ${PKG} cat files/bglog.txt`).split('\n').filter((l) => /reanud|pausa/i.test(l)).slice(-4);
  if (bg.length) log(`[${label}] registro de segundo plano:`, bg);
}

const setEq = (on, preset) => page.evaluate(`(async () => { location.hash = '#/settings'; await new Promise((r) => setTimeout(r, 1500));
  const c = document.getElementById('eqOn'); if (!c) return 'NO HAY ecualizador en Ajustes';
  if (${JSON.stringify(preset || '')}) { const p = document.getElementById('eqPreset'); p.value = ${JSON.stringify(preset || '')}; p.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((r) => setTimeout(r, 500)); }
  const c2 = document.getElementById('eqOn'); c2.checked = ${!!on}; c2.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; })()`);

async function main() {
  log('WebView:', sh('dumpsys webviewupdate').split('\n').find((l) => /Current WebView/.test(l))?.trim() || '?');
  adb('install', '-r', 'android/app/build/outputs/apk/debug/app-debug.apk');
  sh(`pm grant ${PKG} android.permission.POST_NOTIFICATIONS`);
  adb('logcat', '-c');
  adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`, '--es', 'route', 'music');
  await sleep(35); await connect();
  log('canción pulsada:', await page.evaluate(`(() => { const c = document.querySelector('.card'); if (!c) return 'sin tarjetas'; c.click(); return c.textContent.trim().slice(0, 60); })()`));
  await sleep(30);
  let play = await advancing().catch((e) => ({ ok: false, error: e.message }));
  log('reproducción de YouTube:', play, await video());
  let mode = 'YouTube';
  if (!play.ok) {
    mode = 'sonido de prueba dentro del marco de YouTube';
    log('YouTube no avanza aquí; se usa', mode, '->', await inFrame(SYNTH).catch((e) => e.message));
    await sleep(8); log('avanza:', await advancing());
  }
  log('MODO:', mode);

  log('--- A. ecualizador apagado');
  log('estado:', await eqStatus()); await sleep(8);
  log('CPU apagado (% de un núcleo):', await cpu(), await video());
  await background('apagado');

  log('--- B. ecualizador en Rock');
  if (mode !== 'YouTube') log((await advancing()).ok ? 'sigue sonando' : 'parado');
  log('activar:', await setEq(true, 'Rock')); await sleep(6);
  log('estado:', await eqStatus()); await sleep(2); log('estado:', await eqStatus());
  log('texto en Ajustes:', await page.evaluate(`document.getElementById('eqStatus')?.textContent`));
  shot('ajustes-eq');
  log('avanza con el eq:', await advancing()); await sleep(8);
  log('CPU Rock, 9 bandas:', await cpu(), await video());
  log('ajuste Voz/Graves:', await setEq(true, 'Graves')); await sleep(10);
  log('CPU Graves, 4 bandas:', await cpu());
  log('ajuste Plano:', await setEq(true, 'Plano')); await sleep(10);
  log('CPU Plano (enganchado, directo):', await cpu(), await eqStatus());
  await setEq(true, 'Rock'); await sleep(8);
  await background('Rock');

  log('--- C. apagarlo suelta el reproductor');
  const antes = await video();
  log('apagar:', await setEq(false)); await sleep(20);
  log('antes', antes, 'después', await video(), 'estado', await eqStatus());
  log('avanza:', await advancing());
  await background('apagado tras usarlo');

  const errors = adb('logcat', '-d').split('\n').filter((l) => /FATAL|AndroidRuntime|chromium.*Uncaught|CONSOLE.*(Uncaught|Error)/.test(l)).slice(-25);
  log('errores en el registro:', errors.length ? errors : 'ninguno');
  log('app viva:', sh(`pidof ${PKG}`).trim() || 'NO');
}

main().then(() => process.exit(0), (e) => { log('LA PRUEBA FALLÓ:', e.stack || e.message); shot('fallo'); process.exit(1); });
