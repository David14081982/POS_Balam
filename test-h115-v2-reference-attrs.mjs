// H-115 · Contrato determinista del draft V2 antes de entrar a DATA.
import { readFileSync } from 'node:fs';

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const inventory = read('./balam/inventory.jsx');
const data = read('./balam/data.jsx');
const xlsx = read('./balam/xlsx-io.jsx');
let pass = 0, fail = 0;
const ok = (name, condition) => {
  console.log(`${condition ? '✅' : '❌'} ${name}`);
  condition ? pass++ : fail++;
};

const submit = inventory.match(/function submit\(afterSave\)[\s\S]*?\n    }\n\n    const footer/)?.[0] || '';

ok('el submit materializa todos los referenceCaptureKinds',
  /referenceCaptureKinds\.forEach\(kind =>/.test(submit));
ok('el valor general del formulario participa en cada candidate',
  /const generalValue = \(d\.attrs \|\| \{\}\)\[kind\]/.test(submit));
ok('la excepción específica gana al valor general',
  /const nextValue = override !== undefined \? override/.test(submit));
ok('una proyección mixta conserva el valor fuente en vez de borrarlo',
  /generalValue[\s\S]{0,180}: sourceValue\)/.test(submit)
  && !/referenceCaptureKinds\.forEach[\s\S]{0,700}else delete candidateAttrs\[kind\]/.test(submit));
ok('el guardado sigue entregando attrs efectivos a DATA.updateReference',
  /attrs: \{ \.\.\.candidateAttrs, __sizeCategoryId: rowCategoryId \}/.test(submit));
ok('la guarda compara el cambio físico concreto antes de bloquear',
  /next\.physicalSignature !== current\.physicalSignature[\s\S]{0,180}referenceHasOperations\(current\.id\)/.test(data));
ok('el mensaje distingue existencias u operaciones sin afirmar que sólo hubo operaciones',
  /tiene o tuvo existencias u operaciones/.test(data)
  && /Puedes editar datos comerciales/.test(data)
  && /tiene o tuvo existencias u operaciones/.test(xlsx)
  && /Los datos comerciales sí pueden actualizarse/.test(xlsx));

console.log(`\nH-115 contrato: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
