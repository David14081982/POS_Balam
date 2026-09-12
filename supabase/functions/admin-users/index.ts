// H164: Auth and the commercial profile have a durable server receipt.
// Passwords exist only in the incoming request; the browser retains its requestId.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.8';

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WAIT = 'Estamos confirmando la operación. No la repitas.';
const MARKER = 'balam_account_request_id';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-balam-device-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
});
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
};
async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function profileRequestId(requestId: string) {
  const hash = await digest(requestId + ':profile');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
const initials = (name: string) => name.trim().split(/\s+/).map(word => word[0]).slice(0, 2).join('').toUpperCase();
type Client = ReturnType<typeof createClient>;
type Payload = Record<string, unknown>;
type Receipt = {
  request_id: string; actor_id: string; action: string; state: string;
  target_user_id: string | null; payload: Payload; result: Payload | null;
};
async function rpc(client: Client, name: string, args: Payload) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
}
async function receiptFor(service: Client, requestId: string, actorId: string): Promise<Receipt | null> {
  const { data, error } = await service.from('online_account_requests').select('*')
    .eq('request_id', requestId).eq('actor_id', actorId).maybeSingle();
  if (error) throw error;
  return data;
}
async function advance(service: Client, receipt: Receipt, state: string, target: string | null, result: Payload | null = null): Promise<Receipt> {
  return await rpc(service, 'advance_online_account', {
    p_request_id: receipt.request_id, p_actor_id: receipt.actor_id,
    p_state: state, p_target_user_id: target, p_result: result,
  });
}
async function createdAccount(service: Client, receipt: Receipt) {
  const email = String(receipt.payload.email || '').toLowerCase();
  for (let page = 1; ; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const user = data.users.find(user => user.email?.toLowerCase() === email);
    if (user) return user.app_metadata?.[MARKER] === receipt.request_id ? user : null;
    if (data.users.length < 100) return null;
  }
}
async function readAuthUser(service: Client, id: string) {
  const { data, error } = await service.auth.admin.getUserById(id);
  if (error && error.status !== 404 && error.code !== 'user_not_found') throw error;
  return data?.user || null;
}
async function applyProfile(caller: Client, receipt: Receipt, target: string) {
  const command = structuredClone(receipt.payload.profileCommand) as Payload;
  if (command.type === 'profileUpdate') {
    const rows = command.rows as Payload[];
    rows[0].id = target;
  }
  const result = await rpc(caller, 'execute_online_command', {
    p_request_id: await profileRequestId(receipt.request_id), p_command: command,
  });
  if (!result || result.ok !== true) {
    const error = new Error(result?.error?.message || 'ACCOUNT_PROFILE_NOT_CONFIRMED');
    Object.assign(error, { confirmedRejection: true, details: result?.error });
    throw error;
  }
  return result;
}
async function continueAccount(caller: Client, service: Client, receipt: Receipt, password?: string, resolving = false) {
  if (receipt.state === 'completed') return json({ ok: true, requestId: receipt.request_id,
    result: receipt.result || { ok: true, id: receipt.target_user_id, requestId: receipt.request_id } });
  if (['rejected', 'cancelled'].includes(receipt.state)) return json({
    ok: false, terminal: true, state: receipt.state, requestId: receipt.request_id,
    error: { code: 'ACCOUNT_' + receipt.state.toUpperCase(), message: receipt.result?.error || 'La operación de esta cuenta no se confirmó.' },
  }, 409);
  if (receipt.state === 'needs_review') return json({ ok: false, uncertain: true, state: 'unknown',
    requestId: receipt.request_id, error: WAIT, diagnostic: receipt.result?.error }, 202);
  const action = receipt.action;
  let target = receipt.target_user_id || (receipt.payload.id as string | undefined) || null;
  try {
    if (action === 'delete') {
      if (!target) throw new Error('ACCOUNT_TARGET_MISSING');
      // Deactivate the commercial profile before deleting Auth. A failed Auth
      // request cannot leave this user authorized to continue selling.
      if (receipt.state === 'prepared') {
        await applyProfile(caller, receipt, target);
        receipt = await advance(service, receipt, 'profile_confirmed', target);
      }
      const current = await readAuthUser(service, target);
      if (current) {
        const { error } = await service.auth.admin.deleteUser(target);
        if (error) throw error;
      }
    } else {
      if (receipt.state === 'prepared') {
        let user = action === 'create' ? await createdAccount(service, receipt)
          : target ? await readAuthUser(service, target) : null;
        const marked = user?.app_metadata?.[MARKER] === receipt.request_id;
        if (!marked && resolving) return json({ ok: false, uncertain: true, state: receipt.state, requestId: receipt.request_id, error: WAIT }, 202);
        if (!marked) {
          const attributes = {
            email: String(receipt.payload.email || ''),
            ...(password ? { password } : {}),
            app_metadata: { ...(user?.app_metadata || {}), [MARKER]: receipt.request_id },
          };
          const response = action === 'create'
            ? await service.auth.admin.createUser({ ...attributes, email_confirm: true })
            : await service.auth.admin.updateUserById(target!, attributes);
          if (response.error) {
            // A concurrent invocation may already have created this exact user.
            user = action === 'create' ? await createdAccount(service, receipt)
              : target ? await readAuthUser(service, target) : null;
            if (user?.app_metadata?.[MARKER] !== receipt.request_id) {
              if (response.error.status && response.error.status >= 400 && response.error.status < 500) {
                const result = { ok: false, error: response.error.message };
                await advance(service, receipt, 'rejected', target, result);
                return json({ ok: false, terminal: true, state: 'rejected', requestId: receipt.request_id,
                  error: { code: 'ACCOUNT_AUTH_REJECTED', message: result.error } }, 400);
              }
              throw response.error;
            }
          } else user = response.data.user;
        }
        if (!user || user.app_metadata?.[MARKER] !== receipt.request_id) throw new Error('ACCOUNT_AUTH_CONFIRMATION_MISSING');
        target = user.id;
        receipt = await advance(service, receipt, 'auth_confirmed', target);
      }
      if (!target) throw new Error('ACCOUNT_TARGET_MISSING');
      await applyProfile(caller, receipt, target);
    }
    const result = { ok: true, id: target, requestId: receipt.request_id };
    receipt = await advance(service, receipt, 'completed', target, result);
    return json({ ok: true, requestId: receipt.request_id, result: receipt.result || result });
  } catch (error) {
    if ((error as { confirmedRejection?: boolean }).confirmedRejection) {
      const message = (error as Error).message;
      const terminal = action === 'delete' && receipt.state === 'prepared';
      await advance(service, receipt, terminal ? 'rejected' : 'needs_review', target, { ok: false, error: message });
      return json(terminal
        ? { ok: false, terminal: true, state: 'rejected', requestId: receipt.request_id, error: { code: 'ACCOUNT_PROFILE_REJECTED', message } }
        : { ok: false, uncertain: true, state: 'unknown', requestId: receipt.request_id, error: WAIT, diagnostic: message }, terminal ? 409 : 202);
    }
    // Network/server uncertainty remains a queryable server record. It is never
    // translated into a success or a browser payload to replay later.
    return json({ ok: false, uncertain: true, state: receipt.state, requestId: receipt.request_id,
      error: WAIT, detail: (error as Error)?.message || 'ACCOUNT_RESULT_UNCERTAIN' }, 202);
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const deviceId = req.headers.get('x-balam-device-id') || '';
    if (!authHeader) return json({ error: 'No autorizado' }, 401);
    if (!deviceId) return json({ error: 'DEVICE_ID_REQUIRED' }, 400);
    const caller = createClient(URL, ANON, { db: { schema: 'pos' }, global: {
      headers: { Authorization: authHeader, 'x-balam-device-id': deviceId },
    }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: who, error: whoError } = await caller.auth.getUser();
    if (whoError || !who?.user) return json({ error: 'Sesión inválida' }, 401);
    if (await rpc(caller, 'current_has_capability', { p_capability_key: 'sellers.manage' }) !== true)
      return json({ error: 'Tu cuenta no tiene la capacidad sellers.manage.' }, 403);
    // This read also validates an active, non-retired installation before Auth.
    const connectivity = await rpc(caller, 'online_connectivity', {});
    if (connectivity?.ok !== true) return json({ error: 'DEVICE_NOT_ACTIVE' }, 403);
    const body = await req.json();
    if (body.expectedActorId !== who.user.id) return json({ ok: false, terminal: true,
      error: { code: 'ONLINE_SESSION_CHANGED', message: 'La sesión cambió. Vuelve a iniciar la operación.' } }, 409);
    const requestId = String(body.requestId || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))
      return json({ error: 'ACCOUNT_REQUEST_ID_REQUIRED' }, 400);
    const service = createClient(URL, SERVICE, { db: { schema: 'pos' }, auth: { persistSession: false, autoRefreshToken: false } });
    let existing = await receiptFor(service, requestId, who.user.id);
    if (body.action === 'resolve') {
      if (!existing) {
        const result = await rpc(caller, 'online_account_result', { p_request_id: requestId });
        existing = await receiptFor(service, requestId, who.user.id);
        if (!existing) return json(result, result?.ok ? 200 : 202);
      }
      return await continueAccount(caller, service, existing, undefined, true);
    }
    if (!['create', 'update', 'delete'].includes(body.action)) return json({ error: 'Acción no válida' }, 400);
    const requestHash = await digest(body);
    if (existing) {
      // prepare compares the original hash and never changes its frozen draft.
      existing = await rpc(service, 'prepare_online_account', {
        p_request_id: requestId, p_actor_id: who.user.id, p_payload: existing.payload, p_payload_hash: requestHash,
      });
      return await continueAccount(caller, service, existing!, body.password);
    }
    const action = body.action as string;
    const id = action === 'create' ? null : String(body.id || '');
    if (action !== 'create' && !id) return json({ error: 'Falta id' }, 400);
    if (action === 'create' && (!body.email || String(body.password || '').length < 6))
      return json({ error: 'Correo y contraseña de al menos 6 caracteres son obligatorios' }, 400);
    let current: Payload = {};
    if (id) {
      const { data, error } = await caller.from('sellers').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data || data.deleted_at) return json({ error: 'TARGET_USER_NOT_FOUND' }, 409);
      if (Number(data.sync_version) !== Number(body.baseVersion)) return json({ error: 'ENTITY_VERSION_CONFLICT' }, 409);
      current = data;
    }
    const name = String(body.nombre ?? current.nombre ?? '').trim();
    const email = String(body.email ?? current.email ?? '').trim().toLowerCase();
    const row = {
      id, nombre: name, iniciales: initials(name), color: current.color || '#64748b',
      comision_pct: current.comision_pct || 0,
      commission_override_pct: body.commissionOverridePct === undefined ? current.commission_override_pct ?? null : body.commissionOverridePct,
      seller_level_code: body.sellerLevelCode === undefined ? current.seller_level_code ?? null : body.sellerLevelCode,
      commission_policy_version: 1, meta_mes: body.metaMes ?? current.meta_mes ?? 0,
      bono: current.bono || 'Sin bono', email, role: body.role ?? current.role ?? 'vendedor',
      avatar_url: body.avatar === undefined ? current.avatar_url ?? null : body.avatar || null,
      active: current.active !== false, sync_base_version: Number(current.sync_version) || 0,
    };
    const profileCommand = action === 'delete'
      ? { type: 'softDelete', kind: 'sellers', val: id, baseVersion: Number(current.sync_version) || 0, accountRequestId: requestId, expectedActorId: who.user.id }
      : { type: 'profileUpdate', kind: 'sellers', rows: [row], accountRequestId: requestId, expectedActorId: who.user.id };
    const payload = { action, id, email, deviceId, profileCommand };
    const receipt: Receipt = await rpc(service, 'prepare_online_account', {
      p_request_id: requestId, p_actor_id: who.user.id, p_payload: payload, p_payload_hash: requestHash,
    });
    return await continueAccount(caller, service, receipt, body.password);
  } catch (error) {
    return json({ ok: false, error: (error as Error)?.message || 'No se pudo confirmar la cuenta' }, 400);
  }
});
