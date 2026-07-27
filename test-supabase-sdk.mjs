import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
const check = (name, value) => {
  console.log(`${value ? '✅' : '❌'} ${name}`);
  value ? pass++ : fail++;
};

const store = readFileSync('balam/store.jsx', 'utf8');
const source = readFileSync('POS Balam.html', 'utf8');
const match = source.match(/<script src="(balam\/vendor\/supabase-[^"]+\/supabase\.min\.js)"><\/script>/);
const sdkPath = match && match[1];

check('STORE no descarga Supabase dinámicamente', (
  !store.includes('cdn.jsdelivr.net/npm/@supabase/supabase-js')
  && !store.includes("document.createElement('script')")
));
check('la entrada carga una copia local versionada', !!sdkPath);
check('la copia local existe y no está vacía', (
  !!sdkPath && existsSync(sdkPath) && readFileSync(sdkPath).length > 100000
));
check('la copia local tiene SHA-256 documentado en el contrato', (
  !!sdkPath
  && existsSync(sdkPath)
  && source.includes(createHash('sha256').update(readFileSync(sdkPath)).digest('hex'))
));

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
