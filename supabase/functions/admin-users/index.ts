// admin-users — Edge Function: crea / edita / borra usuarios (Supabase Auth + perfil pos.sellers).
// Solo responde si quien llama tiene sesión y es ADMIN (role='admin' en pos.sellers).
// La SERVICE_ROLE key vive SOLO aquí (env de la función), nunca en el HTML del cliente.
// Deploy:  supabase functions deploy admin-users
//   (las env SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY se inyectan solas)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const ini = (n: string) => String(n || '').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader) return json({ error: 'No autorizado' }, 401);

    // 1) Identifica al llamante por su JWT y confirma que es admin activo.
    const caller = createClient(URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: who } = await caller.auth.getUser();
    const email = who?.user?.email?.toLowerCase();
    if (!email) return json({ error: 'Sesión inválida' }, 401);

    const svc = createClient(URL, SERVICE, { db: { schema: 'pos' } });
    const { data: me } = await svc.from('sellers').select('role,active').eq('email', email).maybeSingle();
    if (!me || me.role !== 'admin' || me.active === false) {
      return json({ error: 'Solo un administrador puede gestionar usuarios' }, 403);
    }

    const body = await req.json();
    const action = body.action;

    if (action === 'create') {
      const { email: e, password, nombre, role, avatar } = body;
      if (!e || !password) return json({ error: 'Correo y contraseña son obligatorios' }, 400);
      const { data: created, error } = await svc.auth.admin.createUser({ email: e, password, email_confirm: true });
      if (error) return json({ error: error.message }, 400);
      const id = created.user.id;
      const { error: pe } = await svc.from('sellers').upsert({
        id, nombre, email: e, role: role || 'vendedor', iniciales: ini(nombre), color: '#64748b',
        avatar_url: avatar || null, active: true, comision_pct: 0, meta_mes: 0, ventas_mes: 0,
        ventas_num: 0, comision_acum: 0, bono: 'Sin bono',
      }, { onConflict: 'id' });
      if (pe) return json({ error: pe.message }, 400);
      return json({ ok: true, id });
    }

    if (action === 'update') {
      const { id, password, nombre, role, email: e, avatar } = body;
      if (!id) return json({ error: 'Falta id' }, 400);
      if (password) {
        const { error } = await svc.auth.admin.updateUserById(id, { password });
        if (error) return json({ error: error.message }, 400);
      }
      if (e) await svc.auth.admin.updateUserById(id, { email: e });
      const patch: Record<string, unknown> = {};
      if (nombre != null) { patch.nombre = nombre; patch.iniciales = ini(nombre); }
      if (role != null) patch.role = role;
      if (e != null) patch.email = e;
      if (avatar !== undefined) patch.avatar_url = avatar;
      if (Object.keys(patch).length) await svc.from('sellers').update(patch).eq('id', id);
      return json({ ok: true });
    }

    if (action === 'delete') {
      const { id } = body;
      if (!id) return json({ error: 'Falta id' }, 400);
      const { data: admins } = await svc.from('sellers').select('id').eq('role', 'admin').eq('active', true);
      const { data: target } = await svc.from('sellers').select('role').eq('id', id).maybeSingle();
      if (target?.role === 'admin' && (admins?.length || 0) <= 1) {
        return json({ error: 'Debe existir al menos un administrador' }, 400);
      }
      await svc.auth.admin.deleteUser(id).catch(() => {});
      await svc.from('sellers').delete().eq('id', id);
      return json({ ok: true });
    }

    return json({ error: 'Acción no válida' }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
