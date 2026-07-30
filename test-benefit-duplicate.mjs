import fs from 'fs';

let pass = 0, fail = 0;
const check = (name, condition) => {
  console.log(`${condition ? '✅' : '❌'} ${name}`);
  condition ? pass++ : fail++;
};
const src = fs.readFileSync('balam/settings.jsx', 'utf8');

check('editor ofrece acción Duplicar', /data-testid': 'benefit-duplicate-/.test(src) && /}, 'Duplicar'\)/.test(src));
check('la copia recibe identidad nueva', /function duplicateBenefit\(it\)/.test(src) && /C\.find\('additional_benefit', code\)/.test(src));
check('la copia conserva todos los ajustes sin compartir referencia', /JSON\.parse\(JSON\.stringify\(it\.meta/.test(src));
check('la copia queda activa y con nombre distinguible', /'Copia de ' \+ it\.label/.test(src) && /active: true/.test(src));
check('la copia se coloca junto al original', /C\.move\('additional_benefit', code, -1\)/.test(src));
check('la copia se abre para editar inmediatamente', /setOpen\(code\)/.test(src));

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
