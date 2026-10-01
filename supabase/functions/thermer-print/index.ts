// H-181. Temporary output artifacts only; never commits or confirms a sale.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.8';
const endpoint = Deno.env.get('SUPABASE_URL')!;
const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const bucket = 'balam-thermer-private';
const ttl = 600;
const cors = { 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-balam-device-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
});
const service = () => createClient(endpoint, secret, { auth: { persistSession: false, autoRefreshToken: false } });
function png(value: unknown) {
  if (typeof value !== 'string' || value.length > 500000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value)) throw Error('PNG_REQUIRED');
  const bytes = Uint8Array.from(atob(value.slice(22)), c => c.charCodeAt(0));
  if (bytes.length < 45 || ![137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v)) throw Error('PNG_REQUIRED');
  const view = new DataView(bytes.buffer);
  if (view.getUint32(16) !== 576 || view.getUint32(20) < 1 || view.getUint32(20) > 30000) throw Error('PNG_SIZE');
  return bytes;
}
async function authorize(req: Request) {
  const authorization = req.headers.get('authorization') || '';
  if (!/^Bearer \S+$/i.test(authorization)) return false;
  const client = createClient(endpoint, anon, { db: { schema: 'pos' },
    global: { headers: { Authorization: authorization, 'x-balam-device-id': req.headers.get('x-balam-device-id') || '' } },
    auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) return false;
  const roles = await Promise.all([client.rpc('is_active_admin'), client.rpc('is_active_seller')]);
  if (!roles.some(r => !r.error && r.data === true)) return false;
  const online = await client.rpc('online_connectivity');
  return !online.error && online.data?.ok === true;
}
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  try {
    if (req.method === 'POST') {
      if (!await authorize(req)) return json({ error: 'PRINT_FORBIDDEN' }, 403);
      // Bound the stream before parsing, including requests without Content-Length.
      const reader = req.body?.getReader();
      if (!reader) return json({ error: 'PRINT_BODY_REQUIRED' }, 400);
      const chunks: Uint8Array[] = []; let length = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.length;
        if (length > 1001000) { await reader.cancel(); return json({ error: 'PRINT_TOO_LARGE' }, 413); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      chunks.forEach(chunk => { bytes.set(chunk, offset); offset += chunk.length; });
      const input = JSON.parse(new TextDecoder().decode(bytes));
      if (!Array.isArray(input.images) || input.images.length !== 2) return json({ error: 'TWO_COPIES_REQUIRED' }, 400);
      const images = input.images.map(png);
      const now = Math.floor(Date.now() / 1000), expires = now + ttl;
      const id = now + '-' + crypto.randomUUID();
      const store = service().storage.from(bucket), uploaded: string[] = [];
      try {
        const paths: string[] = [];
        for (let i = 0; i < images.length; i++) {
          const path = id + '-' + i + '.png';
          const put = await store.upload(path, images[i], { contentType: 'image/png', cacheControl: '0', upsert: false });
          if (put.error) throw Error('PRINT_UPLOAD_FAILED');
          uploaded.push(path);
          const signed = await store.createSignedUrl(path, ttl);
          if (signed.error || !signed.data?.signedUrl) throw Error('PRINT_SIGN_FAILED');
          paths.push(signed.data.signedUrl);
        }
        const manifest = { '0': { type: 1, path: paths[0], align: 0 },
          '1': { type: 0, content: ' ', bold: 0, align: 0 },
          '2': { type: 1, path: paths[1], align: 0 } };
        const name = id + '.json';
        const put = await store.upload(name, JSON.stringify(manifest), { contentType: 'application/json', cacheControl: '0', upsert: false });
        if (put.error) throw Error('PRINT_UPLOAD_FAILED');
        uploaded.push(name);
        const signed = await store.createSignedUrl(name, Math.max(1, expires - Math.floor(Date.now() / 1000)));
        if (signed.error || !signed.data?.signedUrl) throw Error('PRINT_SIGN_FAILED');
        const old = await store.list('', { limit: 100, sortBy: { column: 'name', order: 'asc' } });
        const expired = (old.data || []).filter(row => /^\d{10}-[a-f0-9-]{36}(?:-[01]\.png|\.json)$/.test(row.name)
          && Number(row.name.slice(0, 10)) + ttl + 120 < now).map(row => row.name);
        if (expired.length) await store.remove(expired);
        return json({ url: signed.data.signedUrl, expiresAt: expires * 1000 });
      } catch (_) {
        if (uploaded.length) await store.remove(uploaded);
        return json({ error: 'PRINT_STORAGE_UNAVAILABLE' }, 503);
      }
    }
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  } catch (_) { return json({ error: 'PRINT_REQUEST_INVALID' }, 400); }
});
