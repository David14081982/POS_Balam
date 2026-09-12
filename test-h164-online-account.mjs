import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const resources = JSON.parse(fs.readFileSync('balam/vendor/build-resources.json', 'utf8'));
const babelContext = vm.createContext({ console });
vm.runInContext(Buffer.from(resources[Object.keys(resources).find(key => key.includes('@babel/'))].data, 'base64').toString(), babelContext);
const source = fs.readFileSync('supabase/functions/admin-users/index.ts', 'utf8').replace(/^import .*;$/m, '');
const code = babelContext.Babel.transform(source, { filename: 'admin-users.ts', plugins: ['transform-typescript'] }).code;
const actor = '11111111-1111-4111-8111-111111111111';
const target = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
let receipt = null, authWrites = 0, profileWrites = 0, lostResponse = true, requestHandler;
let user = { id: target, email: 'before@example.test', app_metadata: {} };
let seller = { id: target, email: user.email, nombre: 'QA', role: 'vendedor', sync_version: 3, active: true };
const receipts = new Map();
function from(table) {
  const filters = {};
  return { select() { return this; }, eq(key, value) { filters[key] = value; return this; },
    async maybeSingle() {
      if (table === 'online_account_requests') return { data: receipt && filters.actor_id === actor && filters.request_id === requestId ? structuredClone(receipt) : null };
      assert.equal(table, 'sellers'); return { data: structuredClone(seller) };
    },
  };
}
const caller = { from, auth: { getUser: async () => ({ data: { user: { id: actor } } }) },
  async rpc(name, args) {
    if (name === 'current_has_capability') return { data: true };
    if (name === 'online_connectivity') return { data: { ok: true } };
    assert.equal(name, 'execute_online_command');
    let result = receipts.get(args.p_request_id);
    if (!result) {
      profileWrites++;
      assert.equal(args.p_command.accountRequestId, requestId);
      assert.equal(args.p_command.expectedActorId, actor);
      seller = { ...seller, ...args.p_command.rows[0], sync_version: 4 };
      result = { ok: true, requestId: args.p_request_id, result: [seller] };
      receipts.set(args.p_request_id, result);
    }
    if (lostResponse) { lostResponse = false; throw new Error('Failed to fetch after COMMIT'); }
    return { data: result };
  },
};
const service = { from,
  auth: { admin: {
    getUserById: async () => ({ data: { user: structuredClone(user) } }),
    async updateUserById(id, attributes) { assert.equal(id, target); authWrites++; user = { ...user, ...attributes }; return { data: { user } }; },
  } },
  async rpc(name, args) {
    if (name === 'prepare_online_account') {
      assert.equal(args.p_actor_id, actor);
      assert.equal(JSON.stringify(args.p_payload).includes('temporary-secret'), false);
      receipt = { actor_id: actor, request_id: requestId, action: args.p_payload.action,
        state: 'prepared', target_user_id: target, payload: structuredClone(args.p_payload), result: null };
    } else {
      assert.equal(name, 'advance_online_account');
      receipt = { ...receipt, state: args.p_state, target_user_id: args.p_target_user_id,
        result: args.p_result || receipt.result };
    }
    return { data: structuredClone(receipt) };
  },
};
const context = vm.createContext({ console, Response, Request, TextEncoder, crypto: webcrypto, structuredClone,
  createClient(url, key, options) {
    if (key === 'anon') { assert.equal(options.global.headers['x-balam-device-id'], 'qa-device'); return caller; }
    return service;
  },
  Deno: { env: { get: key => ({ SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' })[key] },
    serve: handler => { requestHandler = handler; } },
});
vm.runInContext(code, context);
const request = body => new Request('https://example.test/admin-users', { method: 'POST', headers: {
  Authorization: 'Bearer fixture', 'Content-Type': 'application/json', 'x-balam-device-id': 'qa-device',
}, body: JSON.stringify(body) });
const crossedSession = await requestHandler(request({ action: 'update', requestId, expectedActorId: target,
  id: target, baseVersion: 3, email: 'wrong-session@example.test' }));
assert.equal(crossedSession.status, 409);
assert.equal((await crossedSession.json()).error.code, 'ONLINE_SESSION_CHANGED');
assert.equal(authWrites, 0);
assert.equal(profileWrites, 0);
assert.equal(receipt, null);
const first = await requestHandler(request({ action: 'update', requestId, expectedActorId: actor, id: target, baseVersion: 3,
  email: 'after@example.test', nombre: 'QA editado', password: 'temporary-secret', role: 'vendedor', metaMes: 1000 }));
assert.equal(first.status, 202);
assert.equal((await first.json()).error, 'Estamos confirmando la operación. No la repitas.');
assert.equal(receipt.state, 'auth_confirmed');
const resolved = await requestHandler(request({ action: 'resolve', requestId, expectedActorId: actor }));
assert.equal(resolved.status, 200);
assert.equal((await resolved.json()).ok, true);
assert.equal(authWrites, 1);
assert.equal(profileWrites, 1);
assert.equal(receipt.state, 'completed');
assert.equal(seller.email, user.email);
assert.equal(seller.meta_mes, 1000);
console.log('PASS H164 account: pérdida de respuesta tras COMMIT consultada con identidad estable, Auth/perfil una escritura cada uno; contraseña no persistida');
