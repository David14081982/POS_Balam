import fs from 'fs';

let pass = 0, fail = 0;
const check = (name, condition) => {
  console.log(`${condition ? '✅' : '❌'} ${name}`);
  condition ? pass++ : fail++;
};

const src = fs.readFileSync('balam/settings.jsx', 'utf8');
check('beneficios usa un editor específico', /function BenefitEditor\(/.test(src) && /h\(BenefitEditor/.test(src));
check('no usa la fila técnica del editor genérico', !/kind: 'additional_benefit'[\s\S]{0,120}metaFields:/.test(src));
check('traduce los tipos para el administrador', /Porcentaje/.test(src) && /Cantidad de dinero/.test(src) && /Cortesía de toda la venta/.test(src));
check('traduce el alcance', /Toda la venta/.test(src) && /Un artículo/.test(src));
check('explica la captura manual', /El vendedor escribe el valor/.test(src));
check('cada opción se edita en una tarjeta responsiva', /data-testid': 'benefit-card-/.test(src) && /grid-cols-1 md:grid-cols-2/.test(src));
check('conserva activar, ordenar y eliminar', /C\.setActive\('additional_benefit'/.test(src) && /C\.move\('additional_benefit'/.test(src) && /C\.removeItem\('additional_benefit'/.test(src));

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
