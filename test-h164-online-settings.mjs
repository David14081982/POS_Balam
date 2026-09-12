// Focused feedback regressions on the actual Settings source callbacks.
// Select only a changed case with BALAM_SETTINGS_CASE=keyboard|logo|fleet.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('balam/settings.jsx', 'utf8');
const selected = process.env.BALAM_SETTINGS_CASE;
assert.ok(!selected || ['keyboard', 'logo', 'fleet'].includes(selected));
const shared = fs.readFileSync('balam/shared.jsx', 'utf8');
const messageStart = shared.indexOf('  const TECHNICAL_JARGON');
const messageEnd = shared.indexOf('  function HumanMessage(', messageStart);
const messageContext = vm.createContext({ window: {} });
vm.runInContext(shared.slice(messageStart, messageEnd) + '\nglobalThis.authority = messageAuthority;', messageContext);
const flatten = node => Array.isArray(node) ? node.flatMap(flatten)
  : node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(flatten)] : [];
function fixture(fleet, fleetTab = 'historial') {
  const messages = [], draftWrites = [];
  let requests = 0, rejectRemote, hook = 0;
  const retirementCalls = [];
  const fleetState = [{ ready: true }, false, fleet, fleetTab, null, '', 'pc'];
  const remote = new Promise((_, reject) => { rejectRemote = reject; });
  const React = {
    useState: () => [fleet ? fleetState[hook++] : 'Catálogo sin confirmar', value => draftWrites.push(value)],
    useEffect() {}, useRef: value => ({ current: value }),
    createElement: (type, props, ...children) => ({ type, props, children }),
  };
  const window = {
    UI: {
      toast: (value, color) => messages.push({ value, color, human: messageContext.authority(value) }),
      imageFileDimensions: async () => ({ width: 1024, height: 512 }),
      resizeImageFile: async () => 'data:image/png;base64,unconfirmed',
      technicalMessageViewer: () => false,
    },
    HX: { MS() {}, GlassCard() {}, SerifHeading() {} },
    CONFIG: {
      addCatalog: () => { requests++; return remote; },
      get: () => 'data:image/png;base64,confirmed',
      setSetting: (key, value) => {
        assert.equal(key, 'store.logo');
        assert.equal(value, 'data:image/png;base64,unconfirmed');
        requests++; return remote;
      },
    },
    DATA: {},
    AUTH: { isAdmin: () => true },
    confirm: () => true,
    prompt: () => { throw new Error('Reactivation must not request a retirement reason'); },
    STORE: {
      syncStatus: () => ({ ready: true }),
      syncFleetStatus: async () => fleet,
      setSyncDeviceRetired: async (...args) => { retirementCalls.push(args); return { ok: true }; },
    },
  };
  const exposed = source.replace(/\}\)\(\);\s*$/, 'window.__settingsTest = { NewCatalogCard, LogoUploader, SyncHealthCard };\n})();');
  assert.notEqual(exposed, source, 'Test seam must expose the actual source components');
  vm.runInNewContext(exposed, { window, React }, { filename: 'balam/settings.jsx' });
  return { messages, draftWrites, rejectRemote, retirementCalls, window, requests: () => requests };
}

if (!selected || selected === 'keyboard') {
  const f = fixture();
  const input = flatten(f.window.__settingsTest.NewCatalogCard()).find(node => node.type === 'input' && node.props.onKeyDown);
  assert.ok(input);
  const result = input.props.onKeyDown({ key: 'Enter' });
  assert.equal(f.requests(), 1);
  assert.equal(typeof result?.then, 'function', 'Keyboard returns the operation to the error boundary');
  assert.equal(f.messages.length, 0);
  assert.equal(f.draftWrites.length, 0, 'Do not clear the form before confirmation');
  const failure = Object.assign(new Error('Sin conexión. BALAM necesita internet para continuar.'), { code: 'ONLINE_UNAVAILABLE' });
  f.rejectRemote(failure);
  await result;
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].value, failure);
  assert.equal(f.messages[0].color, 'var(--danger)');
  assert.equal(f.draftWrites.length, 0, 'A rejection leaves the draft intact');
  console.log('PASS settings keyboard: one request, one visible rejection, draft preserved, no success');
}

if (!selected || selected === 'logo') {
  const f = fixture();
  const input = flatten(f.window.__settingsTest.LogoUploader()).find(node => node.type === 'input' && node.props.type === 'file');
  assert.ok(input);
  const result = input.props.onChange({ target: { files: [{ type: 'image/png' }], value: 'logo.png' } });
  const failure = Object.assign(new Error('Failed to fetch after COMMIT'), { code: 'ONLINE_RESULT_UNKNOWN' });
  f.rejectRemote(failure);
  await result;
  assert.equal(f.requests(), 1);
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].value, failure, 'An online result must not become an image-reading error');
  assert.equal(f.messages[0].human.title, 'Estamos confirmando la operación. No la repitas.');
  assert.equal(f.messages[0].human.explanation + f.messages[0].human.action, '');
  assert.equal(f.window.CONFIG.get('store.logo'), 'data:image/png;base64,confirmed');
  console.log('PASS settings logo: authoritative error preserved, exact confirmation message, no success');
}

if (!selected || selected === 'fleet') {
  const fleet = { devices: [{ device_id: 'reactivated-online', status: 'online',
    metadata: { retired_at: '2026-09-10T00:00:00Z', reactivated_at: '2026-09-11T00:00:00Z' } }],
    history: [{ device_id: 'retired-a', status: 'revoked' }, { device_id: 'retired-b', status: 'revoked' }] };
  const f = fixture(fleet);
  const nodes = flatten(f.window.__settingsTest.SyncHealthCard());
  const states = nodes.filter(node => node.type === 'span' && node.props.key === 'state');
  assert.equal(states.length, 2);
  assert.ok(states.every(node => node.children[0] === 'Retirado'));
  const buttons = nodes.filter(node => node.type === 'button' && node.props['data-testid']?.startsWith('device-retire-'));
  assert.equal(buttons.length, 2);
  assert.ok(buttons.every(node => node.children[0] === 'Reactivar'));
  const result = buttons[0].props.onClick();
  assert.equal(typeof result?.then, 'function', 'Retirement action returns its confirmed completion');
  await result;
  assert.deepEqual(f.retirementCalls, [['retired-a', false, '']], 'Reactivate in server; do not retire an already retired installation');
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].value, 'Equipo reactivado.');
  const active = fixture(fleet, 'equipos');
  const activeNodes = flatten(active.window.__settingsTest.SyncHealthCard());
  const activeState = activeNodes.find(node => node.type === 'span' && node.props.key === 'state');
  assert.equal(activeState.children[0], 'Activo', 'Historical retirement metadata cannot revoke an active device');
  const activeButton = activeNodes.find(node => node.props?.['data-testid'] === 'device-retire-reactivated-online');
  assert.equal(activeButton.children[0], 'Retirar');
  assert.equal(active.retirementCalls.length, 0);
  console.log('PASS settings fleet: real revoked status, active reactivation history, one confirmed reactivation with retired=false');
}
