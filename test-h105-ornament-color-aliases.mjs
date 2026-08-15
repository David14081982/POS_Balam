import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync('balam/config.jsx', 'utf8');
const sandbox = { window: { addEventListener() {}, dispatchEvent() {}, CORE: { invokeSync() {} } }, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }, CustomEvent: class {} };
vm.runInNewContext(source, sandbox);
sandbox.window.CONFIG.load({ catalogs: { ornament_color: [
  { code: 'AZ', label: 'AZUL', active: true, meta: { hex: '#00f' } },
  { code: 'AZL', label: 'Azul', active: false, meta: {} },
] }, catalogMeta: {}, settings: {} });
assert.deepEqual(Array.from(sandbox.window.CONFIG.selectable('ornament_color', []), x => x.code), ['AZ']);
assert.deepEqual(Array.from(sandbox.window.CONFIG.selectable('ornament_color', ['AZL']), x => x.code), ['AZ', 'AZL']);

const inventory = fs.readFileSync('balam/inventory.jsx', 'utf8');
assert.match(inventory, /CONFIG\.selectable\(/);
assert.match(inventory, /Histórico/);

const xlsx = fs.readFileSync('balam/xlsx-io.jsx', 'utf8');
assert.match(xlsx, /found\.active === false/);
assert.match(xlsx, /Colores de ornamento V2/);
console.log('H-105 selector/Excel contract: 6/6');
