import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const execFileAsync = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const evidenceDir = join(root, 'prototypes', 'h89-pwa-runtime-icons', 'evidence');
const runId = Date.now();
const profileDir = join(evidenceDir, `public-profile-${runId}`);
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const appUrl = 'https://david14081982.github.io/POS_Balam/';
const report = { appUrl, chromePath, events: [] };

function record(name, detail = '') {
  report.events.push({ name, detail });
  console.log(`PASS ${String(report.events.length).padStart(2, '0')} · ${name}${detail ? ` · ${detail}` : ''}`);
}

async function appIds() {
  const path = join(profileDir, 'Default', 'Web Applications', 'Manifest Resources');
  try {
    return (await readdir(path, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function fileDigest(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function pixelDigest(page, source) {
  return page.evaluate(async value => {
    const bitmap = await createImageBitmap(await fetch(value, { cache: 'no-store' }).then(response => response.blob()));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    const digest = await crypto.subtle.digest('SHA-256', context.getImageData(0, 0, canvas.width, canvas.height).data);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }, source);
}

await mkdir(profileDir, { recursive: true });
let context;
async function closeContext() {
  if (!context) return;
  const current = context;
  context = null;
  await Promise.race([
    current.close().catch(() => {}),
    new Promise(resolve => setTimeout(resolve, 5000)),
  ]);
}
try {
  context = await chromium.launchPersistentContext(profileDir, {
    executablePath: chromePath,
    headless: false,
    viewport: { width: 430, height: 860 },
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.PWA?.getState().ready, null, { timeout: 30000 });
  const source = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#131b2e';
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.fillStyle = '#ffe088';
    ctx.beginPath();
    ctx.arc(512, 512, 330, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#131b2e';
    ctx.font = 'bold 500px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('B', 512, 545);
    const dataUrl = canvas.toDataURL('image/png');
    CONFIG.setSetting('store.logo', dataUrl);
    return dataUrl;
  });
  await page.waitForFunction(() => window.PWA?.getState().iconSource === 'store.logo' && window.PWA.getState().sourceSize?.width === 1024);
  await page.waitForFunction(() => window.PWA?.getState().canInstall, null, { timeout: 30000 });

  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.enable');
  report.installability = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(report.installability.installabilityErrors, []);
  report.appIdentity = await cdp.send('Page.getAppId');
  assert.equal(report.appIdentity.appId, appUrl);
  record('bytes públicos son instalables con logo runtime', report.appIdentity.appId);

  report.manifest = await cdp.send('Page.getAppManifest');
  assert.match(report.manifest.url, /manifest-[a-f0-9]{20}\.webmanifest$/);
  const manifest = JSON.parse(report.manifest.data);
  const resolvedIcons = manifest.icons.map(icon => new URL(icon.src, report.manifest.url).href);
  report.runtimePixelDigests = {
    icon192: await pixelDigest(page, resolvedIcons.find(url => url.endsWith('-192.png'))),
    icon512: await pixelDigest(page, resolvedIcons.find(url => url.endsWith('-512.png') && !url.includes('maskable'))),
    maskable512: await pixelDigest(page, resolvedIcons.find(url => url.includes('maskable-512.png'))),
  };
  record('manifest público resuelve 192, 512 y maskable desde Cache Storage');

  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'h89-public-install';
    button.textContent = 'Instalar prueba H-89';
    button.addEventListener('click', async () => { window.__h89PublicChoice = await PWA.requestInstall(); });
    document.body.appendChild(button);
  });
  await page.locator('#h89-public-install').click();
  await page.waitForTimeout(1000);
  const automationScript = [
    'Add-Type -AssemblyName UIAutomationClient',
    'Add-Type -AssemblyName UIAutomationTypes',
    '$root = [System.Windows.Automation.AutomationElement]::RootElement',
    '$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)',
    '$owner = $null',
    'foreach ($window in $windows) { try { if ($window.Current.Name -like "*POS Balam Guayaberas*") { $owner = $window; break } } catch {} }',
    'if (-not $owner) { exit 4 }',
    '$pidChrome = $owner.Current.ProcessId',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
    '$target = $null',
    'foreach ($element in $all) { try { $name = $element.Current.Name; $type = $element.Current.ControlType.ProgrammaticName; if ($element.Current.ProcessId -eq $pidChrome -and $type -eq "ControlType.Button" -and $name -match "^(Install|Instalar)$") { $target = $element; break } } catch {} }',
    'if (-not $target) { exit 5 }',
    '$pattern = $target.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)',
    '$pattern.Invoke()',
    'Write-Output "INVOKED"',
  ].join('; ');
  report.installDialogAutomation = (await execFileAsync('powershell.exe', ['-NoProfile', '-Command', automationScript])).stdout.trim();
  await page.waitForFunction(() => window.__h89PublicChoice, null, { timeout: 30000 });
  report.installChoice = await page.evaluate(() => window.__h89PublicChoice);
  assert.equal(report.installChoice.outcome, 'accepted');
  record('diálogo nativo de Chrome aceptó la instalación pública');

  await page.waitForTimeout(2500);
  const ids = await appIds();
  assert.equal(ids.length, 1);
  report.internalAppId = ids[0];
  const manifestRoot = join(profileDir, 'Default', 'Web Applications', 'Manifest Resources', report.internalAppId);
  const installed = {
    icon192: join(manifestRoot, 'Icons', '192.png'),
    icon512: join(manifestRoot, 'Icons', '512.png'),
    maskable512: join(manifestRoot, 'Icons Maskable', '512.png'),
  };
  report.installedFileDigests = {
    icon192: await fileDigest(installed.icon192),
    icon512: await fileDigest(installed.icon512),
    maskable512: await fileDigest(installed.maskable512),
  };
  const installedData = {};
  for (const [key, path] of Object.entries(installed)) installedData[key] = `data:image/png;base64,${(await readFile(path)).toString('base64')}`;
  report.installedPixelDigests = {
    icon192: await pixelDigest(page, installedData.icon192),
    icon512: await pixelDigest(page, installedData.icon512),
    maskable512: await pixelDigest(page, installedData.maskable512),
  };
  assert.deepEqual(report.installedPixelDigests, report.runtimePixelDigests);
  record('Chrome instaló exactamente los píxeles derivados de store.logo');

  await closeContext();
  context = await chromium.launchPersistentContext(profileDir, {
    executablePath: chromePath,
    headless: false,
    viewport: { width: 430, height: 860 },
    args: [`--app-id=${report.internalAppId}`, '--no-first-run', '--no-default-browser-check'],
  });
  const appPage = context.pages()[0] || await context.waitForEvent('page');
  await appPage.waitForLoadState('domcontentloaded');
  await appPage.waitForFunction(() => window.PWA?.getState().ready, null, { timeout: 30000 });
  report.reopened = await appPage.evaluate(() => ({ standalone: matchMedia('(display-mode: standalone)').matches, href: location.href, pwa: PWA.getState() }));
  assert.equal(report.reopened.standalone, true);
  assert.equal(new URL(report.reopened.href).pathname, '/POS_Balam/');
  assert.equal(report.reopened.pwa.iconSource, 'store.logo');
  record('instalación pública reabre en display standalone', report.reopened.href);
  report.sourceDataUrlSha256 = createHash('sha256').update(source).digest('hex');
} finally {
  await closeContext();
  await writeFile(join(evidenceDir, 'chrome-published-install.json'), JSON.stringify(report, null, 2));
}

console.log(`RESULTADO H-89 PUBLICADO: ${report.events.length}/${report.events.length}`);
process.exit(0);
