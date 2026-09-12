// One device-identity regression: reload preserves identity; denied storage never invents installations.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
const source=fs.readFileSync('balam/core.jsx','utf8');
const storage=new Map();
const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
function core(store){const window={};vm.runInNewContext(source,{window,localStorage:store,crypto:webcrypto});return window.CORE;}
const first=core(localStorage).getDeviceId();
assert.match(first,/^dev-[0-9a-f-]{36}$/);
assert.equal(core(localStorage).getDeviceId(),first);
storage.set('balam_device_id','existing-historical-installation');
assert.equal(core(localStorage).getDeviceId(),'existing-historical-installation');
const denied=core({getItem(){throw Error('denied');},setItem(){throw Error('denied');}});
assert.throws(()=>denied.getDeviceId(),error=>error.code==='DEVICE_IDENTITY_UNAVAILABLE');
assert.throws(()=>denied.getDeviceId(),error=>error.code==='DEVICE_IDENTITY_UNAVAILABLE');
assert.equal(storage.size,1);
console.log('PASS device identity survives reload and preserves history; denied storage creates zero volatile installations');
