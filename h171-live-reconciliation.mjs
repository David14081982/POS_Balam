// H171: read-only reconciliation, never replay, cleanup or certification.
import { createHash } from 'node:crypto';
import { journalHash } from './h171-live-journal.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET = /password|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|cookie|secret|jwt/i;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const requireValue = (ok, code) => { if (!ok) fail(code); };
const same = (a, b) => journalHash(a) === journalHash(b);
const clean = value => Array.isArray(value) ? value.map(clean) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET.test(key)).map(([key, child]) => [key, clean(child)])) : value;
function numberText(value) {
  requireValue(Number.isFinite(value), 'INVALID_JSON_NUMBER');
  const text = JSON.stringify(value); if (!/[eE]/.test(text)) return text;
  const [mantissa, exponent] = text.toLowerCase().split('e'), sign = mantissa.startsWith('-') ? '-' : '';
  const unsigned = mantissa.replace(/^-/, ''), digits = unsigned.replace('.', '');
  const point = (unsigned.indexOf('.') < 0 ? unsigned.length : unsigned.indexOf('.')) + Number(exponent);
  return sign + (point <= 0 ? '0.' + '0'.repeat(-point) + digits : point >= digits.length ? digits + '0'.repeat(point - digits.length) : digits.slice(0, point) + '.' + digits.slice(point));
}
// PostgreSQL jsonb text uses UTF-8 key length/order and expanded numeric values.
// Tests compare this encoder with PostgreSQL itself (local PGlite), not a mirror.
export function postgresJsonbText(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return numberText(value);
  if (Array.isArray(value)) return '[' + value.map(postgresJsonbText).join(', ') + ']';
  requireValue(value && typeof value === 'object', 'INVALID_JSON_VALUE');
  const keys = Object.keys(value).sort((a, b) => Buffer.byteLength(a) - Buffer.byteLength(b) || Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return '{' + keys.map(key => JSON.stringify(key) + ': ' + postgresJsonbText(value[key])).join(', ') + '}';
}
export const postgresJsonbHash = value => createHash('sha256').update(postgresJsonbText(value)).digest('hex');
const tablePk = { sales: 'folio', stock_reservations: 'operation_id', config_commits: 'operation_id', reference_reclassifications: 'operation_id',
  commission_adjustments: 'operation_id', capability_operation_audit: 'operation_id', sale_commits: 'commit_id', return_commits: 'commit_id',
  exchange_commits: 'commit_id', layaway_liquidation_commits: 'commit_id', settings: 'key', user_permission_role_assignments: 'user_id', sync_devices: 'device_id' };
const entities = new Set(['products', 'clients', 'sellers', 'promotions']);
const supported = new Set(['upsert', 'profileUpdate', 'staffUpdate', 'softDelete', 'productDeleteScope', 'config', 'sale', 'return', 'exchange',
  'loanOperation', 'referenceReclassification', 'commissionSettle', 'commissionAdjustment', 'folio', 'deviceUpdate', 'deviceRetire', 'permissions', 'batch']);
function supportedCommand(command, depth = 0) {
  requireValue(supported.has(command?.type), 'COMMAND_TYPE_UNSUPPORTED');
  if (command.type === 'batch') {
    requireValue(depth === 0 && Array.isArray(command.commands) && command.commands.length > 0, 'BATCH_COMMAND_INVALID');
    for (const child of command.commands) supportedCommand(child, depth + 1);
  }
}

// The runner saves these exact identities with journal.prepare before provisioning.
// This entry describes a plan; it provides no evidence that any HTTP write happened.
function validateFixturePlan(entry, fixtures, snapshot) {
  const products = fixtures.products, core = fixtures.coreJourney;
  requireValue(Array.isArray(products) && products.length === 9 && new Set(products).size === 9 &&
    products.every(id => UUID.test(id || '') && id[14] === '4') && core?.schema === 'h171-core-ui-v1' &&
    same(core.productIds, products.slice(7)) && core.referenceFamilyId === products[7] &&
    same(core.initialStocks, [3, 2]) && core.unitPrice === 116, 'FIXTURE_PLAN_MANIFEST_MISMATCH');
  requireValue(entry.actorId == null && (!entry.contextName || entry.contextName === 'Node') &&
    entry.requestId === snapshot.run && entry.checkpoint === 'bootstrap / exact product identities before provisioning',
  'FIXTURE_PLAN_CONTEXT_MISMATCH');
  requireValue(same(entry.identities, { productIds: products, coreJourneyProductIds: core.productIds }) &&
    same(entry.command, { run: snapshot.run, coreJourney: {
      schema: core.schema, productIds: core.productIds, referenceFamilyId: core.referenceFamilyId,
      initialStocks: core.initialStocks, unitPrice: core.unitPrice,
    } }), 'FIXTURE_PLAN_METADATA_MISMATCH');
}

export function createLiveReconciler({ db, admin, expectedProjectRef, expectedActorId, protectedAuthIds = [] }) {
  requireValue(/^[a-z0-9]{20}$/.test(expectedProjectRef || '') && UUID.test(expectedActorId || ''), 'EXPECTED_AUTHORITY_REQUIRED');
  const origin = 'https://' + expectedProjectRef + '.supabase.co';
  // These are SDK URL properties, never headers or session credentials.
  requireValue(new URL(String(db?.url)).origin === origin && new URL(String(admin?.supabaseUrl)).origin === origin, 'CLIENT_PROJECT_MISMATCH');
  requireValue(new URL(String(db.url)).pathname.replace(/\/$/, '') === '/rest/v1', 'CLIENT_DATABASE_PATH_MISMATCH');
  requireValue(db.schemaName === 'pos', 'CLIENT_SCHEMA_MISMATCH');
  const protectedIds = new Set(protectedAuthIds);

  async function reconcile({ snapshot, fixtures }) {
    const result = { format: 'balam-live-reconciliation-v1', readOnly: true, reconciled: false, certified: false, cleanupVerified: false, cleanupManifestComplete: false,
      run: snapshot?.run ?? null, projectRef: expectedProjectRef, actorId: expectedActorId, artifactSha256: snapshot?.artifactSha256 ?? null,
      entries: [], blockers: [], identities: { rows: [], authUsers: [], devices: [], requests: [], folios: [] },
      identityScope: 'Observed or referenced candidates only; does not prove QA ownership or authorize deletion',
      rowHashScope: 'Parsed PostgREST JSON without credential fields; not a canonical SQL backup hash', reads: 0 };
    const block = (code, sequence = null) => result.blockers.push({ code, ...(sequence === null ? {} : { sequence }) });
    const rowIndex = new Map(), userCache = new Map(), receiptCache = new Map();
    const ownedAccounts = new Map();
    let prefix, entries;
    try {
      requireValue(snapshot?.format === 'balam-live-journal-v1' && UUID.test(snapshot.run || '') && /^[a-f0-9]{64}$/.test(snapshot.artifactSha256 || ''), 'JOURNAL_IDENTITY_INVALID');
      requireValue(snapshot.projectRef === expectedProjectRef && fixtures?.run === snapshot.run && fixtures?.userId === expectedActorId, 'RUN_OR_ACTOR_MISMATCH');
      prefix = 'qa-h164-' + snapshot.run;
      requireValue(fixtures.prefix === prefix && fixtures.email === prefix + '@example.test', 'FIXTURE_IDENTITY_MISMATCH');
      requireValue(same(fixtures.installations, ['A', 'B', 'C'].map(letter => prefix + '-' + letter)), 'INSTALLATION_MANIFEST_MISMATCH');
      requireValue(!protectedIds.has(expectedActorId), 'PROTECTED_AUTH_ID');
      entries = snapshot.entries;
      requireValue(Array.isArray(entries) && entries.length > 0, 'EMPTY_OR_INVALID_JOURNAL');
      let previousHash = null;
      for (const [index, entry] of entries.entries()) {
        const { entryHash, ...body } = entry;
        requireValue(entry.sequence === index + 1 && entry.previousHash === previousHash && entryHash === journalHash(body) && entry.commandHash === journalHash(entry.command), 'JOURNAL_INTEGRITY_MISMATCH');
        requireValue(same(clean(entry.command), entry.command), 'JOURNAL_SECRET_FIELD');
        if (entry.kind === 'fixture-plan') validateFixturePlan(entry, fixtures, snapshot);
        else requireValue(entry.actorId === expectedActorId || (entry.kind === 'auth-principal' && entry.identities?.userId === expectedActorId), 'ENTRY_ACTOR_MISMATCH');
        previousHash = entryHash;
      }
      result.snapshotSha256 = journalHash(snapshot); result.lastEntryHash = previousHash;
    } catch (cause) { block(cause.code || 'INVALID_INPUT'); return result; }

    async function select(table, filters, columns = '*') {
      requireValue(Object.values(filters).every(value => value !== null && value !== undefined && ['string', 'number', 'boolean'].includes(typeof value)), 'EXACT_READ_FILTER_REQUIRED');
      result.reads++;
      let query = db.from(table).select(columns);
      for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
      const response = await query.limit(1001);
      requireValue(!response?.error && Array.isArray(response?.data), 'AUTHORITY_READ_FAILED');
      // PostgREST may cap responses at 1000 even when 1001 was requested.
      // A full page is ambiguous; never certify an apparently complete scope.
      requireValue(response.data.length < 1000, 'EXACT_SCOPE_ROW_LIMIT');
      for (const row of response.data) requireValue(Object.entries(filters).every(([key, value]) => row[key] === value), 'AUTHORITY_FILTER_MISMATCH');
      return response.data;
    }
    async function one(table, filters) {
      const rows = await select(table, filters); requireValue(rows.length <= 1, 'DUPLICATE_AUTHORITY_IDENTITY'); return rows[0] ?? null;
    }
    function identity(table, row, sequence, source = 'authority') {
      const keys = table === 'user_screen_permission_overrides' ? ['user_id', 'screen_key'] : [tablePk[table] || 'id'];
      requireValue(row && keys.every(key => row[key] !== undefined && row[key] !== null), 'ROW_PRIMARY_KEY_MISSING');
      requireValue(keys.every(key => typeof row[key] !== 'number' || Number.isSafeInteger(row[key])), 'ROW_PRIMARY_KEY_PRECISION_UNSAFE');
      const pk = Object.fromEntries(keys.map(key => [key, row[key]])), index = table + ':' + journalHash(pk);
      const existing = rowIndex.get(index) || { table, pk, sequences: [], sources: [], ownership: 'UNCLASSIFIED' };
      if (!existing.sequences.includes(sequence)) existing.sequences.push(sequence);
      if (!existing.sources.includes(source)) existing.sources.push(source);
      if (source === 'authority') {
        const hash = postgresJsonbHash(clean(row));
        requireValue(!existing.observedContentSha256 || existing.observedContentSha256 === hash, 'OBSERVED_ROW_CHANGED_DURING_RECONCILIATION');
        existing.observedContentSha256 = hash;
      }
      rowIndex.set(index, existing); return existing;
    }
    async function requiredRow(table, filters, sequence) {
      const row = await one(table, filters); requireValue(row, 'REFERENCED_ROW_MISSING'); identity(table, row, sequence); return row;
    }
    async function authUser(id) {
      requireValue(UUID.test(id || '') && !protectedIds.has(id), 'PROTECTED_OR_INVALID_AUTH_ID');
      if (!userCache.has(id)) {
        result.reads++;
        const response = await admin.auth.admin.getUserById(id);
        requireValue(!response?.error, 'AUTH_IDENTITY_MISSING_OR_UNREADABLE');
        requireValue(response.data?.user?.id === id, 'AUTH_IDENTITY_MISMATCH'); userCache.set(id, response.data.user);
      }
      return userCache.get(id);
    }
    function recordAuth(user, provenance) {
      if (!result.identities.authUsers.some(row => row.id === user.id)) result.identities.authUsers.push({ id: user.id, provenance,
        emailSha256: journalHash(String(user.email || '').trim().toLowerCase()), bannedUntil: user.banned_until || null });
    }
    try {
      const principal = await authUser(expectedActorId);
      requireValue(principal.user_metadata?.balam_online_test === snapshot.run && principal.email === fixtures.email, 'PRINCIPAL_QA_PROVENANCE_MISMATCH');
      recordAuth(principal, 'preallocated principal / exact run marker and manifest');
    } catch (cause) { block(cause.code || 'PRINCIPAL_READ_FAILED'); return result; }

    async function onlineReceipt(requestId, command = null) {
      requireValue(UUID.test(requestId || ''), 'REQUEST_ID_INVALID');
      if (!receiptCache.has(requestId)) receiptCache.set(requestId, await one('online_requests', { actor_id: expectedActorId, request_id: requestId }));
      const row = receiptCache.get(requestId); requireValue(row, 'REQUEST_ABSENT_UNCERTAIN');
      requireValue(['confirmed', 'rejected', 'cancelled'].includes(row.state), 'REQUEST_NOT_TERMINAL');
      requireValue(row.response?.requestId === requestId && row.response.ok === (row.state === 'confirmed'), 'RECEIPT_STATE_RESPONSE_MISMATCH');
      if (row.state === 'cancelled') requireValue(row.response.notExecuted === true && !row.command_hash, 'CANCELLATION_NOT_PROVEN');
      else if (command) {
        requireValue(command.expectedActorId === expectedActorId, 'COMMAND_ACTOR_MISMATCH');
        requireValue(row.command_kind === command.type && row.command_hash === postgresJsonbHash(command), 'RECEIPT_COMMAND_MISMATCH');
      }
      if (!result.identities.requests.some(item => item.requestId === requestId && item.table === 'online_requests'))
        result.identities.requests.push({ table: 'online_requests', actorId: expectedActorId, requestId, state: row.state, contentSha256: postgresJsonbHash(clean(row)) });
      return row;
    }
    async function device(id, sequence) {
      requireValue(fixtures.installations?.includes(id), 'DEVICE_OUTSIDE_MANIFEST');
      const row = await requiredRow('sync_devices', { device_id: id }, sequence);
      requireValue(row.user_id === expectedActorId && row.metadata?.online_only === true, 'DEVICE_QA_PROVENANCE_MISMATCH');
      if (!result.identities.devices.some(item => item.deviceId === id)) result.identities.devices.push({ deviceId: id, userId: row.user_id, status: row.status });
      return row;
    }
    async function collect(command, response, requestId, sequence) {
      requireValue(supported.has(command?.type), 'COMMAND_TYPE_UNSUPPORTED');
      if (command.type === 'batch') {
        requireValue(Array.isArray(command.commands) && Array.isArray(response) && command.commands.length === response.length, 'BATCH_RESPONSE_MISMATCH');
        for (const [index, child] of command.commands.entries()) {
          const hex = createHash('md5').update(requestId + ':' + (index + 1)).digest('hex');
          const childId = hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
          await collect(child, response[index], childId, sequence);
        }
        return;
      }
      const audit = await one('capability_operation_audit', { operation_id: requestId });
      if (audit) { requireValue(audit.actor_user_id === expectedActorId, 'AUDIT_ACTOR_MISMATCH'); identity('capability_operation_audit', audit, sequence); }
      if (entities.has(command.kind)) {
        for (const row of command.rows || command.targets || []) if (row.id) identity(command.kind, { id: row.id }, sequence, 'command-reference');
        if (command.val) identity(command.kind, { id: command.val }, sequence, 'command-reference');
      }
      for (const table of ['products', 'clients', 'sellers', 'promotions'])
        for (const row of Array.isArray(response) && entities.has(command.kind) ? (table === command.kind ? response : []) : (Array.isArray(response?.[table]) ? response[table] : []))
          if (row?.id) identity(table, row, sequence, 'receipt-reference');
      if (command.type === 'folio') {
        requireValue(typeof response?.folio === 'string' && response.folio.length > 0, 'FOLIO_RESPONSE_MISSING');
        result.identities.folios.push({ folio: response.folio, requestId, monotonicAllocation: true }); return;
      }
      if (['sale', 'return', 'exchange'].includes(command.type)) {
        const sale = command.type === 'sale', table = sale ? 'sales' : command.type + 's';
        const parentId = sale ? command.header?.folio || command.folio : command.header?.id;
        requireValue(parentId, 'DOCUMENT_ID_MISSING');
        const key = sale ? 'folio' : 'id';
        await requiredRow(table, { [key]: parentId }, sequence);
        const childTable = sale ? 'sale_items' : command.type + '_items', parentKey = sale ? 'folio' : command.type + '_id';
        for (const child of await select(childTable, { [parentKey]: parentId })) identity(childTable, child, sequence);
        if (sale) for (const payment of await select('sale_payments', { folio: parentId })) identity('sale_payments', payment, sequence);
        const folio = sale ? parentId : command.header?.folio;
        if (folio) for (const move of await select('movements', { ref: folio })) identity('movements', move, sequence);
        const commitTable = sale ? (command.mode === 'layaway_liquidation' ? 'layaway_liquidation_commits' : 'sale_commits') : command.type + '_commits';
        await requiredRow(commitTable, { commit_id: requestId }, sequence);
        if (sale && (command.operationId || command.saleOperationId)) {
          const reservation = await one('stock_reservations', { operation_id: command.saleOperationId || command.operationId });
          if (reservation) identity('stock_reservations', reservation, sequence);
        }
      }
      if (command.type === 'loanOperation') await requiredRow('loan_documents', { id: command.loan?.id }, sequence);
      if (command.type === 'referenceReclassification') await requiredRow('reference_reclassifications', { operation_id: requestId }, sequence);
      if (command.type === 'commissionAdjustment') await requiredRow('commission_adjustments', { operation_id: requestId }, sequence);
      if (command.type === 'commissionSettle' && Number(response?.amount) > 0) await requiredRow('liquidations', { id: 'liq-' + requestId }, sequence);
      if (command.type === 'config') {
        await requiredRow('config_commits', { operation_id: requestId }, sequence);
        // Config rewrites shared state: these keys are references, never owned QA rows.
        for (const setting of command.settings || []) if (setting.key) identity('settings', { key: setting.key }, sequence, 'shared-config-reference');
      }
      if (['deviceUpdate', 'deviceRetire'].includes(command.type)) await device(command.deviceId, sequence);
      if (command.type === 'permissions') {
        requireValue(command.rpc === 'admin_apply_user_screen_permissions_checked', 'PERMISSION_COMMAND_UNSUPPORTED');
        requireValue(ownedAccounts.has(command.args?.p_target_user_id), 'PERMISSION_TARGET_NOT_VERIFIED_QA');
        await requiredRow('user_permission_role_assignments', { user_id: command.args.p_target_user_id }, sequence);
        for (const row of await select('user_screen_permission_overrides', { user_id: command.args.p_target_user_id })) identity('user_screen_permission_overrides', row, sequence);
      }
    }
    async function account(entry) {
      const requestId = entry.requestId, row = await one('online_account_requests', { actor_id: expectedActorId, request_id: requestId });
      requireValue(row, 'ACCOUNT_REQUEST_ABSENT_UNCERTAIN');
      requireValue(['completed', 'rejected', 'cancelled'].includes(row.state), 'ACCOUNT_NOT_TERMINAL');
      requireValue(!row.target_user_id || !protectedIds.has(row.target_user_id), 'PROTECTED_AUTH_ID');
      if (entry.kind === 'account-prepare') requireValue(row.payload_hash === journalHash(entry.command), 'ACCOUNT_PREPARATION_HASH_MISMATCH');
      if (entry.kind === 'account-advance') requireValue(row.state === entry.command.state && row.target_user_id === entry.command.targetUserId, 'ACCOUNT_ADVANCE_STATE_MISMATCH');
      const action = entry.command.action;
      if (action && action !== 'resolve') requireValue(row.action === action, 'ACCOUNT_ACTION_MISMATCH');
      if (entry.command.emailSha256) requireValue(journalHash(String(row.payload?.email || '').trim().toLowerCase()) === entry.command.emailSha256, 'ACCOUNT_EMAIL_HASH_MISMATCH');
      if (entry.command.targetUserId) requireValue(row.target_user_id === entry.command.targetUserId, 'ACCOUNT_TARGET_MISMATCH');
      result.identities.requests.push({ table: 'online_account_requests', actorId: expectedActorId, requestId, state: row.state, contentSha256: postgresJsonbHash(clean(row)) });
      if (row.state !== 'completed') { requireValue(row.result?.ok === false, 'ACCOUNT_REJECTION_UNPROVEN'); return row.state; }
      requireValue(row.action === 'create', 'ACCOUNT_NONCREATE_PROVENANCE_UNSUPPORTED');
      const target = row.target_user_id;
      requireValue(row.result?.ok === true && row.result.id === target && row.result.requestId === requestId, 'ACCOUNT_RESULT_MISMATCH');
      requireValue(row.payload?.email === prefix + '-account@example.test', 'ACCOUNT_OUTSIDE_QA_RUN');
      const user = await authUser(target);
      requireValue(user.app_metadata?.balam_account_request_id === requestId && user.email === row.payload.email, 'ACCOUNT_AUTH_PROVENANCE_MISMATCH');
      ownedAccounts.set(target, requestId); recordAuth(user, 'exact create receipt / actor, target and Auth request marker');
      await requiredRow('sellers', { id: target }, entry.sequence);
      const profileHash = journalHash(JSON.stringify(requestId + ':profile'));
      const profileRequestId = `${profileHash.slice(0, 8)}-${profileHash.slice(8, 12)}-4${profileHash.slice(13, 16)}-8${profileHash.slice(17, 20)}-${profileHash.slice(20, 32)}`;
      const command = structuredClone(row.payload.profileCommand);
      requireValue(command?.type === 'profileUpdate' && command.rows?.length === 1, 'ACCOUNT_PROFILE_COMMAND_MISSING');
      command.rows[0].id = target;
      const receipt = await onlineReceipt(profileRequestId, command);
      requireValue(receipt.state === 'confirmed', 'ACCOUNT_PROFILE_RECEIPT_NOT_CONFIRMED');
      await collect(command, receipt.response.result, profileRequestId, entry.sequence);
      return row.state;
    }

    for (const entry of entries) {
      const item = { sequence: entry.sequence, kind: entry.kind, requestId: entry.requestId, state: 'UNCERTAIN', acknowledgementClaimed: false };
      try {
        if (entry.kind === 'fixture-plan') {
          item.state = 'METADATA_ONLY'; item.observedMutations = false;
          item.identityAttribution = 'NONE'; item.metadataSha256 = entry.commandHash;
        } else if (entry.kind === 'rpc:execute_online_command' || entry.kind === 'rpc:resolve_online_request') {
          const command = entry.kind === 'rpc:execute_online_command' ? entry.command : null;
          const receipt = await onlineReceipt(entry.requestId, command);
          if (command) supportedCommand(command);
          if (receipt.state === 'confirmed' && command) await collect(command, receipt.response.result, entry.requestId, entry.sequence);
          if (receipt.state === 'confirmed' && !command) {
            const original = entries.find(candidate => candidate.kind === 'rpc:execute_online_command' && candidate.requestId === entry.requestId);
            requireValue(original, 'RESOLUTION_ORIGINAL_COMMAND_MISSING');
            await onlineReceipt(entry.requestId, original.command);
            await collect(original.command, receipt.response.result, entry.requestId, entry.sequence);
          }
          item.state = 'TERMINAL_RECEIPT'; item.authorityState = receipt.state;
        } else if (entry.kind.startsWith('edge:admin-users:') || ['account-prepare', 'account-advance'].includes(entry.kind)) {
          item.authorityState = await account(entry); item.state = 'TERMINAL_RECEIPT';
        } else if (['rpc:online_presence', 'rpc:online_adoption_report'].includes(entry.kind)) {
          const row = await device(entry.identities.deviceId, entry.sequence);
          const later = entries.filter(next => next.sequence > entry.sequence && next.kind === entry.kind && next.identities?.deviceId === entry.identities.deviceId).at(-1);
          const final = later || entry;
          if (entry.kind === 'rpc:online_presence') requireValue(row.client_build === final.command.p_client_build, 'DEVICE_BUILD_MISMATCH');
          else {
            const observed = { ...row.metadata?.online_adoption }; delete observed.serverTime;
            requireValue(same(observed, final.command.p_report), 'DEVICE_ADOPTION_MISMATCH');
          }
          item.state = 'OBSERVED_FINAL_STATE'; if (later) item.supersededBy = later.sequence;
        } else if (['auth-create', 'auth-principal', 'auth-ban', 'auth-login-rotation'].includes(entry.kind)) {
          const id = entry.identities.userId;
          requireValue(id === expectedActorId || ownedAccounts.has(id), 'AUTH_OUTSIDE_VERIFIED_QA');
          const user = await authUser(id);
          if (entry.command.qaRun) requireValue(entry.command.qaRun === snapshot.run, 'AUTH_RUN_MISMATCH');
          if (entry.command.emailSha256) requireValue(journalHash(String(user.email || '').trim().toLowerCase()) === entry.command.emailSha256, 'AUTH_EMAIL_HASH_MISMATCH');
          if (entry.kind === 'auth-ban') requireValue(Date.parse(user.banned_until) > Date.now(), 'AUTH_BAN_UNCONFIRMED');
          requireValue(entry.kind !== 'auth-login-rotation', 'UNVERIFIABLE_CREDENTIAL_CHANGE');
          item.state = 'OBSERVED_FINAL_STATE';
        } else if (entry.kind === 'profile-provisioning') {
          requireValue(Array.isArray(entry.command.rows) && same(entry.identities.profileIds, entry.command.rows.map(row => row.id)), 'PROFILE_SCOPE_MISMATCH');
          for (const expected of entry.command.rows) {
            requireValue(fixtures.sellers?.includes(expected.id) && [prefix + '-admin', ...['A', 'B', 'C'].map(letter => prefix + '-seller-' + letter)].includes(expected.id), 'PROFILE_OUTSIDE_EXACT_QA');
            const row = await requiredRow('sellers', { id: expected.id }, entry.sequence);
            const retired = entries.some(next => next.sequence > entry.sequence && next.kind === 'qa-retirement-sql' && next.identities?.profileIds?.includes(expected.id));
            for (const [key, value] of Object.entries(expected)) if (!['sync_base_version', 'sync_version', 'sync_device_id', 'updated_at'].includes(key))
              requireValue(same(row[key] ?? null, key === 'active' && retired ? false : value), 'PROFILE_FINAL_CONTENT_MISMATCH');
          }
          item.state = 'OBSERVED_FINAL_STATE';
        } else if (entry.kind === 'role-provisioning') {
          requireValue(entry.identities.userId === expectedActorId || ownedAccounts.has(entry.identities.userId), 'ROLE_OUTSIDE_VERIFIED_QA');
          const row = await requiredRow('user_permission_role_assignments', { user_id: entry.identities.userId }, entry.sequence);
          requireValue(row.role_code === entry.command.role_code && row.active === entry.command.active, 'ROLE_FINAL_STATE_MISMATCH');
          item.state = 'OBSERVED_FINAL_STATE';
        } else if (entry.kind === 'qa-retirement-sql') {
          requireValue(entry.identities.userIds?.every(id => id === expectedActorId || ownedAccounts.has(id)), 'RETIREMENT_AUTH_SCOPE_MISMATCH');
          requireValue(entry.identities.profileIds?.length > 0, 'RETIREMENT_PROFILE_SCOPE_EMPTY');
          for (const id of entry.identities.profileIds) {
            requireValue(fixtures.sellers?.includes(id) && (ownedAccounts.has(id) || [prefix + '-admin', ...['A', 'B', 'C'].map(letter => prefix + '-seller-' + letter)].includes(id)), 'RETIREMENT_PROFILE_OUTSIDE_MANIFEST');
            const row = await requiredRow('sellers', { id }, entry.sequence); requireValue(row.active === false, 'RETIREMENT_STATE_MISMATCH');
          }
          item.state = 'OBSERVED_FINAL_STATE';
        } else fail('INTENT_TYPE_UNSUPPORTED');
      } catch (cause) { item.blocker = cause.code || 'AUTHORITY_READ_FAILED'; block(item.blocker, entry.sequence); }
      result.entries.push(item);
    }
    result.identities.rows = [...rowIndex.values()];
    result.reconciled = result.blockers.length === 0 && result.entries.length === entries.length;
    return result;
  }
  return { reconcile };
}
