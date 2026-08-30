import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const baseline = process.argv.includes('--baseline');
const forbidden = /\b(?:V1|V2|V3|products?\.id|UUID|barcode_code|reference_family_id|RPC|RLS|Supabase|tombstones?|epoch|protocolo|rebootstrap|cach[eé]|cola|JSON|HID|Code\s*128|m[oó]dulos?|encoding|namespace|manifest|hash|commit|SHA(?:-?256)?|schema|payload|SQL|localStorage|fallback|alias|resolver|sync_activity)\b|\bHTTP\s*\d{3}\b|\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

const leakSignatures = [
  /sub:\s*op\.diagnostic\.message/g,
  /item\.diagnostic\.message\s*\|\|\s*item\.diagnostic\.code/g,
  /h\(['"]div['"][^\n]+},\s*item\.execution_message\)/g,
  /h\([^\n]+row\.conflict\.message/g,
  /h\(['"]span['"][^\n]+},\s*error\)/g,
  /Cola sin almacenamiento durable/g,
  /Autorizar por RPC normal/g,
  /Resincronizar desde la nube/g,
  /Guardar en Supabase/g,
  /im[aá]genes guardadas[^\n]+Supabase/g,
  /Esquema BALAM v/g,
  /Diagn[oó]stico autoritativo/g,
  /Cola: [^\n]+Esquema:/g,
  /L[ií]nea base local[^\n]+huella/g,
  /Ver detalle t[eé]cnico/g,
  /La identidad t[eé]cnica no cambia/g,
  /Autenticaci[oó]n robusta \(RLS\/Supabase Auth\)/g,
  /window\.alert\(['"]Tienes una sesi[oó]n iniciada[^\n]+Supabase/g,
  /Cola de sincronizaci[oó]n/g,
  /requiere identidad log[ií]stica V2/g,
  /Migra la referencia a V2/g,
  /Densidad preventiva: X/g,
  /Code128 coincide/g,
  /barcode V2 personalizado/g,
  /Precios especiales por talla: JSON/g,
  /actualizaci[oó]n usa _BALAM_ID_PRODUCTO/g,
  /columnas _BALAM_\*/g,
  /C[oó]digo ambiguo bloqueado\. Resincroniza/g,
  /resuelve a m[aá]s de una referencia\. Resincroniza/g,
  /La cola no tiene almacenamiento durable/g,
];

function sourcesAt(ref) {
  const files = fs.readdirSync('balam').filter(name => name.endsWith('.jsx'));
  return files.map(name => {
    const path = `balam/${name}`;
    const source = ref
      ? execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' })
      : fs.readFileSync(path, 'utf8');
    return { path, source };
  });
}

function audit(ref) {
  const files = sourcesAt(ref);
  const surfaces = new Set();
  for (const { path, source } of files) {
    source.split(/\r?\n/).forEach((line, index) => {
      if (/\btoast\s*\(|window\.(?:alert|confirm)\s*\(|role:\s*['"](?:alert|status)['"]|placeholder:/.test(line)) {
        surfaces.add(`${path}:${index + 1}`);
      }
    });
  }
  const joined = files.map(file => file.source).join('\n');
  const leakDetails = leakSignatures.map(pattern => ({ pattern: pattern.source, count: [...joined.matchAll(new RegExp(pattern.source, pattern.flags))].length })).filter(item => item.count);
  const leaks = leakDetails.reduce((sum, item) => sum + item.count, 0);
  return { surfaces: surfaces.size, leaks, leakDetails };
}

function loadAuthority(source) {
  const element = (type, props, ...children) => ({ type, props: props || {}, children });
  const sandbox = {
    console, setTimeout: () => 1, clearTimeout: () => {},
    document: { getElementById: () => ({}), head: { appendChild() {} }, createElement: () => ({}) },
    navigator: {},
    React: {
      createElement: element,
      cloneElement: element,
      useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect: () => {}, useRef: value => ({ current: value }),
    },
  };
  sandbox.window = sandbox;
  sandbox.window.AUTH = { isAdmin: () => false, role: () => 'vendedor' };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'balam/shared.jsx' });
  return sandbox;
}

const checks = [];
const check = (name, value, detail = '') => {
  checks.push({ name, value: !!value, detail });
  console.log(`${value ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
};

const currentAudit = audit(null);
const baselineAudit = audit('origin/main');
console.log(`AUDIT_H134 superficies=${currentAudit.surfaces} tecnicos_base=${baselineAudit.leaks} tecnicos_actuales=${currentAudit.leaks} reescritos=${baselineAudit.leaks - currentAudit.leaks}`);
if (currentAudit.leakDetails.length) console.log('H134_LEAKS ' + currentAudit.leakDetails.map(item => `${item.count}x/${item.pattern}/`).join(' · '));

const sharedSource = baseline
  ? execFileSync('git', ['show', 'origin/main:balam/shared.jsx'], { encoding: 'utf8' })
  : fs.readFileSync('balam/shared.jsx', 'utf8');
const sandbox = loadAuthority(sharedSource);
const authority = sandbox.window.UI && sandbox.window.UI.messageAuthority;
check('existe autoridad central de mensajes', typeof authority === 'function');

if (typeof authority === 'function') {
  const cases = [
    { code: '42501', message: 'new row violates row-level security policy', status: 403 },
    { code: 'PGRST205', message: 'Could not find table in schema cache', status: 400 },
    { code: 'insufficient_stock', message: 'stock mismatch for products.id 68b8e35e-b428-4fdb-8dfa-a0a9b5b2c33b' },
    { code: 'sync_protocol_outdated', message: 'rebootstrap_required epoch 8' },
    { code: 'BARCODE_AMBIGUOUS', message: 'Code128 resolves multiple reference_family_id values' },
    { code: 'MISSING_BARCODE', message: 'barcode_code missing in V2 payload' },
    { code: 'LABEL_DENSITY', message: 'X 0.170 mm, 244 modules' },
    { code: 'ENCODING_ERROR', message: 'Code128 encoding failed' },
    { code: 'DUPLICATE_ID_FILE', message: 'UUID repeated in XLSX schema V3' },
    { code: 'quota_exceeded', message: 'localStorage queue persistence failed' },
    { code: 'VERSION_CONFLICT', message: 'commit hash mismatch' },
    { code: 'unknown_error', message: 'HTTP 500 Supabase RPC payload rejected' },
  ];
  for (const [index, input] of cases.entries()) {
    const message = authority(input);
    const visible = [message.title, message.explanation, message.action].join(' ');
    check(`caso ${index + 1} sin jerga visible`, !forbidden.test(visible), visible);
    check(`caso ${index + 1} explica acción`, !!message.action, message.action);
    check(`caso ${index + 1} conserva evidencia`, message.technicalDetails.includes(input.code), input.code);
  }
  const safe = authority('Escribe el nombre del cliente', { color: 'var(--danger)' });
  check('mensaje humano existente se conserva', safe.title === 'Escribe el nombre del cliente');
  check('niveles canónicos disponibles', ['neutral', 'success', 'warning', 'danger'].every(level => sandbox.window.UI.MESSAGE_LEVEL[level]));
  const typesOf = node => {
    if (Array.isArray(node)) return node.flatMap(typesOf);
    if (!node || typeof node !== 'object') return [];
    return [node.type, ...(node.children || []).flatMap(typesOf)];
  };
  const findType = (node, type) => {
    if (Array.isArray(node)) return node.map(child => findType(child, type)).find(Boolean);
    if (!node || typeof node !== 'object') return null;
    if (node.type === type) return node;
    return (node.children || []).map(child => findType(child, type)).find(Boolean) || null;
  };
  const sellerTree = sandbox.window.UI.HumanMessage({ message: cases[0] });
  check('personal de venta no recibe detalle técnico', !typesOf(sellerTree).includes('details'));
  sandbox.window.AUTH = { isAdmin: () => true, role: () => 'admin' };
  const adminTree = sandbox.window.UI.HumanMessage({ message: cases[0] });
  const details = findType(adminTree, 'details');
  check('administración conserva detalle técnico cerrado', !!details && !details.props.open && details.props['data-technical-details'] === 'true');
}

check('no quedan escapes técnicos conocidos', currentAudit.leaks === 0, String(currentAudit.leaks));
check('el censo cubre mensajes, alertas, estados y ayudas', currentAudit.surfaces >= 150, String(currentAudit.surfaces));

const failed = checks.filter(item => !item.value).length;
console.log(`H134_RESULT pasaron=${checks.length - failed} fallaron=${failed}`);
process.exit(failed ? 1 : 0);
