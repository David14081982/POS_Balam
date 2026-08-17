// H-113 · Contrato permanente de limpieza selectiva. El comportamiento SQL se
// ejerce en la verificación autocontenida; este arnés impide que la autoridad se
// traslade al navegador o que Punto Cero absorba la selección.
import fs from 'fs';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' · ' + detail : ''}`);
  ok ? pass++ : fail++;
};
const read = path => fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
const migration = read('supabase/migrations/20260817014900_pos_h113_selective_cleanup.sql');
const verification = read('supabase/migrations/20260817015000_pos_h113_selective_cleanup_verification.sql');
const store = read('balam/store.jsx');
const data = read('balam/data.jsx');
const settings = read('balam/settings.jsx');

check('migración aditiva H-113 presente', !!migration);
check('verificación autocontenida posterior presente', !!verification);
check('Punto Cero conserva su RPC separada',
  /function pos\.execute_point_zero\s*\(/.test(read('supabase/migrations/20260812013900_pos_h98_point_zero.sql'))
  && !/create or replace function pos\.execute_point_zero/.test(migration));
check('preview selectivo normaliza en PostgreSQL',
  /function pos\.preview_test_data_cleanup\s*\(/.test(migration)
  && /selection_normalized/.test(migration) && /forced_dependencies/.test(migration));
check('plan sella hash, época y protocolo',
  /plan_hash/.test(migration) && /data_epoch/.test(migration) && /protocol_version/.test(migration));
check('preview declara ejecutabilidad y razones',
  /executable/.test(migration) && /blocked_reasons/.test(migration));
check('V2 de cambios consume products.id exacto',
  /exchange_items[\s\S]*product_id/.test(migration));
check('la identidad moderna ausente bloquea',
  /missing_product_id|identity_missing/.test(migration));
check('stock negativo bloquea y nunca se recorta',
  /negative_stock/.test(migration) && !/greatest\s*\(\s*0\s*,/.test(migration));
check('reclasificaciones tienen reversa exacta',
  /reference_reclassifications/.test(migration)
  && /source_product_id/.test(migration) && /target_product_id/.test(migration));
check('folios se conservan en selectiva',
  !/delete from pos\.folio_counters/.test(migration));
check('clientes son opt-in y protegen referencias vivas',
  /customers/.test(migration) && /customer_referenced/.test(migration));
check('backup selectivo liga plan y selección',
  /function pos\.create_test_data_cleanup_backup\s*\(/.test(migration)
  && /selection_normalized/.test(migration));
check('backup cubre cada autoridad que execute elimina',
  ['physical_card_redemptions','sale_commits','return_commits','exchange_commits',
    'layaway_liquidation_commits','stock_reservations','movements']
    .every(name => new RegExp(`'${name}'`).test(migration)));
check('ejecución es autoridad separada',
  /function pos\.execute_test_data_cleanup\s*\(/.test(migration));
check('ejecución tiene lock, idempotencia y preview vigente',
  /pg_advisory_xact_lock/.test(migration) && /idempotent/.test(migration)
  && /cleanup_preview_changed/.test(migration));
check('producción y roles quedan bloqueados en servidor',
  /cleanup_production_locked/.test(migration) && /is_active_admin/.test(migration)
  && /settings\.manage/.test(migration));
check('evento selectivo no reutiliza test_data_purge_state',
  /selective_cleanup_events/.test(migration)
  && !/create or replace function pos\.test_data_purge_state/.test(migration));
check('cliente antiguo falla cerrado',
  /minimum_client_protocol/.test(migration) && /must_rebootstrap/.test(migration));
check('terminal registrada anterior a H-113 bloquea el plan',
  /schema_version[\s\S]*20260817014900/.test(migration)
  && /client_schema_incompatible/.test(migration));
check('tombstones y auditoría se conservan',
  /purged_documents/.test(migration) && /test_data_purges/.test(migration)
  && !/delete from pos\.(purged_documents|test_data_purges|capability_operation_audit)/.test(migration));
check('préstamos usan el kind exacto del trigger antirresurrección',
  /select 'loan',x,p_cleanup_id/.test(migration)
  && !/select 'loanOperation',x,p_cleanup_id/.test(migration));
check('saldo valida y suma sólo evidencia financiera retenida',
  /if not v_returns and exists/.test(migration)
  && /if not v_sales and exists/.test(migration)
  && /jsonb_array_elements\(a\.detalle\)/.test(migration)
  && /coalesce\(l\.tipo,'liquidacion'\)<>'ajuste'/.test(migration));
check('verificación cubre V1, V2 y SKU duplicado',
  /record_model='v1'/.test(verification) && /record_model='v2'/.test(verification)
  && /duplicate_sku/.test(verification));
check('verificación cubre rollback, idempotencia y roles',
  /rollback/i.test(verification) && /idempotent/.test(verification)
  && /production/.test(verification) && /seller/.test(verification));
check('STORE orquesta las tres RPC selectivas',
  /previewTestDataCleanup/.test(store) && /createTestDataCleanupBackup/.test(store)
  && /executeTestDataCleanup/.test(store));
check('cola selectiva se poda por identidad',
  /pruneQueueForSelectiveCleanup/.test(store) && /operationId|operation_id/.test(store));
check('DATA aplica alcance selectivo sin borrar productos',
  /applySelectiveCleanup/.test(data));
check('DATA incorpora ajustes retenidos sin restar su fila espejo',
  /commissionAdjustments[\s\S]*row\.ajustes/.test(data)
  && /l\.tipo !== 'ajuste'/.test(data));
check('UI ofrece presets y grupos semánticos',
  /cleanup-preset-operations/.test(settings) && /cleanup-group-sales/.test(settings)
  && /cleanup-group-returns/.test(settings) && /cleanup-group-exchanges/.test(settings));
check('UI muestra stock actual y objetivo',
  /Stock actual/.test(settings) && /Stock después/.test(settings));
check('UI no expone tablas como checks',
  !/data-testid=['"]cleanup-group-(sale-items|return-items|exchange-items|commits)/.test(settings));
check('confirmación selectiva conserva cinco puertas',
  /Crear respaldo/.test(settings) && /LIMPIAR OPERACIONES/.test(settings)
  && /comprobante/.test(settings));
check('éxito remoto y convergencia local se informan por separado',
  /remoteCommitted: true/.test(store) && /rebootstrapRequired/.test(store)
  && /LIMPIEZA COMPLETADA EN EL SERVIDOR/.test(settings));
check('modal y frase de confirmación tienen nombre accesible',
  /testId: 'selective-cleanup-dialog'/.test(settings)
  && /htmlFor: 'selective-cleanup-confirmation-input'/.test(settings));

console.log(`\nH-113 contrato: ${pass} pasaron, ${fail} fallaron`);
if (fail) process.exit(1);
