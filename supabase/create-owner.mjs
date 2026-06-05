// create-owner.mjs — Crea la cuenta DUEÑO en Supabase Auth (email confirmado).
// Sin dependencias (usa fetch + Admin REST API). Corre UNA vez, en local.
//
// Uso (PowerShell):
//   $env:SERVICE_KEY="<service_role key del proyecto>"
//   node supabase/create-owner.mjs admin@balam.com "MiContraseñaFuerte"
//
// El service_role key está en: Supabase → Project Settings → API → service_role (SECRETO).
// NO subir este key al .com ni commitearlo. Alternativa sin script:
//   Dashboard → Authentication → Users → Add user → marcar "Auto Confirm User".

const URL = 'https://telohdbvbvsfmwyriflz.supabase.co';
const SERVICE_KEY = process.env.SERVICE_KEY;
const [email, password] = process.argv.slice(2);

if (!SERVICE_KEY) { console.error('Falta SERVICE_KEY (variable de entorno).'); process.exit(1); }
if (!email || !password) { console.error('Uso: node supabase/create-owner.mjs <email> <password>'); process.exit(1); }

const res = await fetch(URL + '/auth/v1/admin/users', {
  method: 'POST',
  headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) { console.error('ERROR ' + res.status + ':', body.msg || body.error_description || JSON.stringify(body)); process.exit(1); }
console.log('OK · cuenta dueño creada:', body.email || email, '· id', body.id || '?');
