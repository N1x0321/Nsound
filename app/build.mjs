// Une CSS y JS en un único index.html (dist/index.html) y copia eq.js. Sin dependencias: node app/build.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });

const css = readdirSync(join(src, 'css')).filter((f) => f.endsWith('.css')).sort()
  .map((f) => readFileSync(join(src, 'css', f), 'utf8')).join('\n');
const js = readdirSync(join(src, 'js')).filter((f) => f.endsWith('.js')).sort()
  .map((f) => readFileSync(join(src, 'js', f), 'utf8')
    .replace(/\nif \(typeof module !== 'undefined' && module\.exports\) module\.exports = LS;\s*$/, '\n'))
  .join('\n');

// Versión de la página (solo la usa el navegador; en las apps manda la nativa). Sin ella no se avisa de versiones nuevas.
const version = process.env.NSOUND_VERSION || '0.0.0-dev';
if (!/^[0-9A-Za-z.+-]+$/.test(version)) throw new Error('NSOUND_VERSION no válida: ' + version);

if (/<\/script/i.test(js)) throw new Error('El JS contiene "</script": se rompería el HTML incrustado.');

const logo = 'data:image/png;base64,' + readFileSync(join(src, 'logo.png')).toString('base64');

// Funciones de reemplazo para que "$&" y similares dentro del código no se interpreten
const html = readFileSync(join(src, 'index.template.html'), 'utf8')
  .replace('<!--CSS-->', () => css)
  .replace('<!--JS-->', () => js.replace('__NSOUND_VERSION__', () => version))
  .replaceAll('<!--LOGO-->', () => logo);

writeFileSync(join(dist, 'index.html'), html);
writeFileSync(join(dist, 'sw.js'), readFileSync(join(src, 'sw.js'), 'utf8'));
writeFileSync(join(dist, 'eq.js'), readFileSync(join(src, 'eq.js'), 'utf8'));
console.log(`dist/index.html ${(html.length / 1024).toFixed(0)} KB · dist/eq.js`);
