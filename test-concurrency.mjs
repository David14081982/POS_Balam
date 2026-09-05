// H-06 — conflictos multi-terminal sobre entidades sincronizadas.
// Ejecuta store.jsx real con dos terminales y una nube simulada que aplica el
// contrato de versión/tombstone de pos_013_concurrency.sql.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  cond ? pass++ : fail++;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clone = x => JSON.parse(JSON.stringify(x));

function cloudEnv() {
  const rows = { products: new Map(), clients: new Map(), sellers: new Map(), promotions: new Map() };
  const conflicts = [];
  const listeners = new Set();
  const versions = new Map(['products','clients','sellers','promotions'].map(x => [x, 0]));
  // Debe representar el contrato de esquema que exige el cliente actual. Un
  // manifest anterior deja la terminal deliberadamente en cuarentena y no es
  // un escenario de concurrencia válido.
  const manifest = { singleton: true, schema_version: 20260830017500,
    sync_protocol_min: 3, sync_protocol_current: 3, data_epoch: 1,
    domain_modes: Object.fromEntries(['config','products','clients','sellers','promotions','sales','payments','returns','exchanges','loans','liquidations','movements','permissions','purges'].map(x => [x, 'shadow'])) };
  function bump(domain) {
    const version = (versions.get(domain) || 0) + 1; versions.set(domain, version);
    const row = { domain, version, updated_at: new Date().toISOString() };
    queueMicrotask(() => listeners.forEach(fn => fn({ new: clone(row) })));
  }

  function guardedUpsert(table, incoming) {
    const out = [];
    for (const raw of incoming) {
      const row = clone(raw);
      const old = rows[table].get(row.id);
      const expected = Number(row.sync_base_version || 0);
      if (!old) {
        row.sync_version = 1;
        row.sync_base_version = null;
        row.deleted_at = null;
        rows[table].set(row.id, row);
        out.push(clone(row));
      } else if (expected === Number(old.sync_version || 0)) {
        row.sync_version = expected + 1;
        row.sync_base_version = null;
        row.deleted_at = old.deleted_at || null;
        rows[table].set(row.id, row);
        out.push(clone(row));
      } else {
        conflicts.push({ table, id: row.id, expected, actual: old.sync_version });
        out.push(clone(old));
      }
    }
    if (out.length) bump(table === 'promotions' ? 'promotions' : table);
    return out;
  }

  function softDelete(table, id, expected) {
    const old = rows[table].get(id);
    if (!old) return null;
    if (Number(old.sync_version || 0) !== Number(expected || 0)) {
      conflicts.push({ table, id, expected, actual: old.sync_version, type: 'delete' });
      return clone(old);
    }
    old.deleted_at = new Date().toISOString();
    old.sync_version++;
    return clone(old);
  }

  return { rows, conflicts, guardedUpsert, softDelete, listeners, versions, manifest, bump };
}

function terminal(cloud) {
  const storage = new Map();
  const localStorage = {
    getItem: k => storage.has(k) ? storage.get(k) : null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k),
  };
  const local = { products: [], clients: [], sellers: [], promotions: [] };

  function query(table) {
    return {
      upsert(incoming) {
        const result = { data: cloud.guardedUpsert(table, incoming), error: null };
        const thenable = Promise.resolve(result);
        thenable.select = () => thenable;
        return thenable;
      },
      update(patch) {
        return { eq(_col, id) {
          return { select() {
            const old = cloud.rows[table]?.get(id);
            if (!old) return Promise.resolve({ data: [], error: null });
            const expected = Number(patch.sync_base_version || 0);
            if (expected !== Number(old.sync_version || 0)) {
              cloud.conflicts.push({ table, id, expected, actual: old.sync_version });
              return Promise.resolve({ data: [clone(old)], error: null });
            }
            const row = { ...old, ...clone(patch), sync_version: Number(old.sync_version || 0) + 1 };
            cloud.rows[table].set(id, row);
            return Promise.resolve({ data: [clone(row)], error: null });
          } };
        } };
      },
      select() {
        const result = table === 'system_manifest' ? [clone(cloud.manifest)]
          : table === 'sync_domain_versions'
            ? [...cloud.versions].map(([domain, version]) => ({ domain, version }))
            : [...(cloud.rows[table] || new Map()).values()].map(clone);
        const p = Promise.resolve({ data: result, error: null });
        p.gte = () => p; p.eq = () => p; p.in = () => p;
        p.order = () => p; p.range = () => p;
        return p;
      },
      delete() {
        return { eq: () => Promise.resolve({ data: [], error: null }) };
      },
    };
  }

  const client = {
    from: query,
    rpc(name, args) {
      if (name === 'save_products_checked' || name === 'save_products_checked_v2') {
        return Promise.resolve({ data: cloud.guardedUpsert('products', args.p_rows || []), error: null });
      }
      if (name === 'delete_product_checked' || name === 'delete_product_checked_v2') {
        return Promise.resolve({ data: cloud.softDelete('products', args.p_id, args.p_base_version), error: null });
      }
      if (name !== 'soft_delete_entity') return Promise.resolve({ data: null, error: { message: 'rpc desconocida' } });
      const row = cloud.softDelete(args.p_entity, args.p_id, args.p_base_version);
      return Promise.resolve({ data: row, error: null });
    },
    auth: { getSession: async () => ({ data: { session: null } }) },
    storage: { from: () => ({}) },
    channel() {
      let handler = null;
      return {
        on(_event, _filter, fn) { handler = fn; return this; },
        subscribe(fn) { if (handler) cloud.listeners.add(handler); if (fn) fn('SUBSCRIBED'); return this; },
      };
    },
    removeChannel() {},
  };
  const window = {
    listeners: {},
    addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
    dispatchEvent(event) { (this.listeners[event.type] || []).forEach(fn => fn(event)); return true; },
    supabase: { createClient: () => client },
    UI: { toasts: [], toast(msg) { this.toasts.push(msg); } },
    CONFIG: { load() {}, get() { return null; } },
    DATA: {
      ...local, movements: [], sales: [], applied: [], merged: [],
      applyRemote(kind, incoming) {
        local[kind].length = 0;
        incoming.filter(x => !x._deletedAt).forEach(x => local[kind].push(clone(x)));
        this[kind] = local[kind];
      },
      applySyncResult(kind, incoming) {
        for (const remote of incoming) {
          const i = local[kind].findIndex(x => x.id === remote.id);
          if (remote._deletedAt) {
            if (i >= 0) local[kind].splice(i, 1);
          } else if (i >= 0) {
            local[kind][i]._syncVersion = remote._syncVersion;
          } else {
            local[kind].push(clone(remote));
          }
        }
      },
      mergeRemote() {},
    },
  };
  const SRC = readFileSync(new URL('balam/core.jsx', import.meta.url), 'utf8')
    + '\n' + readFileSync(new URL('balam/store.jsx', import.meta.url), 'utf8');
  const fn = new Function('window', 'localStorage', 'document', 'CustomEvent', SRC + '\nreturn window.STORE;');
  const STORE = fn(window, localStorage, { createElement: () => ({}), head: { appendChild() {} } },
    class { constructor(type, opts) { this.type = type; this.detail = opts?.detail; } });
  return { STORE, window, local };
}

const cloud = cloudEnv();
const A = terminal(cloud), B = terminal(cloud);
await A.STORE.init({}); await B.STORE.init({});

// Alta inicial y pull en ambas terminales.
A.local.products.push({ id: 'p1', nombre: 'Guayabera', modelo: '1', stock: [{ talla: 'M', escala: 'L', stock: 10 }], precio: 100, costo: 40, _syncVersion: 0 });
A.STORE.pushRows('products', A.local.products);
await sleep(30);
await A.STORE.pullDomain('products');
await B.STORE.pullDomain('products');
ok('1. ambas terminales leen la misma versión inicial', A.local.products[0]?._syncVersion === 1 && B.local.products[0]?._syncVersion === 1);

// A descuenta; B conserva la versión vieja y después intenta escribir stock 10.
A.local.products[0].stock[0].stock = 8;
A.STORE.pushRows('products', A.local.products);
await sleep(30);
B.local.products[0].nombre = 'Edición tardía';
B.STORE.pushRows('products', B.local.products);
await sleep(40);
const finalProduct = cloud.rows.products.get('p1');
ok('2. una terminal vieja no restaura el stock anterior', finalProduct.stock[0].stock === 8);
ok('3. la edición obsoleta queda registrada como conflicto', cloud.conflicts.some(x => x.table === 'products' && x.id === 'p1'));

// A elimina; B intenta revivir la fila desde su copia vieja.
await A.STORE.pullDomain('products');
const versionBeforeDelete = A.local.products[0]._syncVersion;
A.STORE.deleteRow('products', 'p1', versionBeforeDelete);
await sleep(30);
B.STORE.pushRows('products', B.local.products);
await sleep(40);
ok('4. la eliminación deja tombstone', !!cloud.rows.products.get('p1').deleted_at);
ok('5. un snapshot viejo no revive la entidad eliminada', !!cloud.rows.products.get('p1').deleted_at);

// El mismo contrato protege las demás colecciones editables por snapshot.
const cases = [
  ['clients', { id: 'c1', nombre: 'Ana', tel: '1', _syncVersion: 0 }, 'nombre'],
  ['sellers', { id: 's1', nombre: 'Luz', iniciales: 'LZ', color: '#000', role: 'vendedor', _syncVersion: 0 }, 'nombre'],
  ['promotions', { id: 'd1', nombre: 'Verano', tipo: 'pct', valor: 10, scope: {}, _syncVersion: 0 }, 'nombre'],
];
for (const [kind, seed, field] of cases) {
  if (kind === 'sellers') cloud.rows.sellers.set(seed.id, { ...clone(seed), sync_version: 1 });
  A.local[kind].push(clone(seed));
  A.STORE.pushRows(kind, A.local[kind]);
  await sleep(80);
  await A.STORE.pullDomain(kind);
  await B.STORE.pullDomain(kind);
  A.local[kind][0][field] += ' vigente';
  A.STORE.pushRows(kind, A.local[kind]);
  await sleep(80);
  B.local[kind][0][field] += ' obsoleta';
  B.STORE.pushRows(kind, B.local[kind]);
  await sleep(80);
  ok(`6. ${kind}: una edición vieja no sobrescribe la vigente`,
    cloud.rows[kind].get(seed.id)[field].endsWith('vigente'));
}

// Dos guardados locales rápidos: la segunda op compactada se reconstruye con
// la versión confirmada por la primera, no se autoclasifica como conflicto.
A.local.products.push({ id: 'p2', nombre: 'Rápido 1', modelo: '2', stock: [], precio: 50, costo: 20, _syncVersion: 0 });
A.STORE.pushRows('products', A.local.products);
A.local.products.find(x => x.id === 'p2').nombre = 'Rápido 2';
A.STORE.pushRows('products', A.local.products);
await sleep(60);
ok('7. ediciones rápidas de una misma terminal conservan la última',
  cloud.rows.products.get('p2')?.nombre === 'Rápido 2');

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
// H-77: C no llama pullDomain ni recarga. El timbre de versión provoca por sí
// solo la lectura autoritativa del dominio.
Object.keys(cloud.manifest.domain_modes).forEach(k => { cloud.manifest.domain_modes[k] = 'active'; });
await A.STORE.reconcileDomains();
const C = terminal(cloud);
await C.STORE.init({});
const liveClient = A.local.clients.find(x => x.id === 'c1');
liveClient.nombre = 'Ana en vivo';
A.STORE.pushRows('clients', [liveClient]);
await sleep(500);
ok('8a. H-77: la escritura remota confirmó el nuevo valor',
  cloud.rows.clients.get('c1')?.nombre === 'Ana en vivo');
ok('8. H-77: otra terminal refleja el cambio remoto sin recargar ni pull manual',
  C.local.clients.find(x => x.id === 'c1')?.nombre === 'Ana en vivo');

const activity = C.window.CORE.beginActivity(['clients'], { test: true });
const deferredClient = A.local.clients.find(x => x.id === 'c1');
deferredClient.nombre = 'Ana diferida';
A.STORE.pushRows('clients', [deferredClient]);
await sleep(150);
ok('9. H-77: el segundo cambio quedó confirmado en la nube',
  cloud.rows.clients.get('c1')?.nombre === 'Ana diferida');
ok('9a. H-77: una captura activa no se reemplaza debajo del usuario',
  C.local.clients.find(x => x.id === 'c1')?.nombre === 'Ana en vivo');
C.window.CORE.endActivity(activity);
await sleep(300);
ok('9b. H-77: al terminar la captura se aplica el cambio remoto diferido',
  C.local.clients.find(x => x.id === 'c1')?.nombre === 'Ana diferida');
ok('10. H-77: el estado final deja de mostrarse como reconciliando',
  C.STORE.syncStatus().reconciling === false && C.STORE.syncStatus().synchronized === true);

process.exit(fail ? 1 : 0);
