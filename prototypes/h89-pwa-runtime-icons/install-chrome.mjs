import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, readdir, stat, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const evidenceDir = join(here, 'evidence');
const runId = Date.now();
const profileDir = join(evidenceDir, `chrome-profile-${runId}`);
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 41790;
const origin = `http://127.0.0.1:${port}`;
const appUrl = `${origin}/POS_Balam/`;
const report = { appUrl, profileDir: relative(here, profileDir), events: [] };

function record(name, detail = '') {
  report.events.push({ name, detail });
  console.log(`PASS ${name}${detail ? ` · ${detail}` : ''}`);
}

async function filesUnder(root) {
  const found = [];
  async function walk(path) {
    for (const name of await readdir(path)) {
      const child = join(path, name);
      const info = await stat(child);
      if (info.isDirectory()) await walk(child);
      else found.push(child);
    }
  }
  try { await walk(root); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return found;
}

async function pngEvidence(label) {
  const root = join(profileDir, 'Default', 'Web Applications');
  const pngs = (await filesUnder(root)).filter(file => file.toLowerCase().endsWith('.png'));
  const items = [];
  const target = join(evidenceDir, `${label}-${runId}`);
  await mkdir(target, { recursive: true });
  for (let index = 0; index < pngs.length; index += 1) {
    const bytes = await readFile(pngs[index]);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const destination = join(target, `${String(index + 1).padStart(2, '0')}-${hash.slice(0, 12)}.png`);
    await copyFile(pngs[index], destination);
    items.push({ source: relative(profileDir, pngs[index]), evidence: relative(here, destination), bytes: bytes.length, sha256: hash });
  }
  return items;
}

async function internalAppIds() {
  const root = join(profileDir, 'Default', 'Web Applications', 'Manifest Resources');
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, origin);
  let file;
  if (url.pathname.startsWith('/installed/')) {
    const ids = await internalAppIds();
    const name = url.pathname.slice('/installed/'.length);
    const iconPath = name === 'maskable-512.png'
      ? join(profileDir, 'Default', 'Web Applications', 'Manifest Resources', ids[0] || '', 'Icons Maskable', '512.png')
      : join(profileDir, 'Default', 'Web Applications', 'Manifest Resources', ids[0] || '', 'Icons', name);
    try {
      const body = await readFile(iconPath);
      response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('Installed icon not found');
    }
    return;
  }
  if (url.pathname === '/POS_Balam/' || url.pathname === '/POS_Balam/index.html') file = 'index.html';
  else if (url.pathname === '/POS_Balam/sw.js') file = 'sw.js';
  else { response.writeHead(404); response.end('Not found'); return; }
  const body = await readFile(join(here, file));
  response.writeHead(200, {
    'Content-Type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Service-Worker-Allowed': '/POS_Balam/'
  });
  response.end(body);
});

await mkdir(profileDir, { recursive: true });
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));

let context;
try {
  context = await chromium.launchPersistentContext(profileDir, {
    executablePath: chromePath,
    headless: false,
    viewport: { width: 430, height: 860 },
    args: ['--no-first-run', '--no-default-browser-check']
  });
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.enable');
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  const initial = await page.waitForFunction(() => window.__H89?.result).then(handle => handle.jsonValue());
  await page.waitForFunction(() => window.__H89?.beforeInstallPrompt === true, null, { timeout: 15000 });
  record('Chrome emitió beforeinstallprompt', initial.hash);
  report.initial = initial;
  report.appIdBeforeInstall = await cdp.send('Page.getAppId');

  await page.locator('#install').click();
  await new Promise(resolve => setTimeout(resolve, 1000));
  const invokeInstallScript = [
    'Add-Type -AssemblyName UIAutomationClient',
    'Add-Type -AssemblyName UIAutomationTypes',
    '$root = [System.Windows.Automation.AutomationElement]::RootElement',
    '$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)',
    '$owner = $null',
    'foreach ($window in $windows) { try { if ($window.Current.Name -like "*H-89*Icono runtime*") { $owner = $window; break } } catch {} }',
    'if (-not $owner) { exit 4 }',
    '$pidChrome = $owner.Current.ProcessId',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    '$target = $null',
    'foreach ($element in $all) { try { $name = $element.Current.Name; $type = $element.Current.ControlType.ProgrammaticName; if ($element.Current.ProcessId -eq $pidChrome -and $type -eq "ControlType.Button" -and $name -match "^(Install|Instalar)$") { $target = $element; break } } catch {} }',
    'if (-not $target) { exit 5 }',
    '$pattern = $target.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)',
    '$pattern.Invoke()',
    'Write-Output "INVOKED"'
  ].join('; ');
  const automation = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', invokeInstallScript]);
  report.installDialogAutomation = automation.stdout.trim();
  await page.waitForFunction(() => window.__H89?.installed === true, null, { timeout: 20000 });
  const choice = await page.evaluate(() => window.__H89.installChoice);
  assert.equal(choice.outcome, 'accepted');
  record('diálogo nativo aceptó la instalación', JSON.stringify(choice));
  report.installChoice = choice;
  report.appIdAfterInstall = await cdp.send('Page.getAppId');
  assert.equal(report.appIdAfterInstall.appId, report.appIdBeforeInstall.appId);
  assert.equal(report.appIdAfterInstall.appId, `${origin}/POS_Balam/`);

  await page.screenshot({ path: join(evidenceDir, '03-installed-browser.png'), fullPage: true });
  await new Promise(resolve => setTimeout(resolve, 2000));
  report.installedPngsA = await pngEvidence('installed-brand-a');
  assert.ok(report.installedPngsA.length > 0);
  const installed192 = report.installedPngsA.find(item => /Icons\\192\.png$/.test(item.source) && !item.source.includes('Trusted Icons'));
  const installed512 = report.installedPngsA.find(item => /Icons\\512\.png$/.test(item.source) && !item.source.includes('Trusted Icons'));
  const installedMaskable = report.installedPngsA.find(item => /Icons Maskable\\512\.png$/.test(item.source));
  assert.ok(installed192 && installed512 && installedMaskable);
  report.pixelDigestsA = await page.evaluate(async ({ result, origin }) => {
    async function pixels(url) {
      const bitmap = await createImageBitmap(await fetch(url).then(response => response.blob()));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const digest = await crypto.subtle.digest('SHA-256', rgba);
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }
    return {
      runtime192: await pixels(`${origin}/POS_Balam/${result.paths.icon192}`),
      installed192: await pixels(`${origin}/installed/192.png`),
      runtime512: await pixels(`${origin}/POS_Balam/${result.paths.icon512}`),
      installed512: await pixels(`${origin}/installed/512.png`),
      runtimeMaskable: await pixels(`${origin}/POS_Balam/${result.paths.maskable}`),
      installedMaskable: await pixels(`${origin}/installed/maskable-512.png`)
    };
  }, { result: initial, origin });
  assert.equal(report.pixelDigestsA.installed192, report.pixelDigestsA.runtime192);
  assert.equal(report.pixelDigestsA.installed512, report.pixelDigestsA.runtime512);
  assert.equal(report.pixelDigestsA.installedMaskable, report.pixelDigestsA.runtimeMaskable);
  record('Chrome materializó iconos de la aplicación instalada', `${report.installedPngsA.length} PNG`);

  const ids = await internalAppIds();
  assert.equal(ids.length, 1);
  report.internalAppId = ids[0];

  await context.close();
  context = await chromium.launchPersistentContext(profileDir, {
    executablePath: chromePath,
    headless: false,
    viewport: { width: 430, height: 860 },
    args: [`--app-id=${report.internalAppId}`, '--no-first-run', '--no-default-browser-check']
  });
  const appPage = context.pages()[0] || await context.waitForEvent('page');
  await appPage.waitForFunction(() => window.__H89?.result, null, { timeout: 20000 });
  const standalone = await appPage.evaluate(() => matchMedia('(display-mode: standalone)').matches);
  assert.equal(standalone, true);
  record('reapertura de la instalación en display standalone');
  await appPage.screenshot({ path: join(evidenceDir, '04-installed-standalone-a.png'), fullPage: true });

  const changed = await appPage.evaluate(() => window.__H89.materialize('b'));
  assert.notEqual(changed.hash, initial.hash);
  report.changed = changed;
  record('manifest de la aplicación instalada cambió a logo B', `${initial.hash} → ${changed.hash}`);
  await new Promise(resolve => setTimeout(resolve, 5000));
  await appPage.reload({ waitUntil: 'domcontentloaded' });
  await appPage.waitForFunction(() => window.__H89?.result?.brand === 'b', null, { timeout: 15000 });
  report.currentBAfterReload = await appPage.evaluate(() => window.__H89.result);
  const appCdp = await context.newCDPSession(appPage);
  await appCdp.send('Page.enable');
  report.installabilityAfterBrandChange = await appCdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(report.installabilityAfterBrandChange.installabilityErrors, []);
  assert.equal(await appPage.evaluate(() => matchMedia('(display-mode: standalone)').matches), true);
  await new Promise(resolve => setTimeout(resolve, 3000));
  report.installedPngsBAfterImmediateUpdate = await pngEvidence('installed-brand-b-immediate');
  const oldPrimary = report.installedPngsA.find(item => /Icons\\192\.png$/.test(item.source) && !item.source.includes('Trusted Icons'));
  const newPrimary = report.installedPngsBAfterImmediateUpdate.find(item => /Icons\\192\.png$/.test(item.source) && !item.source.includes('Trusted Icons'));
  report.installedIconUpdatedImmediately = oldPrimary?.sha256 !== newPrimary?.sha256;
  record('capturada política real de actualización del icono instalado', report.installedIconUpdatedImmediately ? 'Chrome actualizó el PNG' : 'Chrome conservó el PNG instalado');
  await appPage.screenshot({ path: join(evidenceDir, '05-installed-standalone-b-content.png'), fullPage: true });
} finally {
  if (context) await context.close().catch(() => {});
  await new Promise(resolve => server.close(resolve));
  await writeFile(join(evidenceDir, 'chrome-real-install.json'), JSON.stringify(report, null, 2));
}

console.log(`RESULT ${report.events.length}/${report.events.length}`);
