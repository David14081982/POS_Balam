import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
export function serviceFixture() {
  const resources = JSON.parse(fs.readFileSync('balam/vendor/build-resources.json', 'utf8'));
  const babel = vm.createContext({});
  vm.runInContext(Buffer.from(resources[Object.keys(resources).find(k => k.includes('@babel/'))].data, 'base64').toString(), babel);
  const source = fs.readFileSync('supabase/functions/thermer-print/index.ts', 'utf8').replace(/^import .*;$/m, '');
  const code = babel.Babel.transform(source, { filename: 'index.ts', plugins: ['transform-typescript'] }).code;
  let handler, clock = Date.now(), uploads = 0;
  const files = new Map(), links = new Map();
  const store = {
    async upload(path, body) { uploads++; files.set(path, body); return {}; },
    async download(path) { return { data: files.has(path) ? new Blob([files.get(path)]) : null }; },
    async list() { return { data: [...files.keys()].sort().slice(0, 100).map(name => ({ name })) }; },
    async remove(paths) { paths.forEach(p => files.delete(p)); return {}; },
    async createSignedUrl(path, seconds) {
      const url = 'https://print.example/storage/v1/object/sign/balam-thermer-private/' + path + '?token=' + webcrypto.randomUUID();
      links.set(url, { path, expires: clock + seconds * 1000 });
      return { data: { signedUrl: url } };
    },
  };
  const context = vm.createContext({ Request, Response, Blob, URL, TextEncoder, TextDecoder, Uint8Array, DataView,
    atob, btoa, crypto: webcrypto, Date: class extends Date { static now() { return clock; } },
    Deno: { env: { get: key => ({ SUPABASE_URL: 'https://print.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key' })[key] }, serve: fn => { handler = fn; } },
    createClient: (_url, key, options) => {
      if (key === 'server-only-test-key') return { storage: { from: name => { if (name !== 'balam-thermer-private') throw Error('wrong bucket'); return store; } } };
      const role = options.global.headers.Authorization.replace('Bearer ', '');
      return { auth: { getUser: async () => ({ data: { user: ['seller','admin','inactive','unprofiled'].includes(role) ? { id: role } : null } }) },
        rpc: async name => ({ data: name === 'online_connectivity' ? { ok: options.global.headers['x-balam-device-id'] === 'test-device' }
          : name === 'is_active_admin' ? role === 'admin' : role === 'seller' }) };
    },
  });
  vm.runInContext(code, context);
  return { handler: async req => {
    if (req.method !== 'GET' || !req.url.includes('/storage/')) return handler(req);
    const entry = links.get(req.url);
    if (!entry) return new Response('', { status: 403 });
    if (entry.expires <= clock) return new Response('', { status: 410 });
    if (!files.has(entry.path)) return new Response('', { status: 404 });
    return new Response(files.get(entry.path), { headers: { 'Cache-Control': 'max-age=0', 'Content-Type': entry.path.endsWith('.png') ? 'image/png' : 'application/json' } });
  }, files, advance: ms => { clock += ms; }, get uploads() { return uploads; } };
}
