// H-63 — Un código de talla numérica con referencias vivas no puede quedar inactivo.
//
// Corre CONFIG en un sandbox de Node (mismo patrón que test-module-contracts.mjs):
// la guarda vive en balam/config.jsx y no necesita navegador ni artefacto, así que
// esta prueba ejerce la FUENTE aunque index.html todavía no se haya regenerado.
//
// Lo que NO se prueba aquí, por estar fuera del alcance autorizado de H-63:
// las reglas de visibilidad de POS, detalle, formulario y exportación.
import fs from 'fs';
import vm from 'vm';

let pass = 0;
let fail = 0;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ' · ' + detail : ''}`);
  condition ? pass++ : fail++;
};

const core = fs.readFileSync('balam/core.jsx', 'utf8');
const config = fs.readFileSync('balam/config.jsx', 'utf8');

// ── Escenario ───────────────────────────────────────────────────────────────
// Reproduce la FORMA del catálogo real: códigos históricos alfabéticos con
// etiqueta numérica conviviendo con códigos numéricos, todos en size_number.
// Aquí están ACTIVOS: lo que se prueba es que ya no puedan desactivarse.
function nuevoEscenario() {
  const memory = new Map();
  const sandbox = {
    window: { dispatchEvent() {} },
    localStorage: {
      getItem(key) { return memory.get(key) ?? null; },
      setItem(key, value) { memory.set(key, String(value)); },
    },
    CustomEvent: class {},
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(core + '\n' + config, sandbox);
  const C = sandbox.window.CONFIG;

  const snap = C.snapshot();
  snap.catalogs.size_number = [
    { code: '40', label: '40', active: true, meta: {} },          // referenciado por precio por talla
    { code: '42', label: '42', active: true, meta: {} },          // sin referencias
    { code: 'B', label: '42', active: true, meta: {} },           // histórico CON existencias
    { code: 'PZ', label: 'PIEZA', active: true, meta: {} },       // referenciado por código de barras
    { code: 'PR', label: '99', active: true, meta: {} },          // referenciado por promoción
    { code: 'X9', label: '98', active: true, meta: {} },          // sin referencia alguna
    { code: 'V7', label: '38', active: true, meta: { value: '38' } }, // valor real ≠ código
  ];
  snap.catalogs.size_letter = [
    { code: 'CH', label: 'CHICO', active: true, meta: {} },       // CON existencias: debe seguir desactivable
    { code: 'GR', label: 'GRANDE', active: true, meta: {} },
  ];
  C.load(snap);

  const productos = [
    {
      id: 'p-num', color: 'BL',
      attrs: { __sizeCategoryId: 'size_number' },
      sizeCategoryId: 'size_number',
      stock: [
        { talla: 'B', escala: 'N', stock: 6 },
        { talla: '38', escala: 'N', stock: 2 },
        { talla: '42', escala: 'N', stock: 0 },
      ],
      preciosTalla: { 40: 1150 },
      barcodeUrls: { PZ: 'https://example.invalid/pz.png' },
    },
    {
      id: 'p-let', color: 'BL',
      attrs: { __sizeCategoryId: 'size_letter' },
      sizeCategoryId: 'size_letter',
      stock: [{ talla: 'CH', escala: 'L', stock: 3 }],
      preciosTalla: {},
      barcodeUrls: {},
    },
  ];
  const promociones = [{ id: 'promo-1', scope: { tallas: ['PR'] } }];

  sandbox.window.CORE.registerCatalogProducts({ list: () => productos, save: () => {} });
  if (typeof sandbox.window.CORE.registerCatalogPromotions === 'function') {
    sandbox.window.CORE.registerCatalogPromotions({ list: () => promociones });
  }
  return { C, sandbox, productos, promociones };
}

const activo = (C, kind, code) => {
  const it = C.find(kind, code);
  return !!it && it.active !== false;
};

// ── 1. La autoridad de referencias vivas ────────────────────────────────────
{
  const { C } = nuevoEscenario();
  check('CONFIG publica la autoridad de referencias vivas por talla',
    typeof C.sizeCodeReferences === 'function');

  const refs = code => (typeof C.sizeCodeReferences === 'function'
    ? C.sizeCodeReferences('size_number', code)
    : null);

  const b = refs('B');
  check('cuenta las existencias del código histórico B',
    !!b && b.stock === 6 && b.productos === 1 && b.total > 0,
    JSON.stringify(b));

  const cuarenta = refs('40');
  check('cuenta una referencia por precio especial de talla',
    !!cuarenta && cuarenta.precios === 1 && cuarenta.stock === 0 && cuarenta.total > 0,
    JSON.stringify(cuarenta));

  const pz = refs('PZ');
  check('cuenta una referencia por código de barras',
    !!pz && pz.barcodes === 1 && pz.total > 0, JSON.stringify(pz));

  const pr = refs('PR');
  check('cuenta una referencia por promoción con alcance de talla',
    !!pr && pr.promociones === 1 && pr.total > 0, JSON.stringify(pr));

  const x9 = refs('X9');
  check('un código sin referencias reporta cero',
    !!x9 && x9.total === 0, JSON.stringify(x9));

  const v7 = refs('V7');
  check('resuelve por meta.value y no por el código', // stock guardado como '38'
    !!v7 && v7.stock === 2, JSON.stringify(v7));

  const bLetra = typeof C.sizeCodeReferences === 'function'
    ? C.sizeCodeReferences('size_letter', 'B') : null;
  check('no cruza escalas: B no tiene referencias como talla de letra',
    !!bLetra && bLetra.total === 0, JSON.stringify(bLetra));
}

// ── 2. Interruptor manual ───────────────────────────────────────────────────
{
  const { C } = nuevoEscenario();
  const antes = C.version;
  const r = C.setActive('size_number', 'B', false);
  check('el interruptor manual rechaza desactivar un código con existencias',
    r && r.ok === false && /existencia|referencia|uso/i.test(String(r.error || '')),
    JSON.stringify(r));
  check('el rechazo no muta el catálogo', activo(C, 'size_number', 'B'));
  check('el rechazo no emite ni persiste un cambio de configuración', C.version === antes);

  const conPrecio = C.setActive('size_number', '40', false);
  check('el interruptor manual rechaza un código referenciado sólo por precio',
    conPrecio && conPrecio.ok === false);

  const libre = C.setActive('size_number', 'X9', false);
  check('un código sin referencias sí se puede desactivar',
    libre && libre.ok === true && !activo(C, 'size_number', 'X9'));

  const rea = C.setActive('size_number', 'X9', true);
  check('reactivar nunca se bloquea',
    rea && rea.ok === true && activo(C, 'size_number', 'X9'));

  const letra = C.setActive('size_letter', 'CH', false);
  check('size_letter conserva su comportamiento: se desactiva aunque tenga existencias',
    letra && letra.ok === true && !activo(C, 'size_letter', 'CH'));
}

// ── 3. Importación de catálogos ─────────────────────────────────────────────
{
  const { C } = nuevoEscenario();
  const antes = C.version;
  const r = C.importCatalogs({
    size_number: [
      { code: '40', label: '40', active: true },
      { code: '42', label: '42', active: true },
      { code: 'B', label: '42', active: false },   // ACTIVO = NO explícito
      { code: 'PZ', label: 'PIEZA', active: true },
      { code: 'PR', label: '99', active: true },
      { code: 'X9', label: '98', active: true },
      { code: 'V7', label: '38', active: true, meta: { value: '38' } },
    ],
  });
  check('la importación rechaza un ACTIVO=NO sobre un código con existencias',
    r && r.ok === false, JSON.stringify(r && r.error));
  check('el rechazo informa qué códigos quedaron bloqueados y por qué',
    !!(r && Array.isArray(r.blocked) && r.blocked.length === 1
      && r.blocked[0].code === 'B' && r.blocked[0].label === '42'
      && r.blocked[0].references && r.blocked[0].references.stock === 6),
    JSON.stringify(r && r.blocked));
  check('el archivo rechazado no cambia el catálogo',
    activo(C, 'size_number', 'B') && C.version === antes);
}

{
  const { C } = nuevoEscenario();
  const antes = C.version;
  // El código simplemente NO viene en el archivo: hoy eso lo desactiva en silencio.
  const r = C.importCatalogs({
    size_number: [
      { code: '40', label: '40', active: true },
      { code: '42', label: '42', active: true },
      { code: 'PZ', label: 'PIEZA', active: true },
      { code: 'PR', label: '99', active: true },
      { code: 'X9', label: '98', active: true },
      { code: 'V7', label: '38', active: true, meta: { value: '38' } },
    ],
  });
  check('la importación rechaza la desactivación IMPLÍCITA por ausencia del código',
    r && r.ok === false, JSON.stringify(r && r.error));
  check('la ausencia se reporta con su motivo propio',
    !!(r && Array.isArray(r.blocked) && r.blocked.some(b => b.code === 'B' && b.reason === 'ausente')),
    JSON.stringify(r && r.blocked));
  check('el catálogo conserva el código y su posición',
    activo(C, 'size_number', 'B')
    && C.all('size_number').findIndex(it => it.code === 'B') === 2
    && C.version === antes);
}

{
  const { C } = nuevoEscenario();
  const antes = C.version;
  // Atomicidad: la hoja de size_letter es válida, la de size_number no.
  const r = C.importCatalogs({
    size_letter: [
      { code: 'GR', label: 'GRANDE', active: true },
      { code: 'CH', label: 'CHICO', active: true },
    ],
    size_number: [
      { code: '42', label: '42', active: true },
    ],
  });
  check('un archivo con una hoja inválida se rechaza completo',
    r && r.ok === false && r.kinds === 0);
  check('la importación es atómica: ninguna otra hoja se aplicó',
    C.all('size_letter').map(it => it.code).join(',') === 'CH,GR'
    && C.version === antes);
}

{
  const { C } = nuevoEscenario();
  const antes = C.version;
  // Archivo legítimo: conserva los códigos protegidos y reordena el resto.
  const r = C.importCatalogs({
    size_number: [
      { code: 'B', label: '42', active: true },
      { code: '40', label: '40', active: true },
      { code: '42', label: '42', active: true },
      { code: 'PZ', label: 'PIEZA', active: true },
      { code: 'PR', label: '99', active: true },
      { code: 'X9', label: '98', active: true },
      { code: 'V7', label: '38', active: true, meta: { value: '38' } },
    ],
  });
  check('un archivo que respeta los códigos protegidos sí se aplica',
    r && r.ok !== false && r.kinds === 1 && C.version > antes, JSON.stringify(r));
  check('la protección no congela el orden del catálogo',
    C.all('size_number')[0].code === 'B');
  check('un código sin referencias sigue pudiendo desactivarse desde el archivo',
    C.importCatalogs({
      size_number: [
        { code: 'B', label: '42', active: true },
        { code: '40', label: '40', active: true },
        { code: '42', label: '42', active: true },
        { code: 'PZ', label: 'PIEZA', active: true },
        { code: 'PR', label: '99', active: true },
        { code: 'X9', label: '98', active: false },
        { code: 'V7', label: '38', active: true, meta: { value: '38' } },
      ],
    }).ok !== false && !activo(C, 'size_number', 'X9'));
}

// ── 4. Borrado: misma autoridad, sin cambiar las demás familias ─────────────
{
  const { C } = nuevoEscenario();
  const conStock = C.removeItem('size_number', 'B');
  check('borrar un código de talla con existencias sigue bloqueado',
    conStock && conStock.ok === false);
  const soloPrecio = C.removeItem('size_number', '40');
  check('borrar un código referenciado sólo por precio también se bloquea',
    soloPrecio && soloPrecio.ok === false, JSON.stringify(soloPrecio));
  const letra = C.removeItem('size_letter', 'CH');
  check('size_letter conserva su guarda de borrado por existencias',
    letra && letra.ok === false);
  const otro = C.removeItem('color', 'BL');
  check('los demás catálogos conservan su guarda intacta',
    otro && typeof otro.ok === 'boolean');
}

// ── 5. Cableado de la pantalla de Configuración ─────────────────────────────
// Comprobación ESTÁTICA, no de comportamiento: `settings.jsx` es JSX y necesita
// Babel, React y el artefacto regenerado para ejecutarse, cosa que esta historia
// todavía no tiene autorizada. Estas tres afirmaciones impiden que el rechazo se
// quede mudo por un descuido; NO sustituyen la prueba de interacción, que queda
// pendiente para cuando se autorice regenerar el paquete.
{
  const settings = fs.readFileSync('balam/settings.jsx', 'utf8');
  check('el interruptor pasa por un manejador que puede avisar del rechazo',
    /onClick:\s*\(\)\s*=>\s*toggle\(it\)/.test(settings)
    && /function toggle\(it\)[\s\S]{0,240}toast\(r\.error/.test(settings));
  check('la importación de catálogos atiende el rechazo por tallas protegidas',
    /r\.ok === false && Array\.isArray\(r\.blocked\)/.test(settings));
  check('el aviso de importación nombra la talla y su inventario',
    /Talla \$\{b\.label\} \(código \$\{b\.code\}\)/.test(settings));

  // Los módulos tocados deben seguir siendo analizables (no hay arnés de navegador
  // para la fuente mientras el artefacto no se regenere).
  const parsea = f => { try { new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }); return true; } catch (e) { return false; } };
  check('los módulos modificados no tienen errores de sintaxis',
    ['balam/core.jsx', 'balam/config.jsx', 'balam/data.jsx', 'balam/settings.jsx'].every(parsea));
}

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
