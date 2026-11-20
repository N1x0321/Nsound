// Une CSS y JS en un único index.html (dist/index.html) y copia eq.js. Sin dependencias: node app/build.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateExperimentalAssets } from './assets-experimental.mjs';
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

// Experimental (inerte salvo que ENABLE_EXPERIMENTAL_PLAYER sea true): se incrusta después del resto
const expDir = join(src, 'experimental');
const expJs = readdirSync(expDir).filter((f) => f.endsWith('.js') && f !== 'sw-experimental.js').sort()
  .map((f) => readFileSync(join(expDir, f), 'utf8')
    .replace(/\nif \(typeof module !== 'undefined' && module\.exports\) module\.exports = globalThis\.NSoundExperimental;\s*$/, '\n'))
  .join('\n');
const allJs = js + '\n' + expJs;

if (/<\/script/i.test(allJs)) throw new Error('El JS contiene "</script": se rompería el HTML incrustado.');

const logo = 'data:image/png;base64,' + readFileSync(join(src, 'logo.png')).toString('base64');

// Funciones de reemplazo para que "$&" y similares dentro del código no se interpreten
const html = readFileSync(join(src, 'index.template.html'), 'utf8')
  .replace('<!--CSS-->', () => css)
  .replace('<!--JS-->', () => allJs)
  .replaceAll('<!--LOGO-->', () => logo);

writeFileSync(join(dist, 'index.html'), html);
writeFileSync(join(dist, 'sw.js'), readFileSync(join(src, 'sw.js'), 'utf8'));
// El service worker experimental y su versión van como archivos aparte (no dentro del HTML)
mkdirSync(join(dist, 'experimental'), { recursive: true });
writeFileSync(join(dist, 'sw-experimental.js'), readFileSync(join(expDir, 'sw-experimental.js'), 'utf8'));
writeFileSync(join(dist, 'experimental', 'version.json'), readFileSync(join(expDir, 'version.json'), 'utf8'));
generateExperimentalAssets(dist, readFileSync(join(src, 'logo.png')));   // iconos, pantallas de arranque y manifest (solo se usan con el modo experimental)
writeFileSync(join(dist, 'eq.js'), readFileSync(join(src, 'eq.js'), 'utf8'));
console.log(`dist/index.html ${(html.length / 1024).toFixed(0)} KB · dist/eq.js`);
