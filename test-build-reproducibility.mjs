// Fase 16: el manifiesto del bundle debe identificar assets por contenido.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, value) => {
  console.log(`${value ? '✅' : '❌'} ${name}`);
  value ? pass++ : fail++;
};
const sha256 = value => createHash('sha256').update(value).digest('hex');

const build = readFileSync('build-offline.mjs', 'utf8');
const offline = readFileSync('POS Balam (offline).html');
const index = readFileSync('index.html');

check('el build no usa identidad aleatoria', !build.includes('randomUUID'));
check('el manifiesto deriva la identidad del contenido', (
  build.includes("createHash('sha256')")
  && build.includes('.update(buf)')
));
check('los dos artefactos publicados son copias exactas', (
  offline.equals(index)
  && sha256(offline) === sha256(index)
));
check('la identidad de asset conserva formato UUID compatible', (
  build.includes("slice(0, 32)")
  && build.includes("slice(0, 8)")
  && build.includes("slice(8, 12)")
  && build.includes("slice(12, 16)")
  && build.includes("slice(16, 20)")
  && build.includes("slice(20)")
));
check('el build normal no solicita recursos de red', (
  !build.includes('await fetch(')
  && build.includes('BALAM_REFRESH_BUILD_RESOURCES')
));
check('un recurso ausente o inválido aborta el build', (
  !build.includes('SKIP')
  && !build.includes('bundle usará Babel en runtime')
  && build.includes('recurso no fijado:')
  && build.includes('hash inválido en cache:')
));
check('Tailwind usa la dependencia fijada por el lockfile', (
  !build.includes('npx --yes')
  && build.includes('node_modules/tailwindcss/lib/cli.js')
));
const resourcesPath = 'balam/vendor/build-resources.json';
const resources = existsSync(resourcesPath)
  ? JSON.parse(readFileSync(resourcesPath, 'utf8'))
  : {};
check('cada recurso externo tiene bytes y SHA-256 fijados', (
  Object.keys(resources).length > 10
  && Object.values(resources).every(item => (
    typeof item.data === 'string'
    && /^[0-9a-f]{64}$/.test(item.sha256)
    && sha256(Buffer.from(item.data, 'base64')) === item.sha256
  ))
));

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
