import { readFileSync } from 'node:fs';

const harnesses = [
  'test-auto-fotos.mjs',
  'test-export-modelo.mjs',
  'test-filtros-inventario.mjs',
  'test-import-fotos.mjs',
  'test-liquidations.mjs',
  'test-reset-propaga.mjs',
  'test-reset-pruebas.mjs',
  'test-xlsx-security.mjs',
];

let pass = 0;
let fail = 0;
for (const file of harnesses) {
  const source = readFileSync(file, 'utf8');
  const servesBundle = /requested === '\/'\) requested = '\/index\.html'/.test(source)
    || /p === '\/'\) p = '\/index\.html'/.test(source);
  const opensBundle = /page\.goto\([^)]*\/index\.html/.test(source);
  const avoidsDevRuntime = !source.includes('/POS%20Balam.html');
  const ok = servesBundle && opensBundle && avoidsDevRuntime;
  console.log(`${ok ? '✅' : '❌'} ${file} ejecuta el bundle local`);
  ok ? pass++ : fail++;
}

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
