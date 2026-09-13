// Node-only H171 preparation journal. This records intent, never certification.
// Every later Playwright interceptor must also use wrapRoute/beforeRoute: a
// route.continue() or route.fetch() bypasses an earlier context route.
import * as fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';

const FORMAT = 'balam-live-journal-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET = /password|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|cookie|secret|jwt/i;
const WRITES = new Set(['execute_online_command', 'online_presence', 'online_adoption_report', 'resolve_online_request']);
export const LIVE_READ_RPCS = Object.freeze(['online_connectivity', 'online_snapshot_if_changed',
  'online_request_result', 'current_permission_snapshot',
  'admin_user_permission_editor_snapshot', 'physical_card_available', 'point_zero_preview',
  'point_zero_receipt', 'preview_test_data_cleanup', 'test_data_cleanup_receipt']);
const stable = value => Array.isArray(value) ? '[' + value.map(stable).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}' : JSON.stringify(value);
export const journalHash = value => createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
const error = code => Object.assign(new Error(code), { code });
const requireValue = (ok, code) => { if (!ok) throw error(code); };
function safeJson(value) {
  const seen = new Set();
  function copy(v) {
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'string') { requireValue(!/\bBearer\s+\S+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(v), 'JOURNAL_SECRET_VALUE_FORBIDDEN'); return v; }
    if (typeof v === 'number') { requireValue(Number.isFinite(v), 'JOURNAL_INVALID_JSON'); return v; }
    requireValue(v && typeof v === 'object' && !seen.has(v) && (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null), 'JOURNAL_INVALID_JSON');
    seen.add(v);
    const result = Array.isArray(v) ? v.map(copy) : Object.fromEntries(Object.entries(v).map(([k, child]) => {
      requireValue(!SECRET.test(k) && !['headers', '__proto__', 'constructor', 'prototype'].includes(k), 'JOURNAL_SECRET_FIELD_FORBIDDEN');
      return [k, copy(child)];
    }));
    seen.delete(v); return result;
  }
  return copy(value);
}
const valueOf = value => typeof value === 'function' ? value() : value;

export async function openLiveJournal({ file, run, projectRef, artifactSha256, io = fs }) {
  requireValue(UUID.test(run || '') && /^[a-z0-9]{20}$/.test(projectRef || '') && /^[a-f0-9]{64}$/.test(artifactSha256 || ''), 'JOURNAL_IDENTITY_REQUIRED');
  file = resolve(file); const pending = file + '.pending', lockPath = file + '.lock';
  await io.mkdir(dirname(file), { recursive: true });
  let lock;
  try { lock = await io.open(lockPath, 'wx', 0o600); }
  catch { throw error('JOURNAL_ALREADY_OPEN_OR_LOCK_UNAVAILABLE'); }
  const identity = { format: FORMAT, run, projectRef, artifactSha256 };
  let state, tail = Promise.resolve(), failure = null, closed = false;
  const observed = new WeakMap();
  const latch = cause => { failure ||= error(cause?.code?.startsWith('JOURNAL_') ? cause.code : 'JOURNAL_PERSISTENCE_FAILED'); return failure; };
  async function persist(next) {
    const encoded = JSON.stringify({ ...next, checksum: journalHash(next) }, null, 2) + '\n';
    let handle;
    try {
      handle = await io.open(pending, 'wx', 0o600);
      await handle.writeFile(encoded, 'utf8'); await handle.sync();
      await handle.close(); handle = null;
      await io.rename(pending, file);
      // Flush the installed file too. Windows cannot fsync a directory handle;
      // POSIX additionally flushes the directory entry after the atomic rename.
      handle = await io.open(file, 'r+'); await handle.sync(); await handle.close(); handle = null;
      if (process.platform !== 'win32') { handle = await io.open(dirname(file), 'r'); await handle.sync(); await handle.close(); handle = null; }
    } finally { if (handle) await handle.close().catch(() => {}); }
  }
  try {
    await lock.writeFile(JSON.stringify({ run, pid: process.pid })); await lock.sync();
    let unfinished = false;
    try { await io.stat(pending); unfinished = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    requireValue(!unfinished, 'JOURNAL_PENDING_RECOVERY_REQUIRED');
    let text;
    try { text = await io.readFile(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (text !== undefined) {
      let parsed; try { parsed = JSON.parse(text); } catch { throw error('JOURNAL_CORRUPT'); }
      const { checksum, ...payload } = parsed;
      requireValue(checksum === journalHash(payload), 'JOURNAL_CORRUPT');
      requireValue(Object.keys(payload).every(key => [...Object.keys(identity), 'entries'].includes(key)), 'JOURNAL_CORRUPT');
      for (const [key, expected] of Object.entries(identity)) requireValue(payload[key] === expected, 'JOURNAL_IDENTITY_MISMATCH');
      requireValue(Array.isArray(payload.entries), 'JOURNAL_CORRUPT');
      let previousHash = null;
      payload.entries.forEach((entry, index) => {
        const { entryHash, ...body } = entry;
        requireValue(entry.sequence === index + 1 && entry.previousHash === previousHash && entryHash === journalHash(body), 'JOURNAL_CORRUPT');
        safeJson(body); previousHash = entryHash;
      });
      state = payload;
    } else { state = { ...identity, entries: [] }; await persist(state); }
  } catch (cause) {
    await lock.close().catch(() => {}); await io.unlink(lockPath).catch(() => {});
    throw error(cause?.code?.startsWith('JOURNAL_') ? cause.code : 'JOURNAL_OPEN_FAILED');
  }
  function assertHealthy() { if (failure) throw failure; requireValue(!closed, 'JOURNAL_CLOSED'); }
  function prepare(input) {
    let descriptor;
    try {
      assertHealthy();
      const allowed = new Set(['checkpoint', 'kind', 'requestId', 'actorId', 'identities', 'command', 'contextName', 'hashScope']);
      requireValue(input && Object.keys(input).every(k => allowed.has(k)), 'JOURNAL_DESCRIPTOR_FIELD_FORBIDDEN');
      descriptor = safeJson(input);
      requireValue(typeof descriptor.checkpoint === 'string' && descriptor.checkpoint.length > 0 && typeof descriptor.kind === 'string' && descriptor.kind.length > 0, 'JOURNAL_CHECKPOINT_REQUIRED');
      // Direct API helpers may not have a server idempotency key. Persist a
      // distinct local intent UUID before invoking them; never invent a receipt.
      descriptor.requestId ??= randomUUID();
      requireValue(typeof descriptor.requestId === 'string' && descriptor.requestId.length > 0, 'JOURNAL_REQUEST_ID_REQUIRED');
      requireValue(!descriptor.actorId || UUID.test(descriptor.actorId), 'JOURNAL_ACTOR_INVALID');
      descriptor.command ??= {}; descriptor.identities ??= {};
      descriptor.commandHash = journalHash(descriptor.command);
    } catch (cause) { return Promise.reject(latch(cause)); }
    const work = tail.then(async () => {
      assertHealthy();
      const previous = state.entries.find(e => e.kind === descriptor.kind && e.actorId === descriptor.actorId && e.requestId === descriptor.requestId);
      requireValue(!previous || previous.commandHash === descriptor.commandHash, 'JOURNAL_REQUEST_ID_REUSED_WITH_DIFFERENT_COMMAND');
      const body = { ...descriptor, sequence: state.entries.length + 1, preparedAt: new Date().toISOString(), previousHash: state.entries.at(-1)?.entryHash ?? null };
      const entry = { ...body, entryHash: journalHash(body) };
      const next = { ...state, entries: [...state.entries, entry] };
      await persist(next); state = next; return structuredClone(entry);
    }).catch(cause => { throw latch(cause); });
    tail = work.catch(() => {}); return work;
  }
  async function beforeMutation(descriptor, mutate) {
    requireValue(typeof mutate === 'function', 'JOURNAL_MUTATION_CALLBACK_REQUIRED');
    const entry = await prepare(descriptor);
    assertHealthy(); return mutate(entry);
  }
  async function prepareAuthPrincipal({ userId, checkpoint = 'bootstrap / principal Auth', email, contextName = 'Node' }) {
    requireValue(UUID.test(userId || ''), 'JOURNAL_AUTH_ID_REQUIRED');
    return prepare({ kind: 'auth-principal', checkpoint, requestId: userId, contextName,
      identities: { userId }, command: { action: 'create', userId, ...(email ? { emailSha256: journalHash(String(email).trim().toLowerCase()) } : {}) } });
  }
  async function describeRequest(request, meta) {
    const origin = meta.origin || 'https://' + projectRef + '.supabase.co';
    requireValue(new URL(origin).origin === 'https://' + projectRef + '.supabase.co', 'JOURNAL_ORIGIN_MISMATCH');
    const address = new URL(request.url()), method = request.method().toUpperCase();
    if (address.origin !== origin && ['GET', 'HEAD'].includes(method) && (meta.readOrigins || []).includes(address.origin)) return null;
    requireValue(address.origin === origin, 'JOURNAL_FOREIGN_ORIGIN');
    const path = address.pathname, read = ['GET', 'HEAD', 'OPTIONS'].includes(method);
    // Never read or persist headers, Auth session bodies, URL queries or passwords.
    if (path.startsWith('/auth/v1/')) {
      requireValue((['/auth/v1/token', '/auth/v1/logout'].includes(path) && ['POST', 'OPTIONS'].includes(method)) || (path === '/auth/v1/user' && read), 'JOURNAL_BROWSER_AUTH_MUTATION_FORBIDDEN');
      return null;
    }
    if (method === 'OPTIONS') return null;
    let body;
    const parseBody = () => { if (!body) { try { body = request.postDataJSON(); } catch { throw error('JOURNAL_INVALID_REQUEST_BODY'); } } requireValue(body && typeof body === 'object' && !Array.isArray(body), 'JOURNAL_INVALID_REQUEST_BODY'); return body; };
    const actorId = valueOf(meta.actorId);
    const common = { checkpoint: valueOf(meta.checkpoint) || 'unscoped', contextName: valueOf(meta.contextName) || 'browser', ...(actorId ? { actorId } : {}) };
    if (path === '/functions/v1/admin-users') {
      requireValue(method === 'POST', 'JOURNAL_WRITE_METHOD_INVALID'); const account = parseBody();
      requireValue(UUID.test(common.actorId || ''), 'JOURNAL_ACTOR_REQUIRED');
      requireValue(UUID.test(account.requestId || '') && ['create', 'update', 'delete', 'resolve'].includes(account.action), 'JOURNAL_ACCOUNT_REQUEST_INVALID');
      const command = { requestId: account.requestId, action: account.action,
        ...(account.id ? { targetUserId: account.id } : {}), ...(account.email ? { emailSha256: journalHash(String(account.email).trim().toLowerCase()) } : {}) };
      return { ...common, kind: 'edge:admin-users:' + account.action, requestId: account.requestId,
        identities: { requestId: account.requestId, ...(account.id ? { userId: account.id } : {}) }, command, hashScope: 'account identity metadata only; credentials and other payload fields excluded' };
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      const name = path.slice('/rest/v1/rpc/'.length);
      requireValue(!name.includes('/') && name !== 'archive_online_legacy', 'JOURNAL_LEGACY_OR_UNKNOWN_RPC_FORBIDDEN');
      if (WRITES.has(name)) {
        requireValue(method === 'POST', 'JOURNAL_WRITE_METHOD_INVALID'); const payload = safeJson(parseBody());
        requireValue(UUID.test(common.actorId || ''), 'JOURNAL_ACTOR_REQUIRED');
        if (name === 'execute_online_command') {
          requireValue(UUID.test(payload.p_request_id || '') && payload.p_command && typeof payload.p_command.type === 'string', 'JOURNAL_COMMAND_IDENTITY_REQUIRED');
          return { ...common, kind: 'rpc:' + name, requestId: payload.p_request_id, command: payload.p_command, identities: { requestId: payload.p_request_id }, hashScope: 'complete RPC command, without transport headers' };
        }
        if (name === 'resolve_online_request') {
          requireValue(UUID.test(payload.p_request_id || ''), 'JOURNAL_COMMAND_IDENTITY_REQUIRED');
          return { ...common, kind: 'rpc:' + name, requestId: payload.p_request_id, command: payload,
            identities: { requestId: payload.p_request_id }, hashScope: 'complete resolution arguments; may insert cancelled receipt' };
        }
        requireValue(typeof payload.p_device_id === 'string' && payload.p_device_id.length > 0, 'JOURNAL_DEVICE_ID_REQUIRED');
        return { ...common, kind: 'rpc:' + name, requestId: name + ':' + payload.p_device_id + ':' + journalHash(payload),
          identities: { deviceId: payload.p_device_id }, command: payload, hashScope: 'complete device metadata arguments' };
      }
      const reads = meta.readRpcs || LIVE_READ_RPCS;
      requireValue(reads.includes(name) && LIVE_READ_RPCS.includes(name), 'JOURNAL_UNKNOWN_RPC_FORBIDDEN');
      requireValue(read || method === 'POST', 'JOURNAL_READ_METHOD_INVALID'); return null;
    }
    requireValue(read && (path.startsWith('/rest/v1/') || path.startsWith('/storage/v1/')), 'JOURNAL_UNREGISTERED_BROWSER_WRITE');
    return null;
  }
  function beforeRoute(request, meta = {}) {
    try { assertHealthy(); } catch (cause) { return Promise.reject(cause); }
    if (observed.has(request)) return observed.get(request).then(result => { assertHealthy(); return result; });
    const work = (async () => {
      assertHealthy(); const descriptor = await describeRequest(request, meta);
      if (!descriptor) return { readOnly: true };
      const entry = await prepare(descriptor);
      if (meta.onPrepared) await meta.onPrepared(entry);
      assertHealthy(); return { readOnly: false, entry };
    })().catch(cause => { throw latch(cause); });
    observed.set(request, work); return work;
  }
  function wrapRoute(handler, meta = {}) {
    return async route => {
      try { await beforeRoute(route.request(), meta); assertHealthy(); }
      catch (cause) {
        await route.abort('blockedbyclient').catch(() => {});
        if (meta.onBlocked) await meta.onBlocked({ code: cause.code, phase: 'preparation', dispatched: false });
        return;
      }
      let dispatched = false;
      const guarded = new Proxy(route, { get(target, key) {
        const member = Reflect.get(target, key, target);
        if (typeof member !== 'function') return member;
        return (...args) => {
          if (['continue', 'fetch', 'fallback'].includes(key)) { assertHealthy(); dispatched = true; }
          return member.apply(target, args);
        };
      } });
      try { return await handler(guarded); }
      catch {
        // A prepared intent does not prove that a failed handler sent nothing.
        // Preserve that distinction when HTTP may already have reached Supabase.
        const cause = latch(error(dispatched ? 'JOURNAL_HANDLER_FAILED_AFTER_DISPATCH' : 'JOURNAL_HANDLER_FAILED_BEFORE_DISPATCH'));
        await route.abort('blockedbyclient').catch(() => {});
        const notify = dispatched ? meta.onFailed : meta.onBlocked;
        if (notify) await notify({ code: cause.code, phase: 'handler', dispatched });
      }
    };
  }
  async function installContextRoutes(context, meta = {}) {
    const origin = meta.origin || 'https://' + projectRef + '.supabase.co';
    const handler = wrapRoute(meta.forward || (route => route.continue()), { ...meta, origin });
    await context.route(origin + '/**', handler);
    return () => context.unroute(origin + '/**', handler);
  }
  async function flush() { await tail; assertHealthy(); }
  async function close() {
    await tail; if (closed) return; closed = true;
    await lock.close(); await io.unlink(lockPath);
  }
  return { prepare, beforeMutation, prepareAuthPrincipal, beforeRoute, wrapRoute, installContextRoutes,
    snapshot: () => structuredClone(state), flush, assertHealthy, close, get failure() { return failure?.code ?? null; } };
}
