// H-181: actual Chromium navigation boundary, not just a DOM attribute assertion.
// Chrome documents intent: navigation: https://developer.chrome.com/docs/android/intents
// AOSP Intent.parseUriInternal removes "intent:" from data and prepends a scheme
// only when a scheme= field exists. Without that field the nested URI remains intact:
// https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/core/java/android/content/Intent.java
// Uri.parse returns StringUri, whose toString preserves its input:
// https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/core/java/android/net/Uri.java
// Chrome Android passes the parsed intent onward without rewriting its data:
// https://raw.githubusercontent.com/chromium/chromium/main/components/external_intents/android/java/src/org/chromium/components/external_intents/ExternalNavigationHandler.java
// This test runs Chromium CDP. It does NOT execute Android Intent.parseUri,
// launch THERMER, print on USB, or certify hardware acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const responseUrl = 'https://telohdbvbvsfmwyriflz.supabase.co/storage/v1/object/sign/balam-thermer-private/'
  + '1790888888-12345678-1234-4234-8234-123456789abc.json?token=synthetic.payload.signature&probe=alpha%2Fbeta%3D';
const original = 'my.bluetoothprint.scheme://' + responseUrl;
const legacy = original;
const fixed = 'intent:' + original + '#Intent;package=mate.bluetoothprint;end';
const browser = await chromium.launch({ headless: true,
  ...(process.env.BALAM_CHROME_EXECUTABLE ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE } : { channel: 'chrome' }) });
const evidence = {
  synthetic: true, browser: browser.version(), platform: process.platform,
  responseUrl, androidParserExecution: 'NOT_TESTED', physicalPrinting: 'NOT_TESTED',
  sources: [
    'https://developer.chrome.com/docs/android/intents',
    'https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/core/java/android/content/Intent.java',
    'https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/core/java/android/net/Uri.java',
    'https://raw.githubusercontent.com/chromium/chromium/main/components/external_intents/android/java/src/org/chromium/components/external_intents/ExternalNavigationHandler.java',
  ],
};
try {
  const context = await browser.newContext();
  await context.route('**/*', route => route.abort()); // No network, valid keys or business data.
  const page = await context.newPage(), cdp = await context.newCDPSession(page);
  await cdp.send('Page.enable');
  await page.setContent('<button type="button" data-testid="open-thermer">Open synthetic URI</button>');
  async function navigate(input) {
    const fields = await page.evaluate(value => {
      const anchor = document.createElement('a'); anchor.href = value;
      const button = document.querySelector('[data-testid="open-thermer"]');
      button.onclick = () => { document.body.appendChild(anchor); anchor.click(); anchor.remove(); };
      return { input: value, attribute: anchor.getAttribute('href'), href: anchor.href };
    }, input);
    let timer, listener;
    const requested = new Promise((resolve, reject) => {
      listener = event => resolve({ url: event.url, reason: event.reason, disposition: event.disposition });
      cdp.on('Page.frameRequestedNavigation', listener);
      timer = setTimeout(() => reject(Error('CDP_NAVIGATION_MISSING')), 10000);
    });
    try {
      await page.getByTestId('open-thermer').click();
      return { ...fields, navigation: await requested };
    } finally { clearTimeout(timer); cdp.off('Page.frameRequestedNavigation', listener); }
  }
  evidence.legacy = await navigate(legacy);
  const damaged = original.replace('://https://', '://https//');
  assert.equal(evidence.legacy.attribute, original, 'source attribute retains its nested HTTPS colon');
  assert.equal(evidence.legacy.href, damaged, 'legacy href loses its nested HTTPS colon');
  assert.equal(evidence.legacy.navigation.url, damaged, 'actual legacy navigation also loses the colon');
  assert.equal(evidence.legacy.navigation.reason, 'anchorClick');
  assert.notEqual(evidence.legacy.navigation.url, original, 'legacy URI fails the transport integrity contract');
  console.log('PASS H181 negative reproduction: legacy attribute intact, href and CDP navigation damaged');

  evidence.fixed = await navigate(fixed);
  assert.equal(evidence.fixed.attribute, fixed);
  assert.equal(evidence.fixed.href, fixed, 'opaque intent wrapper survives href serialization');
  assert.equal(evidence.fixed.navigation.url, fixed, 'actual fixed navigation preserves every URI byte');
  assert.equal(evidence.fixed.navigation.reason, 'anchorClick');
  assert.ok(evidence.fixed.navigation.url.includes(original), 'signed query preserved without application-side decoding');
  assert.ok(!evidence.fixed.navigation.url.includes(';scheme='), 'no scheme substitution in Android parser contract');
  console.log('PASS H181 positive transport: opaque intent preserves complete URI and signed query in CDP');
  evidence.result = 'PASS 2/2';
  fs.writeFileSync('docs/fixes/evidence/h181-browser-uri.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log('PASS H181 browser URI: 2/2; Android parser and hardware NOT_TESTED');
} finally { await browser.close(); }
