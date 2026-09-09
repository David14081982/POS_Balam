import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
// Exact target identities, with synthetic backup contents in the isolated local DB.
const payments=[
 {id:'pay-cmb-2ae5650d-be20-4047-b647-9f14004cf69c',folio:'BG-260901-0001',fecha:'2026-09-01 10:25',monto:790},
 {id:'pay-cmb-de5ce05f-ac06-4834-9905-89f19ba30f49',folio:'BG-260908-0492',fecha:'2026-09-08 10:27',monto:100},
].map(p=>({...p,tipo:'cambio',metodo:'Tarjeta',tarjeta:p.monto,efectivo:0,transferencia:0,otro:0,created_at:'2026-09-08T17:27:23Z',components:[{methodCode:'Tarjeta',methodLabel:'Tarjeta',amount:p.monto}]}));
const original={cleanup_id:'8d996563-96db-4537-9930-032e86de15bd',backup_id:'04a179dd-636d-42fc-80bd-9c2dc0df77d5',
 exchanges:payments.map(p=>({id:p.id.slice(4),folio:p.folio,diferencia:p.monto}))};
const payload=quote(JSON.stringify({exchanges:original.exchanges}))+'::jsonb';
const cleanup=quote(original.cleanup_id),backup=quote(original.backup_id);
const base=`begin;
do $$ begin if current_database()<>'h150_exact' then raise exception 'LOCAL_DATABASE_REQUIRED'; end if; end $$;
update pos.system_manifest set data_epoch=8,system_mode='preproduction';
insert into pos.test_data_cleanup_backups(backup_id,created_by,protocol_version,data_epoch,preset,selection_normalized,plan_hash,payload_hash,payload)
values(${backup},'00000000-0000-4000-8000-000000000150',6,7,'custom','{"exchanges":true}','fixture',pos.point_zero_sha256(${payload}),${payload});
insert into pos.test_data_cleanup_operations(cleanup_id,backup_id,status,actor_user_id,protocol_version,data_epoch_before,data_epoch_after,preset,selection_normalized,plan_hash,completed_at)
values(${cleanup},${backup},'completed','00000000-0000-4000-8000-000000000150',6,7,8,'custom','{"exchanges":true}','fixture','2026-09-09T17:20:08Z');
insert into pos.purged_documents(kind,identity,purge_id) select 'exchange',e->>'id',${cleanup} from jsonb_array_elements(${payload}->'exchanges') e;
insert into pos.sale_payments select * from jsonb_populate_recordset(null::pos.sale_payments,${quote(JSON.stringify(payments))}::jsonb);
insert into pos.sale_payments(id,folio,fecha,tipo,metodo,monto,tarjeta) values('h152-untouched','H152-KEEP','2026-09-09','venta','Tarjeta',25,25);
`;
const body=readFileSync('supabase/REPARAR-PAGOS-LIMPIEZA-H152.sql','utf8').replace(/^begin;$/m,'').replace(/commit;\s*$/,'');
const args=['-X','-w','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55424','-U','postgres','-d','h150_exact'];
let passed=0,failed=0;
function test(name,before,expected){
 try{
  let error=null;try{execFileSync('C:/Program Files/PostgreSQL/18/bin/psql.exe',args,{input:base+before+body+(expected?'':body+`do $$ begin if (select count(*) from pos.sale_payments)<>1 or (select monto from pos.sale_payments where id='h152-untouched')<>25 or (select count(*) from pos.test_data_cleanup_backups)<>2 then raise exception 'REPAIR_POSTCONDITION'; end if; end $$;`)+ '\nrollback;',encoding:'utf8',stdio:['pipe','pipe','pipe']});}catch(e){error=e.stderr||e.message;}
  if(expected)assert.match(String(error),new RegExp(expected));else assert.equal(error,null);
  console.log('PASS '+name);passed++;
 }catch(e){console.log('FAIL '+name+': '+e.message);failed++;}
}
test('repair exact $890, retain unrelated payment, sealed backup and idempotent repeat','',null);
test('changed epoch rejects repair','update pos.system_manifest set data_epoch=9;','H152_REPAIR_ENVIRONMENT_CHANGED');
test('missing selected row rejects partial repair',"delete from pos.sale_payments where id='pay-cmb-de5ce05f-ac06-4834-9905-89f19ba30f49';",'H152_REPAIR_PAYMENTS_CHANGED');
test('unrelated folio rejects repair',"update pos.sale_payments set folio='OTHER' where id='pay-cmb-de5ce05f-ac06-4834-9905-89f19ba30f49';",'H152_REPAIR_LINEAGE_MISMATCH');
test('invalid original backup rejects repair',`update pos.test_data_cleanup_backups set payload_hash='invalid' where backup_id=${backup};`,'H152_REPAIR_AUTHORITY_MISMATCH');
console.log(`H152 repair ${passed} passed, ${failed} failed`);if(failed)process.exitCode=1;
