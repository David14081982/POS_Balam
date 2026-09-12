// H164 source architecture guard. Static consumer/storage proof, not SQL or A/B/C certification.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = file => fs.readFileSync(file, 'utf8');
const resources = JSON.parse(read('balam/vendor/build-resources.json'));
const context = vm.createContext({ console });
vm.runInContext(Buffer.from(resources[Object.keys(resources).find(key => key.includes('@babel/'))].data, 'base64').toString(), context);
const Babel = context.Babel, traverse = Babel.packages.traverse.default;
const parse = source => Babel.transform(source, { ast: true, code: false, plugins: ['syntax-jsx'] }).ast;
const files = [...read('balam/_source.html').matchAll(/src="(balam\/[^"/]+\.jsx)"/g)].map(match => match[1]);
assert.ok(files.includes('balam/store.jsx') && files.includes('balam/data.jsx'));
const trees = new Map(files.map(file => [file, parse(read(file))]));
const member = node => node && ['MemberExpression', 'OptionalMemberExpression'].includes(node.type);
const call = node => node && ['CallExpression', 'OptionalCallExpression'].includes(node.type);
const prop = node => member(node) ? node.computed ? node.property.type === 'StringLiteral' ? node.property.value : null : node.property.name : null;
const key = node => node.computed ? node.key?.type === 'StringLiteral' ? node.key.value : null : node.key?.name || node.key?.value;
function literal(node, scope, seen = new Set()) {
  if (!node) return undefined;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'Identifier' && !seen.has(node.name)) {
    const binding = scope.getBinding(node.name); seen.add(node.name);
    return literal(binding?.path.node.init, binding?.path.scope || scope, seen);
  }
  return undefined;
}
function namespace(node, scope, seen = new Set()) {
  if (!node) return null;
  if (member(node) && node.object?.name === 'window' && ['DATA', 'STORE', 'CORE'].includes(prop(node))) return prop(node);
  if (node.type === 'LogicalExpression') return node.operator === '&&' ? namespace(node.right, scope, seen)
    : namespace(node.left, scope, new Set(seen)) || namespace(node.right, scope, new Set(seen));
  if (node.type !== 'Identifier' || seen.has(node.name)) return null;
  const binding = scope.getBinding(node.name); seen.add(node.name);
  if (!binding && ['DATA','STORE','CORE'].includes(node.name)) return node.name;
  return namespace(binding?.path.node.init, binding?.path.scope || scope, seen);
}
function exportsOf(tree, name) {
  const names = new Set();
  traverse(tree, {
    AssignmentExpression(path) {
      if (member(path.node.left) && path.node.left.object.name === 'window' && prop(path.node.left) === name && path.node.right.type === 'ObjectExpression')
        for (const item of path.node.right.properties) if (key(item)) names.add(key(item));
    },
    CallExpression(path) {
      const node = path.node;
      if (member(node.callee) && node.callee.object.name === 'Object' && prop(node.callee) === 'defineProperties'
        && namespace(node.arguments[0], path.scope) === name && node.arguments[1]?.type === 'ObjectExpression')
        for (const item of node.arguments[1].properties) if (key(item)) names.add(key(item));
    },
  });
  assert.ok(names.size > 5, name + ' public exports must be discovered from source');
  return names;
}
const exported = { DATA: exportsOf(trees.get('balam/data.jsx'), 'DATA'), STORE: exportsOf(trees.get('balam/store.jsx'), 'STORE') };
const retired = new Set(['flushQueue','queueStatus','retryOperation','discardOperation','claimLegacyQueue',
  'ensureQueueDurability','enqueue','enqueueOp','drainQueue','requestRebootstrap','rebootstrap','writerStatus',
  'acquireWriter','saveProducts','saveClients','saveSales','savePayments','saveReturns','saveExchanges','saveLoans',
  'applyRemote','mergeRemote']);
const allowedStorage = new Set(['balam_device_id','balam-page','balam-sidebar','balam_ultima_operacion','balam_pwa_brand_v1']);
const storeReads = new Set(['online_connectivity','online_snapshot','online_presence','online_adoption_report','resolve_online_request','online_request_result',
  'archive_online_legacy','execute_online_command','physical_card_available','point_zero_preview','point_zero_receipt',
  'preview_test_data_cleanup','test_data_cleanup_receipt']);
const permissionReads = new Set(['admin_screen_permission_catalog_snapshot','admin_permission_users','admin_user_permission_editor_snapshot']);
const permissionCommands = new Set(['admin_sync_screen_permission_catalog','admin_apply_user_screen_permissions_checked']);
const nearestFunction = path => { const fn = path.findParent(parent => parent.isFunction()
  && (parent.node.id?.name || parent.parentPath?.isVariableDeclarator()));
  return fn?.node.id?.name || fn?.parentPath?.node.id?.name || null; };
function hasFrom(node) {
  if (!node || typeof node !== 'object') return false;
  if (call(node) && member(node.callee) && prop(node.callee) === 'from') return true;
  return Object.entries(node).some(([name,value]) => name !== 'loc' && (Array.isArray(value) ? value.some(hasFrom) : hasFrom(value)));
}
function audit(file, tree) {
  const issues = [];
  const fail = (path, detail) => issues.push(file + ':' + path.node.loc.start.line + ' ' + detail);
  traverse(tree, {
    MemberExpression(path) { inspectMember(path); },
    OptionalMemberExpression(path) { inspectMember(path); },
    CallExpression(path) { inspectCall(path); },
    OptionalCallExpression(path) { inspectCall(path); },
    FunctionDeclaration(path) { if (retired.has(path.node.id?.name) && !(file === 'balam/print-manager.jsx' && path.node.id.name === 'enqueue'))
      fail(path, 'retired local-first function ' + path.node.id.name); },
  });
  function inspectMember(path) {
    const ns = namespace(path.node.object, path.scope), name = prop(path.node);
    if (ns && exported[ns] && name && !exported[ns].has(name)) fail(path, ns + '.' + name + ' is not exported');
    if (ns && retired.has(name)) fail(path, 'retired commercial API ' + ns + '.' + name);
    if (['balam/data.jsx','balam/config.jsx','balam/auth.jsx'].includes(file) && ns === 'STORE') fail(path, 'domain bypasses CORE gateway');
  }
  function inspectCall(path) {
    const node = path.node, name = prop(node.callee), owner = nearestFunction(path);
    if (['insert','upsert','update','delete'].includes(name) && hasFrom(node.callee.object)) fail(path, 'raw Supabase table mutation outside online gateway');
    if (name === 'rpc') {
      const allowed = file === 'balam/store.jsx' && owner === 'readRpc' && node.arguments[0]?.name === 'name'
        || file === 'balam/permissions.jsx' && owner === 'rpc' && node.arguments[0]?.name === 'name'
        || file === 'balam/auth.jsx' && literal(node.arguments[0],path.scope) === 'current_permission_snapshot';
      if (!allowed) fail(path, 'unregistered direct RPC');
    }
    if (node.callee.type === 'Identifier' && node.callee.name === 'readRpc' && !storeReads.has(literal(node.arguments[0],path.scope))) fail(path, 'unregistered gateway RPC');
    if (node.callee.type === 'Identifier' && node.callee.name === 'rpc' && file === 'balam/permissions.jsx'
      && ![...permissionReads,...permissionCommands].includes(literal(node.arguments[0],path.scope))) fail(path, 'unregistered permission RPC');
    if (name === 'invokeSync' && namespace(node.callee.object,path.scope) === 'CORE'
      || node.callee.type === 'Identifier' && node.callee.name === 'confirmCommand') {
      const method = literal(node.arguments[0],path.scope);
      // The one DATA dispatcher forwards its parameter; every caller is checked above.
      if (!method && !(file === 'balam/data.jsx' && owner === 'confirmCommand' && node.arguments[0]?.name === 'name')) fail(path, 'dynamic commercial gateway method');
      if (method && !exported.STORE.has(method)) fail(path, 'gateway consumer has no STORE.' + method);
    }
    const object = node.callee?.object;
    const storage = object?.name === 'localStorage' || member(object) && object.object.name === 'window' && prop(object) === 'localStorage';
    if (storage && ['getItem','setItem'].includes(name)) {
      if (['balam/data.jsx','balam/config.jsx','balam/auth.jsx'].includes(file)) fail(path, 'commercial model reads/writes browser storage');
      if (name === 'setItem' && !(file === 'balam/store.jsx' && owner === 'remember') && !allowedStorage.has(literal(node.arguments[0],path.scope))) fail(path, 'unregistered persisted browser key');
    }
    if (name === 'open' && object?.name === 'indexedDB' && !(file === 'balam/store.jsx' && ['legacyIndexedDB','removeArchivedIndexedDB'].includes(owner))) fail(path, 'IndexedDB outside exact legacy archival');
    if (['put','add','addAll'].includes(name) && file === 'balam/store.jsx') fail(path, 'commercial coordinator creates local durable records');
    if (node.callee.type === 'Identifier' && node.callee.name === 'remember') {
      const binding = node.arguments[0]?.type === 'Identifier' && path.scope.getBinding(node.arguments[0].name);
      const value = binding?.path.node.init;
      if (value?.type !== 'ObjectExpression' || value.properties.some(item => !['requestId','userId','kind','fingerprint'].includes(key(item)))) fail(path, 'result reference contains unexpected payload or is not inspectable');
    }
  }
  return issues;
}
const issues = [...trees].flatMap(([file,tree]) => audit(file,tree));
for (const name of retired) for (const ns of ['DATA','STORE']) if (exported[ns].has(name)) issues.push(ns + ' still exports retired ' + name);
// A permissions helper must return the gateway receipt before the direct read branch.
const permissions = read('balam/permissions.jsx');
assert.ok(permissions.indexOf('return receipt.result;') < permissions.indexOf("client.schema('pos').rpc"));
for (const name of permissionCommands) assert.ok(permissions.includes("'" + name + "'"));
const entryFiles = [...read('POS Balam.html').matchAll(/src="(balam\/[^"/]+\.jsx)"/g)].map(match => match[1]);
assert.deepEqual(entryFiles, files, 'entry and build source load the same modules');
assert.ok(read('sw.js').includes("if (!inScope(url) || request.method !== 'GET') return;"));
assert.ok(read('sw.js').includes('if (STATIC_PATHS.includes(path))'));
// Guard sensitivity: this fixture is rejected without touching any commercial state.
const forbidden = audit('balam/fixture.jsx', parse("window.STORE.flushQueue(); c.from('sales').insert({}); localStorage.setItem('balam_pos_sales_v1','[]'); window.DATA.missingCommercialMethod();"));
assert.ok(forbidden.some(item => item.includes('retired commercial API')) && forbidden.some(item => item.includes('raw Supabase'))
  && forbidden.some(item => item.includes('persisted browser key')) && forbidden.some(item => item.includes('not exported')),
  'architecture guard must detect forbidden mutations, storage and dead consumers');
assert.deepEqual(issues, [], 'online-only architecture violations:\n' + issues.join('\n'));
console.log(JSON.stringify({ ok: true, modules: files.length, dataExports: exported.DATA.size, storeExports: exported.STORE.size,
  checked: ['no raw table mutation','RPC boundary','retired commercial APIs','public consumers','storage ownership','technical receipt shape','PWA scope'],
  limitation: 'Static guard does not certify runtime SQL, physical installations or unresolved legacy data.' }));
