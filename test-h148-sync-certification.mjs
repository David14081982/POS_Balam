// Fail-closed delivery gate; --self-test never certifies live convergence.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const REQUIRED_CASES=[
 'Bootstrap A/B/C from real authority',
 'Create references A -> B/C/Supabase',
 'Edit reference with immutable identity',
 'Delete reference A -> B/C/Supabase tombstone',
 'Reload cannot resurrect a deleted reference',
 'Old protocol and stale payload cannot resurrect a tombstone',
 'Realtime disconnected: periodic reconciliation converges',
 'Offline intent survives reload and uploads once',
 'Sale decrements authoritative stock exactly once',
 'Concurrent sales A/B preserve both stock deltas',
 'Return restores the exact reference and financial document',
 'Exchange preserves original sale and both reference identities',
 'Loan and return retain their frozen document',
 'Layaway partial payment and liquidation converge',
 'Client create/edit/delete and inactive promotion remain scoped',
 'Commission settlement affects only the test seller',
 'Configuration and permission invalidations reach every terminal',
 'Lost acknowledgement replays the identical operation once',
 'Closed terminal reopens to authority and repairs damaged cache',
 'Visible update control reconciles and fits mobile and desktop',
 'Final projections and device checkpoints agree with authority',
];
const REQUIRED_DOMAINS=['products','clients','sellers','promotions','sales','payments','returns','exchanges','loans','liquidations','commissionAdjustments','movements','config','permissions','purges','devices'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function validate(r,{htmlHash,certifierHash,project,now=Date.now()}) {
 assert.equal(r.project,project,'wrong Supabase authority');
 assert.equal(r.sourceSha256,htmlHash,'tested build differs from delivery');
 assert.equal(r.certifierSha256,certifierHash,'certifier changed after run');
 assert.equal(r.partial,false,'partial run');assert.equal(r.error,undefined);
 assert.equal(r.manifest?.system_mode,'preproduction');assert.equal(r.profiles,3);
 assert.ok(r.transport?.startsWith('Real HTTPS Supabase;'));
 const age=now-Date.parse(r.finishedAt);assert.ok(Number.isFinite(age)&&age>=0&&age<86400000,'certificate must be from last 24 hours');
 assert.deepEqual(r.cases.map(c=>c.name).sort(),[...REQUIRED_CASES].sort());
 for(const c of r.cases)assert.equal(c.ok,true,c.name);
 assert.deepEqual([...r.domains].sort(),[...REQUIRED_DOMAINS].sort());
 assert.equal(r.pendingLost,0);assert.equal(r.finalDivergences,0);
 assert.equal(r.cleanup?.ok,true);assert.deepEqual(r.cleanup.errors,[]);
 assert.equal(r.businessPreservation?.ok,true);
 assert.equal(Object.keys(r.businessPreservation.before).length,17);
 assert.deepEqual(r.businessPreservation.after,r.businessPreservation.before);
 const devices=r.cases.find(c=>c.name===REQUIRED_CASES.at(-1)).evidence.devices;
 assert.equal(devices.length,3);assert.equal(new Set(devices.map(d=>d.device_id)).size,3);
 for(const d of devices){assert.equal(d.queue_pending,0);assert.equal(d.queue_blocked,0);assert.equal(Number(d.data_epoch),Number(r.manifest.data_epoch));}
}
if(process.argv[2]==='--self-test'){
 const now=Date.now(),business=Object.fromEntries(Array.from({length:17},(_,i)=>['table'+i,'hash']));
 const valid={project:'test',sourceSha256:'html',certifierSha256:'code',partial:false,profiles:3,transport:'Real HTTPS Supabase;',manifest:{system_mode:'preproduction',data_epoch:7},finishedAt:new Date(now).toISOString(),cases:REQUIRED_CASES.map(name=>({name,ok:true,evidence:{devices:['A','B','C'].map(device_id=>({device_id,queue_pending:0,queue_blocked:0,data_epoch:7}))}})),domains:REQUIRED_DOMAINS,pendingLost:0,finalDivergences:0,cleanup:{ok:true,errors:[]},businessPreservation:{ok:true,before:business,after:{...business}}};
 const args={htmlHash:'html',certifierHash:'code',project:'test',now};validate(valid,args);
 const mutations=[r=>r.partial=true,r=>r.profiles=1,r=>r.cases.pop(),r=>r.cases[0].ok=false,r=>r.domains=[],r=>r.sourceSha256='stale',r=>r.certifierSha256='old',r=>r.cleanup.ok=false,r=>r.businessPreservation.after.table0='changed',r=>r.pendingLost=1,r=>r.finalDivergences=1,r=>r.finishedAt='2000-01-01',r=>r.transport='mock',r=>r.cases.at(-1).evidence.devices[0].queue_pending=1];
 for(const mutate of mutations){const r=structuredClone(valid);mutate(r);assert.throws(()=>validate(r,args));}
 console.log(`PASS gate contract: ${mutations.length} false certificates rejected. No live certification performed.`);
}else if(!process.argv[2]){console.error('NOT CERTIFIED: supply matrix.json from the complete live run');process.exitCode=2;}
else {
 const r=JSON.parse(readFileSync(process.argv[2],'utf8'));
 const project=new URL(readFileSync('balam/store.jsx','utf8').match(/const SUPABASE_URL = '([^']+)'/)[1]).hostname.split('.')[0];
 validate(r,{htmlHash:sha(readFileSync(process.env.BALAM_VERIFIED_HTML||'index.html')),certifierHash:sha(readFileSync('test-h148-live-convergence.mjs')),project});
 console.log(`CERTIFIED ${r.domains.length}/16 domains, ${r.cases.length}/21 real A/B/C cases; no lost pending operations or final divergences.`);
}
