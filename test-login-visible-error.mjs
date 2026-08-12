// La pantalla de Login debe decir POR QUÉ no deja pasar.
//
// window.UI.toast() sólo dibuja si ToastHost está montado, y ToastHost vivía
// únicamente en la rama autenticada de App. Antes de entrar, cada aviso se
// emitía contra un host inexistente y se perdía: credenciales incorrectas,
// perfil inactivo o falta de conexión eran indistinguibles de "no pasó nada".
//
// Se sirve el paquete bajo un dominio propio (no 127.0.0.1) porque REQUIRE_AUTH
// se desactiva en local y la pantalla de Login no llegaría a montarse.
//
// Uso:  node test-login-visible-error.mjs [ruta-del-index.html]
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifact = process.argv[2] || 'index.html';
const origin = 'https://balam.test';
const passed = [];
const failures = [];
const check = async (name, fn) => {
  try { await fn(); passed.push(name); console.log(`PASS ${String(passed.length).padStart(2, '0')} · ${name}`); }
  catch (e) { failures.push(name); console.log(`FALLA · ${name}\n        ${e.message.split('\n')[0]}`); }
};

const html = await readFile(artifact);
const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const page = await browser.newPage();

// Nada sale a la red: el paquete es autocontenido y Supabase no debe intervenir.
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin === origin && (url.pathname === '/' || url.pathname.endsWith('index.html'))) {
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  }
  if (url.origin === origin) return route.fulfill({ status: 404, body: '' });
  return route.abort();
});

await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.AUTH && window.AUTH.isReady && window.AUTH.isReady(), null, { timeout: 30000 });
await page.waitForSelector('input[type=email]', { timeout: 30000 });

const boton = () => page.locator('button', { hasText: 'INICIAR SESIÓN' });
const textoVisible = () => page.evaluate(() => document.body.innerText);

await check('01 · la puerta de acceso muestra la pantalla de Login', async () => {
  assert.equal(await page.locator('input[type=email]').count(), 1);
});

await check('02 · el host de avisos está montado antes de entrar', async () => {
  const montado = await page.evaluate(() => {
    // ToastHost se registra a sí mismo: si no montó, toast() es un no-op.
    window.UI.toast('sonda-de-montaje', 'var(--danger)');
    return new Promise(r => setTimeout(() => r(document.body.innerText.includes('sonda-de-montaje')), 300));
  });
  assert.equal(montado, true, 'toast() no dibujó nada: ToastHost no está montado');
});

await check('03 · campos vacíos explican qué falta', async () => {
  await boton().click();
  await page.waitForTimeout(400);
  assert.match(await textoVisible(), /Escribe correo y contrase/i);
});

await check('04 · credenciales rechazadas dicen el motivo en pantalla', async () => {
  await page.evaluate(() => {
    window.AUTH.login = async () => ({ ok: false, error: 'Correo o contraseña incorrectos' });
  });
  await page.fill('input[type=email]', 'admin@balamguayaberas.com');
  await page.fill('input[type=password]', 'loQueSea');
  await boton().click();
  await page.waitForTimeout(600);
  assert.match(await textoVisible(), /Correo o contraseña incorrectos/i);
});

await check('05 · el motivo permanece, no se desvanece como un toast', async () => {
  await page.waitForTimeout(3200); // el toast vive 2,6 s
  assert.match(await textoVisible(), /Correo o contraseña incorrectos/i);
});

await check('06 · un perfil sin acceso se distingue de una contraseña mala', async () => {
  await page.evaluate(() => {
    window.AUTH.login = async () => ({ ok: false, error: 'La cuenta no tiene un perfil activo con acceso' });
  });
  await boton().click();
  await page.waitForTimeout(600);
  const texto = await textoVisible();
  assert.match(texto, /no tiene un perfil activo con acceso/i);
  assert.doesNotMatch(texto.replace(/La cuenta no tiene un perfil activo con acceso/g, ''), /incorrectos/i);
});

await check('07 · un fallo inesperado tampoco deja la pantalla muda', async () => {
  await page.evaluate(() => {
    window.AUTH.login = async () => { throw new Error('Fallo inesperado de red'); };
  });
  await boton().click();
  await page.waitForTimeout(600);
  assert.match(await textoVisible(), /Fallo inesperado de red/i);
});

await check('08 · el botón vuelve a quedar disponible tras el rechazo', async () => {
  assert.equal(await boton().isDisabled(), false);
  assert.doesNotMatch(await textoVisible(), /Entrando…/);
});

await browser.close();
console.log(`\n${passed.length} verdes, ${failures.length} rojas  ·  artefacto: ${artifact}`);
process.exit(failures.length ? 1 : 0);
