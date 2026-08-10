import { readFileSync, existsSync } from 'node:fs';

let pass = 0;
const check = (name, condition) => {
  if (!condition) throw new Error(`FALLO: ${name}`);
  pass += 1;
  console.log(`ok ${pass} - ${name}`);
};

const settings = readFileSync('balam/settings.jsx', 'utf8');
const pdf = 'Manual_de_Procedimientos_BALAM_Inventario_Comisiones.pdf';
const pdfBytes = readFileSync(pdf);

check('el PDF oficial existe en la raíz publicable', existsSync(pdf));
check('Configuración declara una ruta única al manual', settings.includes(`const PROCEDURES_MANUAL_PATH = '${pdf}'`));
check('la tarjeta se llama Manual de procedimientos', settings.includes("children: 'Manual de procedimientos'"));
check('la tarjeta vive en el panel Negocio', /negocio:\s*\(\) => \[[\s\S]*?h\(ProceduresManualCard/.test(settings));
check('existe contrato estable para abrir', settings.includes("'data-testid': 'procedures-manual-open'"));
check('abrir usa pestaña separada protegida', settings.includes("target: '_blank', rel: 'noopener noreferrer'"));
check('existe contrato estable para descargar', settings.includes("'data-testid': 'procedures-manual-download'"));
check('la descarga conserva el nombre oficial', settings.includes(`download: '${pdf}'`));
check('no se creó una sección de permisos nueva', !settings.includes('config.manual'));
check('el archivo servido tiene firma PDF válida', pdfBytes.subarray(0, 5).toString() === '%PDF-');

console.log(`${pass}/${pass} comprobaciones aprobadas`);
