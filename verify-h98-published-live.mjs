// H-98 · Prueba publicada, autenticada y estrictamente de lectura.
// Única interacción: «Actualizar diagnóstico». Se aborta cualquier petición a
// RPC de respaldo, ejecución o purga y se verifica que nunca se intente.
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const url = `https://david14081982.github.io/POS_Balam/index.html?h98=${Date.now()}`;
const profile = 'C:\\tmp\\balam-h98-chrome';
const evidenceDir = resolve('.evidence-h98-visible-preview');
await mkdir(evidenceDir, { recursive: true });

const published = await fetch(url, { cache: 'no-store' }).then(response => {
  if (!response.ok) throw new Error(`Pages HTTP ${response.status}`);
  return response.arrayBuffer();
});
const bytes = Buffer.from(published);
const publishedBlob = createHash('sha1').update(Buffer.concat([
  Buffer.from(`blob ${bytes.length}\0`), bytes,
])).digest('hex');

const context = await chromium.launchPersistentContext(profile, {
  channel: 'chrome', headless: true, viewport: { width: 1440, height: 1000 },
  args: ['--profile-directory=Default'],
});
let destructiveRequests = 0;
const errors = [];
try {
  const pages = context.pages();
  const page = pages[0] || await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  await page.route(/supabase\.co\/rest\/v1\/rpc\/(create_point_zero_backup|execute_point_zero|purge_test_data)/, route => {
    destructiveRequests++;
    route.abort('blockedbyclient');
  });
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.AUTH && window.AUTH.isReady && window.AUTH.isReady(), null, { timeout: 60000 });
  if (!(await page.evaluate(() => window.AUTH.hasSession && window.AUTH.hasSession()))) {
    throw new Error('La sesión copiada no está autenticada en POS Balam');
  }

  await page.getByRole('button', { name: 'Configuración' }).click();
  await page.getByTestId('settings-section-demo').click();
  await page.getByTestId('point-zero-card').waitFor();
  await page.getByTestId('point-zero-refresh').click();
  await page.getByTestId('point-zero-diagnostic').waitFor({ timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="point-zero-refresh"]').disabled);

  const result = await page.evaluate(() => {
    const diagnostic = document.querySelector('[data-testid="point-zero-diagnostic"]');
    const clean = document.querySelector('[data-testid="point-zero-open"]');
    const rows = {};
    diagnostic.querySelectorAll('.flex.items-baseline.justify-between').forEach(row => {
      const parts = row.querySelectorAll('span');
      if (parts.length >= 2) rows[parts[0].textContent.trim()] = parts[1].textContent.trim();
    });
    return {
      mode: document.querySelector('[data-testid="point-zero-mode"]')?.textContent.trim(),
      text: diagnostic.innerText,
      rows,
      cleanDisabled: !!clean?.disabled,
      error: document.querySelector('[data-testid="point-zero-error"]')?.innerText || '',
    };
  });
  await page.getByTestId('point-zero-diagnostic').screenshot({ path: resolve(evidenceDir, 'diagnostico-pages.png') });
  const evidence = {
    url, commit: '345b53d44eba12be96825a13dc9bf75b43abb608',
    publishedBlob, bytes: bytes.length, clicked: 'Actualizar diagnóstico',
    destructiveRequests, browserErrors: errors, ...result,
  };
  await writeFile(resolve(evidenceDir, 'resultado.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  if (publishedBlob !== '8122ef6696b2706981de32e0775fb6ea6f39780d') throw new Error('Los bytes publicados no son los del commit H-98');
  if (destructiveRequests !== 0) throw new Error('Se intentó una petición destructiva');
  if (errors.length) throw new Error('Errores de navegador: ' + errors.join(' | '));
  if (!/Actualizado:/.test(result.text) || !/Productos/.test(result.text) || !/Piezas/.test(result.text)) {
    throw new Error('El diagnóstico no quedó visible');
  }
} finally {
  await context.close();
}
