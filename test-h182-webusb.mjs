// H-182. USBDevice boundary tests; no browser permission, hardware or network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const baseline = process.argv.includes('--baseline');
let source = '';
try {
  source = baseline
    ? execFileSync('git', ['show', 'HEAD:balam/usb-receipt.js'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    : fs.readFileSync('balam/usb-receipt.js', 'utf8');
} catch (_) { /* A missing module is the recorded baseline, not a skipped test. */ }
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'balam-h182-usb-'));
const results = [];
const test = async (name, run) => {
  try { await run(); results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, ok: false, error: error.message }); console.log('FAIL ' + name + ': ' + error.message); }
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = async (predicate = () => true) => {
  for (let i = 0; i < 100; i++) {
    await Promise.resolve();
    if (predicate()) return;
  }
  assert.ok(predicate(), 'Expected asynchronous state was not reached');
};
const bulk = (endpointNumber = 1, direction = 'out') => ({ endpointNumber, direction, type: 'bulk', packetSize: 64 });
const descriptor = ({ configurationValue = 1, interfaceNumber = 0, alternateSetting = 0, interfaceClass = 7, endpoints = [bulk()] } = {}) => {
  const alternate = { alternateSetting, interfaceClass, interfaceSubclass: 1, interfaceProtocol: 2, endpoints };
  return { configurationValue, interfaces: [{ interfaceNumber, claimed: false, alternate, alternates: [alternate] }] };
};
function fixture(options = {}) {
  const calls = [], transfers = [], timers = new Map();
  const storage = options.storage || new Map(), storageCalls = [];
  const localStorage = {
    getItem(key) {
      storageCalls.push(['getItem', key]);
      if (options.storageDenied === true || options.storageDenied === 'getItem') throw new Error('Synthetic storage denial');
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storageCalls.push(['setItem', key, value]);
      if (options.storageDenied === true || options.storageDenied === 'setItem') throw new Error('Synthetic storage denial');
      if (!options.silentStorage) storage.set(key, String(value));
    },
    removeItem(key) {
      storageCalls.push(['removeItem', key]);
      if (options.storageDenied === true || options.storageDenied === 'removeItem') throw new Error('Synthetic storage denial');
      if (!options.silentStorage) storage.delete(key);
    },
  };
  let timerSequence = 0, activeTransfers = 0, maxActiveTransfers = 0;
  const listeners = new Map();
  const emit = (name, event) => (listeners.get(name) || []).forEach(fn => fn(event));
  const device = {
    vendorId: 0x1234, productId: 0x5678, productName: 'SYNTHETIC USB PRINTER', serialNumber: 'TEST-ONLY',
    opened: false, configuration: null,
    configurations: options.configurations || [descriptor()],
    async open() { calls.push(['open']); if (options.open) await options.open(); this.opened = true; },
    async selectConfiguration(value) {
      calls.push(['selectConfiguration', value]);
      this.configuration = this.configurations.find(item => item.configurationValue === value);
      assert.ok(this.configuration, 'Selected configuration must exist');
    },
    async claimInterface(number) {
      calls.push(['claimInterface', number]);
      if (options.claim) await options.claim(number);
      const intf = this.configuration.interfaces.find(item => item.interfaceNumber === number);
      assert.ok(intf, 'Claimed interface must exist'); intf.claimed = true;
    },
    async selectAlternateInterface(number, setting) {
      calls.push(['selectAlternateInterface', number, setting]);
      const intf = this.configuration.interfaces.find(item => item.interfaceNumber === number);
      assert.ok(intf?.claimed, 'Alternate selection requires claimed interface');
      intf.alternate = intf.alternates.find(item => item.alternateSetting === setting);
      assert.ok(intf.alternate, 'Selected alternate must exist');
    },
    async releaseInterface(number) {
      calls.push(['releaseInterface', number]);
      const intf = this.configuration?.interfaces.find(item => item.interfaceNumber === number);
      if (intf) intf.claimed = false;
      if (options.release) await options.release();
    },
    async close() {
      calls.push(['close']);
      if (options.close) await options.close();
      this.opened = false;
      this.configuration?.interfaces.forEach(intf => { intf.claimed = false; });
    },
    async transferOut(endpoint, data) {
      const bytes = ArrayBuffer.isView(data)
        ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
        : Buffer.from(data);
      assert.ok(this.opened, 'No transfer may start on a closed USBDevice');
      const intf = this.configuration.interfaces.find(item => item.claimed && item.alternate.endpoints.some(ep => ep.endpointNumber === endpoint && ep.direction === 'out' && ep.type === 'bulk'));
      assert.ok(intf, 'Transfer must target the claimed bulk OUT endpoint');
      transfers.push(Buffer.from(bytes)); calls.push(['transferOut', endpoint, bytes.length]);
      activeTransfers++; maxActiveTransfers = Math.max(maxActiveTransfers, activeTransfers);
      try {
        return options.transfer
          ? await options.transfer({ bytes: Buffer.from(bytes), number: transfers.length, device })
          : { status: 'ok', bytesWritten: bytes.length };
      } finally { activeTransfers--; }
    },
  };
  const usb = {
    async requestDevice(filters) {
      calls.push(['requestDevice', JSON.parse(JSON.stringify(filters))]);
      return options.choose ? await options.choose(device) : device;
    },
    async getDevices() { calls.push(['getDevices']); return [device]; },
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
    removeEventListener(name, fn) { listeners.set(name, (listeners.get(name) || []).filter(value => value !== fn)); },
  };
  const navigator = { userActivation: { isActive: options.gesture !== false }, ...(options.unsupported ? {} : { usb }) };
  const window = {
    isSecureContext: true, navigator,
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
    removeEventListener(name, fn) { listeners.set(name, (listeners.get(name) || []).filter(value => value !== fn)); },
  };
  const forbid = () => { throw Error('USB printing must not use network'); };
  class SyntheticImage {
    set src(value) {
      this.image = options.images?.[value];
      this.naturalWidth = this.image?.width || 0; this.naturalHeight = this.image?.height || 0;
    }
    async decode() { assert.ok(this.image, 'Synthetic image must exist'); }
  }
  const document = { createElement(tag) {
    assert.equal(tag, 'canvas');
    return { width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage() {},
      getImageData: (_, __, width, height) => ({ data: new Uint8ClampedArray(width * height * 4).fill(255) }) }) };
  } };
  const context = vm.createContext({ window, navigator, isSecureContext: true,
    console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, Blob, URL, AbortController,
    performance, Date, DOMException, fetch: forbid, localStorage, Image: SyntheticImage, document,
    setTimeout(fn, milliseconds) { const id = ++timerSequence; timers.set(id, { fn, milliseconds }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(source, context, { filename: 'usb-receipt.js' });
  return { api: window.USBReceipt, calls, transfers, device, timers, navigator, emit, storage, storageCalls,
    expireOperation() {
      const pending = [...timers.values()].filter(timer => timer.milliseconds >= 30000);
      assert.ok(pending.length, 'Operation must have a bounded timeout');
      pending.forEach(timer => timer.fn());
    },
    get maxActiveTransfers() { return maxActiveTransfers; },
  };
}
const code = expected => error => error?.code === expected;
const closed = f => {
  assert.equal(f.device.opened, false);
  assert.equal(f.api.snapshot().connected, false);
  assert.ok(f.calls.some(call => call[0] === 'close'), 'Acquired USBDevice must be closed');
};
async function uncertain(f, action) {
  await assert.rejects(action);
  const state = f.api.snapshot();
  assert.equal(state.resetRequired, true);
  assert.equal(state.lastJob.result, 'UNCERTAIN');
  assert.equal(state.lastJob.physicalPrintConfirmed, false);
  assert.equal(state.phase, 'RESET_REQUIRED');
  closed(f);
  const before = f.transfers.length;
  // A timed-out native promise may still be unresolved: USB_BUSY is an even
  // earlier barrier until that promise and close settle, then RESET_REQUIRED.
  await assert.rejects(() => f.api.printText(), error => ['USB_RESET_REQUIRED','USB_BUSY'].includes(error?.code));
  assert.equal(f.transfers.length, before, 'Uncertain output must never be replayed');
}

await test('USBReceipt module is available', async () => {
  assert.ok(source, 'balam/usb-receipt.js is absent: the direct USB transport is unavailable');
  const { api } = fixture();
  for (const method of ['connect', 'disconnect', 'printText', 'printImages', 'snapshot', 'setEnabled', 'subscribe', 'acknowledgeReset']) assert.equal(typeof api?.[method], 'function', method);
});
if (source) {
  await test('Import reads local mode without USB permission, output or stored ticket content', async () => {
    const f = fixture(); let updates = 0;
    const unsubscribe = f.api.subscribe(() => { updates++; });
    assert.equal(typeof unsubscribe, 'function'); unsubscribe();
    const state = f.api.snapshot();
    assert.equal(state.supported, true); assert.equal(state.connected, false); assert.equal(state.busy, false);
    assert.equal(f.calls.length, 0);
    assert.equal(state.enabled, false);
    assert.ok(f.storageCalls.every(call => call[0] === 'getItem' && ['balam.print.usb', 'balam.print.usb.uncertain'].includes(call[1])));
    await assert.rejects(() => f.api.printText());
    assert.equal(f.calls.length, 0); assert.equal(f.transfers.length, 0);
  });
  await test('Local USB mode requires explicit enablement, persists separately and never reconnects on reload', async () => {
    const f = fixture();
    assert.throws(() => f.api.setEnabled(true), code('USB_NOT_CONNECTED'));
    await f.api.connect(); assert.equal(f.api.snapshot().enabled, false);
    f.api.setEnabled(true);
    assert.equal(f.api.snapshot().enabled, true); assert.equal(f.storage.get('balam.print.usb'), '1');
    await f.api.disconnect(); assert.equal(f.api.snapshot().enabled, true);
    const reloaded = fixture({ storage: f.storage });
    assert.equal(reloaded.api.snapshot().enabled, true); assert.equal(reloaded.api.snapshot().connected, false);
    assert.equal(reloaded.calls.length, 0); assert.equal(reloaded.transfers.length, 0);
    reloaded.api.setEnabled(false);
    assert.equal(reloaded.api.snapshot().enabled, false); assert.equal(f.storage.has('balam.print.usb'), false);
  });
  await test('Mode and sending fail safely when local persistence is denied or silently drops writes', async () => {
    for (const options of [{ storageDenied: true }, { storageDenied: 'setItem' }, { silentStorage: true }]) {
      const f = fixture(options);
      if (options.storageDenied === true) {
        await assert.rejects(() => f.api.connect(), code('USB_STORAGE'));
        assert.equal(f.calls.length, 0); assert.equal(f.transfers.length, 0);
        continue;
      }
      await f.api.connect();
      assert.throws(() => f.api.setEnabled(true), code('USB_STORAGE'));
      assert.equal(f.api.snapshot().enabled, false);
      await assert.rejects(() => f.api.printText(), code('USB_STORAGE'));
      assert.equal(f.transfers.length, 0); assert.equal(f.api.snapshot().lastJob.result, 'NOT_SENT');
      assert.equal(f.api.snapshot().resetRequired, false); closed(f);
    }
  });
  await test('Uncertain output survives reload and only explicit physical-reset acknowledgement clears it', async () => {
    const f = fixture({ transfer: async () => ({ status: 'stall', bytesWritten: 0 }) });
    await f.api.connect(); f.api.setEnabled(true);
    await uncertain(f, () => f.api.printText());
    assert.equal(f.storage.get('balam.print.usb.uncertain'), '1');
    const reloaded = fixture({ storage: f.storage });
    assert.equal(reloaded.api.snapshot().resetRequired, true); assert.equal(reloaded.api.snapshot().phase, 'RESET_REQUIRED');
    await assert.rejects(() => reloaded.api.connect(), code('USB_RESET_REQUIRED'));
    await assert.rejects(() => reloaded.api.printText(), code('USB_RESET_REQUIRED'));
    assert.equal(reloaded.calls.length, 0); assert.equal(reloaded.transfers.length, 0);
    reloaded.api.setEnabled(false); assert.equal(reloaded.api.snapshot().resetRequired, true);
    reloaded.api.acknowledgeReset(); assert.equal(f.storage.has('balam.print.usb.uncertain'), false);
    await reloaded.api.connect(); await reloaded.api.printText(); await reloaded.api.disconnect();
  });
  await test('The durable uncertain marker exists before the first byte and is cleared after complete transfer', async () => {
    const storage = new Map();
    const f = fixture({ storage, transfer: async ({ bytes }) => {
      assert.equal(storage.get('balam.print.usb.uncertain'), '1');
      return { status: 'ok', bytesWritten: bytes.length };
    } });
    await f.api.connect(); await f.api.printText();
    assert.equal(storage.has('balam.print.usb.uncertain'), false);
    assert.equal(f.api.snapshot().lastJob.result, 'TRANSFERRED'); await f.api.disconnect();
  });
  await test('A failure clearing the durable marker keeps output uncertain and cannot silently acknowledge reset', async () => {
    const f = fixture({ storageDenied: 'removeItem' });
    await f.api.connect(); await uncertain(f, () => f.api.printText());
    assert.equal(f.api.snapshot().lastJob.copiesSent, 1);
    assert.equal(f.storage.get('balam.print.usb.uncertain'), '1');
    assert.throws(() => f.api.acknowledgeReset(), code('USB_STORAGE'));
    assert.equal(f.api.snapshot().resetRequired, true);
  });
  await test('Unsupported browser and missing activation cannot open a chooser', async () => {
    for (const options of [{ unsupported: true }, { gesture: false }]) {
      const f = fixture(options);
      if (options.unsupported) assert.equal(f.api.snapshot().supported, false);
      await assert.rejects(() => f.api.connect()); assert.equal(f.calls.length, 0);
    }
  });
  await test('Chooser uses printer/vendor classes and acquires without printing', async () => {
    const f = fixture(); await f.api.connect();
    const request = f.calls.find(call => call[0] === 'requestDevice');
    assert.deepEqual(request[1].filters.map(filter => filter.classCode).sort((a,b) => a-b), [7,255]);
    assert.equal(f.api.snapshot().connected, true); assert.equal(f.api.snapshot().phase, 'CONNECTED');
    assert.equal(f.transfers.length, 0); assert.equal(f.calls.filter(call => call[0] === 'claimInterface').length, 1);
    await f.api.disconnect(); closed(f);
    assert.ok(f.device.configuration.interfaces.every(intf => !intf.claimed), 'close() must release the USB interfaces');
  });
  await test('Configuration, interface, alternate and endpoint come from descriptors', async () => {
    const config = descriptor({ configurationValue: 5, interfaceNumber: 4, alternateSetting: 2, interfaceClass: 255, endpoints: [bulk(6,'in'),bulk(9)] });
    const inactive = { alternateSetting:0,interfaceClass:255,interfaceSubclass:0,interfaceProtocol:0,endpoints:[] };
    config.interfaces[0].alternates.unshift(inactive); config.interfaces[0].alternate=inactive;
    const f = fixture({ configurations: [config] }); await f.api.connect(); await f.api.printText();
    assert.ok(f.calls.some(call => call[0] === 'selectConfiguration' && call[1] === 5));
    assert.ok(f.calls.some(call => call[0] === 'claimInterface' && call[1] === 4));
    assert.ok(f.calls.some(call => call[0] === 'selectAlternateInterface' && call[1] === 4 && call[2] === 2));
    assert.ok(f.calls.filter(call => call[0] === 'transferOut').every(call => call[1] === 9));
    await f.api.disconnect();
  });
  await test('Ambiguous bulk OUT and unrelated interface classes fail without output', async () => {
    for (const config of [descriptor({ endpoints:[bulk(1),bulk(2)] }), descriptor({ interfaceClass:3 }), descriptor({ endpoints:[bulk(1,'in')] })]) {
      const f = fixture({ configurations:[config] });
      await assert.rejects(() => f.api.connect());
      assert.equal(f.api.snapshot().connected,false); assert.equal(f.transfers.length,0);
      if (f.calls.some(call=>call[0]==='open')) closed(f);
    }
  });
  await test('Claim denial closes the opened device and permits a fresh selection', async () => {
    let denied = true;
    const f = fixture({ claim:async()=>{if(denied) throw new DOMException('Synthetic exclusive access denied','NetworkError');} });
    await assert.rejects(() => f.api.connect()); closed(f); assert.equal(f.transfers.length,0);
    assert.equal(f.api.snapshot().resetRequired,false);
    denied=false; await f.api.connect(); assert.equal(f.api.snapshot().connected,true); await f.api.disconnect();
  });
  await test('Rejected close retains exclusive ownership until a later disconnect succeeds',async()=>{
    let rejected=true;
    const f=fixture({close:async()=>{if(rejected)throw new DOMException('Synthetic close rejection','NetworkError');}});
    await f.api.connect(); await f.api.disconnect();
    assert.equal(f.device.opened,true,'The mock retains the handle when close fails');
    assert.equal(f.api.snapshot().connected,false); assert.equal(f.api.snapshot().cleanupRequired,true);
    assert.equal(f.api.snapshot().busy,true);
    await assert.rejects(()=>f.api.connect(),code('USB_BUSY'));
    await assert.rejects(()=>f.api.printText(),code('USB_BUSY'));
    assert.throws(()=>f.api.acknowledgeReset(),code('USB_BUSY'));
    assert.equal(f.calls.filter(call=>call[0]==='requestDevice').length,1);
    rejected=false; await f.api.disconnect(); closed(f);
    assert.equal(f.api.snapshot().cleanupRequired,false); assert.equal(f.api.snapshot().busy,false);
    await f.api.connect(); await f.api.printText(); await f.api.disconnect();
  });
  await test('Physical detach clears a quarantined failed close without reusing the handle',async()=>{
    const f=fixture({close:async()=>{throw new DOMException('Synthetic close rejection','NetworkError');}});
    await f.api.connect(); await f.api.disconnect();
    assert.equal(f.api.snapshot().cleanupRequired,true); assert.equal(f.api.snapshot().busy,true);
    const closes=f.calls.filter(call=>call[0]==='close').length;
    f.device.opened=false; f.device.configuration.interfaces.forEach(intf=>{intf.claimed=false;});
    f.emit('disconnect',{device:f.device});
    await settle(()=>!f.api.snapshot().busy);
    assert.equal(f.api.snapshot().cleanupRequired,false); assert.equal(f.api.snapshot().connected,false);
    assert.equal(f.calls.filter(call=>call[0]==='close').length,closes);
    assert.equal(f.transfers.length,0); f.api.acknowledgeReset();
  });
  await test('Physical detach during a pending close cannot restore quarantine on late rejection',async()=>{
    const gate=deferred(); const f=fixture({close:()=>gate.promise});
    await f.api.connect(); const closing=f.api.disconnect();
    await settle(()=>f.calls.some(call=>call[0]==='close'));
    f.device.opened=false; f.device.configuration.interfaces.forEach(intf=>{intf.claimed=false;});
    f.emit('disconnect',{device:f.device});
    gate.reject(new DOMException('Synthetic detached close rejection','NetworkError')); await closing;
    assert.equal(f.api.snapshot().busy,false); assert.equal(f.api.snapshot().cleanupRequired,false);
    assert.equal(f.api.snapshot().connected,false); assert.equal(f.transfers.length,0);
  });
  await test('Timed-out open remains excluded and a late opened handle is closed again',async()=>{
    const gate=deferred(); const f=fixture({open:()=>gate.promise});
    const opening=f.api.connect(); const rejection=assert.rejects(()=>opening);
    await settle(()=>f.calls.some(call=>call[0]==='open')); f.expireOperation(); await rejection;
    assert.equal(f.api.snapshot().connected,false); assert.equal(f.api.snapshot().busy,true);
    await assert.rejects(()=>f.api.connect(),code('USB_BUSY'));
    assert.throws(()=>f.api.acknowledgeReset(),code('USB_BUSY'));
    assert.equal(f.calls.filter(call=>call[0]==='close').length,1);
    gate.resolve(); await settle(()=>!f.api.snapshot().busy); closed(f);
    assert.equal(f.calls.filter(call=>call[0]==='close').length,2);
    assert.equal(f.calls.filter(call=>call[0]==='claimInterface').length,0);
    assert.equal(f.calls.filter(call=>call[0]==='requestDevice').length,1);
    assert.equal(f.api.snapshot().resetRequired,false); assert.equal(f.transfers.length,0);
  });
  await test('Cancelled chooser sends nothing and does not retain a busy state', async () => {
    const f = fixture({ choose:async()=>{throw new DOMException('Synthetic cancellation','NotFoundError');} });
    await assert.rejects(() => f.api.connect());
    assert.equal(f.api.snapshot().busy,false); assert.equal(f.api.snapshot().connected,false);
    assert.equal(f.api.snapshot().resetRequired,false); assert.equal(f.transfers.length,0);
    assert.ok(!f.calls.some(call=>call[0]==='open'));
  });
  await test('Repeated connect is excluded and disconnect invalidates a late chooser result', async () => {
    const pending = deferred(); const f = fixture({ choose:()=>pending.promise });
    const first = f.api.connect(); const observed = first.then(()=>null,error=>error);
    await settle(()=>f.calls.some(call=>call[0]==='requestDevice'));
    await assert.rejects(() => f.api.connect(),code('USB_BUSY'));
    await f.api.disconnect(); pending.resolve(f.device); await observed;
    assert.equal(f.api.snapshot().connected,false);
    assert.ok(!f.calls.some(call=>call[0]==='open'),'A late permission must not reopen a cancelled connection');
    assert.equal(f.transfers.length,0);
  });
  await test('Consecutive text jobs deliver complete identical bytes and preserve the USB session', async () => {
    const f = fixture(); await f.api.connect();
    await f.api.printText(); const boundary=f.transfers.length;
    const first=Buffer.concat(f.transfers); const firstJob=JSON.parse(JSON.stringify(f.api.snapshot().lastJob));
    await f.api.printText(); const second=Buffer.concat(f.transfers.slice(boundary));
    assert.deepEqual(second,first); assert.ok(first.includes(Buffer.from('PRUEBA USB BALAM\nSIN VALOR COMERCIAL\nFIN DE PRUEBA\n')));
    assert.equal(firstJob.result,'TRANSFERRED'); assert.equal(firstJob.physicalPrintConfirmed,false);
    assert.equal(firstJob.bytesSent,first.length); assert.equal(f.api.snapshot().lastJob.bytesSent,second.length);
    assert.equal(f.maxActiveTransfers,1); assert.equal(f.api.snapshot().connected,true);
    assert.equal(f.calls.filter(call=>call[0]==='requestDevice').length,1);
    assert.equal(f.calls.filter(call=>call[0]==='claimInterface').length,1);
    await f.api.disconnect(); closed(f);
  });
  await test('Double print and reset acknowledgement cannot interleave a busy job', async () => {
    const gate=deferred(); const f=fixture({transfer:async({bytes,number})=>{if(number===1)await gate.promise;return {status:'ok',bytesWritten:bytes.length};}});
    await f.api.connect(); const first=f.api.printText();
    await settle(()=>f.transfers.length===1);
    await assert.rejects(()=>f.api.printText(),code('USB_BUSY'));
    assert.throws(()=>f.api.acknowledgeReset());
    assert.throws(()=>f.api.setEnabled(false),code('USB_BUSY'));
    assert.equal(f.transfers.length,1); gate.resolve(); await first;
    assert.equal(f.maxActiveTransfers,1); await f.api.disconnect();
  });
  for (const failure of ['short','stall','reject']) {
    await test('First transfer '+failure+' halts output and requires explicit physical reset',async()=>{
      let failing=true;
      const f=fixture({transfer:async({bytes})=>{
        if(!failing)return {status:'ok',bytesWritten:bytes.length};
        if(failure==='reject')throw new DOMException('Synthetic transfer rejection','NetworkError');
        return {status:failure==='stall'?'stall':'ok',bytesWritten:failure==='short'?Math.max(0,bytes.length-1):0};
      }});
      await f.api.connect(); await uncertain(f,()=>f.api.printText());
      assert.equal(f.transfers.length,1,'No cut, continuation, second copy, or retry after failure');
      await assert.rejects(()=>f.api.connect(),code('USB_RESET_REQUIRED'));
      f.api.acknowledgeReset(); assert.equal(f.api.snapshot().resetRequired,false);
      failing=false; await f.api.connect(); await f.api.printText();
      assert.equal(f.api.snapshot().lastJob.result,'TRANSFERRED'); await f.api.disconnect();
    });
  }
  await test('Failure after an accepted prefix records exact progress and never sends the trailing cut',async()=>{
    const f=fixture({transfer:async({bytes,number})=>({status:'ok',bytesWritten:number===2?7:bytes.length})});
    await f.api.connect(); await uncertain(f,()=>f.api.printText());
    assert.equal(f.transfers.length,2); assert.equal(f.api.snapshot().lastJob.bytesSent,f.transfers[0].length+7);
    assert.equal(f.api.snapshot().lastJob.copiesSent,0);
    assert.ok(!Buffer.concat(f.transfers).includes(Buffer.from([0x1d,0x56,0x42,0])),'No cutter command after partial text');
  });
  await test('Timeout closes the endpoint and late completion cannot resume output',async()=>{
    const gate=deferred(); const f=fixture({transfer:()=>gate.promise});
    await f.api.connect(); const job=f.api.printText(); const rejected=uncertain(f,()=>job);
    await settle(()=>f.transfers.length===1); f.expireOperation(); await rejected;
    const before=f.transfers.length; gate.resolve({status:'ok',bytesWritten:f.transfers[0].length});
    await settle(); await settle();
    assert.equal(f.transfers.length,before); assert.equal(f.api.snapshot().resetRequired,true);
  });
  await test('USB disconnect during transfer cannot send trailing bytes',async()=>{
    const gate=deferred(); const f=fixture({transfer:()=>gate.promise});
    await f.api.connect(); const job=f.api.printText(); const rejected=uncertain(f,()=>job);
    await settle(()=>f.transfers.length===1); f.emit('disconnect',{device:f.device});
    gate.reject(new DOMException('Synthetic unplug','NetworkError')); await rejected;
    assert.equal(f.transfers.length,1);
  });
  await test('Disconnect of an unrelated USB device leaves the selected printer usable',async()=>{
    const f=fixture(); await f.api.connect(); f.emit('disconnect',{device:{vendorId:9,productId:9}});
    assert.equal(f.api.snapshot().connected,true); await f.api.printText();
    assert.equal(f.api.snapshot().lastJob.result,'TRANSFERRED'); await f.api.disconnect();
  });
  await test('Invalid copy count is rejected before any USB bytes and needs no printer reset',async()=>{
    for (const images of [[], ['one','two','three']]) {
      const f=fixture(); await f.api.connect(); await assert.rejects(()=>f.api.printImages(images),code('USB_COPIES'));
      assert.equal(f.transfers.length,0); assert.equal(f.api.snapshot().lastJob.result,'NOT_SENT');
      assert.equal(f.api.snapshot().resetRequired,false); closed(f);
    }
  });
  await test('One or two complete 576px copies use the same raster framing', async () => {
    const png = 'data:image/png;base64,synthetic';
    for (const count of [1,2]) {
      const f = fixture({ images: { [png]: { width: 576, height: 2 } } });
      await f.api.connect(); await f.api.printImages(Array(count).fill(png));
      assert.equal(f.api.snapshot().lastJob.copiesSent, count);
      assert.equal(f.transfers.length, 1 + count * 2);
      for (let i = 0; i < count; i++) {
        assert.deepEqual(f.transfers[1 + i*2], Buffer.concat([Buffer.from([0x1d,0x76,0x30,0,72,0,2,0]), Buffer.alloc(144)]));
        assert.deepEqual(f.transfers[2 + i*2], Buffer.from([0x1b,0x64,3,0x1d,0x56,0x42,0]));
      }
      assert.equal(f.api.snapshot().lastJob.result, 'TRANSFERRED'); await f.api.disconnect();
    }
  });
  await test('The second image is validated before any bytes from the first image are sent', async () => {
    const first = 'data:image/png;base64,first', second = 'data:image/png;base64,second';
    const f = fixture({ images: { [first]: { width: 576, height: 2 }, [second]: { width: 575, height: 2 } } });
    await f.api.connect(); await assert.rejects(() => f.api.printImages([first, second]), code('USB_IMAGE_SIZE'));
    assert.equal(f.transfers.length, 0); assert.equal(f.api.snapshot().lastJob.result, 'NOT_SENT');
    assert.equal(f.storage.has('balam.print.usb.uncertain'), false); closed(f);
  });
  await test('Page lifecycle release closes the session without replay or a false uncertain job',async()=>{
    const f=fixture(); await f.api.connect(); await f.api.printText();
    const before=f.transfers.length; f.emit('pagehide',{});
    await settle(()=>!f.api.snapshot().busy); closed(f);
    assert.equal(f.transfers.length,before); assert.equal(f.api.snapshot().resetRequired,false);
    assert.equal(f.api.snapshot().lastJob.result,'TRANSFERRED');
  });
  await test('Subscriber removal stops notifications and disconnected reset is explicit',async()=>{
    const f=fixture(); let observations=0; const off=f.api.subscribe(()=>{observations++;});
    await f.api.connect(); assert.ok(observations>0); assert.throws(()=>f.api.acknowledgeReset());
    off(); const before=observations; await f.api.printText(); await f.api.disconnect();
    assert.equal(observations,before); assert.equal(f.api.snapshot().busy,false);
  });
}
const report={baseline,source:'balam/usb-receipt.js',sourceSHA256:source?createHash('sha256').update(source).digest('hex'):null,synthetic:true,hardware:'NOT_TESTED',networkRequests:0,results};
fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify(report,null,2)+'\n');
console.log(results.filter(result=>result.ok).length+'/'+results.length+' '+evidence);
process.exitCode=results.every(result=>result.ok)?0:1;
