// H-65 — contrato preventivo de liquidacion autoritativa de apartados.
//
// `--reproduccion` lee los archivos de HEAD para conservar la prueba roja aun
// cuando el arbol de trabajo ya contenga parte de la correccion. Sin el flag,
// valida la implementacion que se va a publicar.
import fs from 'fs';
import { execFileSync } from 'child_process';

const HEAD = process.argv.includes('--reproduccion');
const H65_BASELINE = '9c3231cffe5744c1bbe38f1421ad38d7af8c5239';
const read = file => {
  if (!HEAD) return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  try { return execFileSync('git', ['show', `${H65_BASELINE}:${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (_) { return ''; }
};

const data = read('balam/data.jsx');
const store = read('balam/store.jsx');
const ui = read('balam/layaway.jsx');
const migration = read('supabase/migrations/20260801010100_pos_h65_atomic_layaway_liquidation.sql');
const verification = read('supabase/migrations/20260801010200_pos_h65_atomic_layaway_liquidation_verification.sql');
const app = read('balam/app.jsx');
const reservations = read('supabase/migrations/20260801010300_pos_h65_legacy_reservation_lines.sql');
const reservationsVerification = read('supabase/migrations/20260801010400_pos_h65_legacy_reservation_lines_verification.sql');

let pass = 0, fail = 0;
const check = (name, condition) => {
  console.log(`${condition ? '✅' : '❌'} ${name}`);
  condition ? pass++ : fail++;
};

// Guardas que ya eran correctas antes de H-65.
check('la venta conserva un operationId estable', /_operationId:\s*operationId/.test(data));
check('los renglones nuevos conservan productId', /productId:\s*l\.p\.id/.test(data));
check('la cola persiste antes de intentar la red', /enqueue\(op\)[\s\S]{0,180}backupChain/.test(store));
check('la reserva SQL existente es idempotente por operation_id', /reserve_sale_stock/.test(read('supabase/migrations/20260725001700_pos_atomic_stock_reservation.sql')));

// Reproduccion del defecto: todos estos contratos faltan en HEAD.
check('un Apartado traido de nube declara que no requiere reserva en un abono',
  /_stockRequired:[^,\n]+Apartado[^,\n]+Cancelado/.test(store));
check('la confirmacion de stock se deriva exclusivamente de stock_reserved',
  /_stockReserved:\s*r\.stock_reserved\s*===\s*true/.test(store)
  && !/stockReserved:\s*!!op\.reserveStock/.test(store));
check('pushSale reserva solo ante _stockRequired explicitamente true',
  /reserveStock:\s*sale\._stockRequired\s*===\s*true/.test(store));
check('finalizarApartado resuelve productId antes que el SKU historico',
  /function resolveLayawayProduct[\s\S]{0,300}(?:line\.productId|line\s*&&\s*line\.productId)[\s\S]{0,900}matches/i.test(data)
  && /function finalizarApartado[\s\S]{0,500}resolveLayawayProduct\(line\)/.test(data));
check('el fallback por SKU ambiguo bloquea en vez de elegir find()',
  /(?:PRODUCT_ID_AMBIGUOUS|PRODUCT_SKU_AMBIGUOUS|SKU_AMBIGUO|SKU ambiguo)/i.test(data + store));
check('la liquidacion no persiste saveProducts(false) antes del servidor',
  !/function finalizarApartado[\s\S]{0,2400}saveProducts\(false\)/.test(data));
check('DATA delega la liquidacion en una costura remota dedicada',
  /invokeSync\(['"]settleLayaway['"]/.test(data));
check('STORE encola una sola liquidacion durable por folio',
  /function settleLayaway/.test(store) && /layaway_liquidation/.test(store));
check('la RPC atomica deriva y confirma la liquidacion',
  /function pos\.commit_layaway_liquidation_checked/i.test(migration)
  && /pos\.commit_sale\s*\(/i.test(migration));
check('la respuesta remota explicita reserva e idempotencia de stock',
  /stock_reserved/.test(migration) && /stock_idempotent/.test(migration)
  && /reservation_operation_id/.test(migration));
check('la respuesta atomica devuelve venta, pago, movimiento y productos',
  /'sale'/.test(migration) && /'payments'/.test(migration)
  && /'movements'/.test(migration) && /'products'/.test(migration));
check('la liquidacion tiene ledger idempotente y auditable propio',
  /layaway_liquidation_commits/.test(migration) && /payload_hash/.test(migration));
check('la aplicacion local usa una unica respuesta autoritativa',
  /function applySaleCommitResult/.test(data) && /applySaleCommitResult/.test(store));
check('una falla de cache bloquea ventas hasta resincronizar catalogo',
  /catalogResyncRequired/.test(data) && /requiere resincronizaci[oó]n/i.test(data));
check('la cache usa journal previo, rollback dirigido y verificacion antes de retirar la cola',
  /LS_SALE_COMMIT_JOURNAL/.test(data) && /restoreSaleCommitJournal/.test(data)
  && /journal_not_cleared/.test(data));
check('el producto queda bloqueado mientras la liquidacion esta pendiente',
  /acquireLayawayProductLock/.test(data) && /assertLayawayProductsUnlocked/.test(data)
  && /reconcileLayawayProductLocks/.test(store));
// H-68 cambio la firma: resetTestData ahora devuelve un informe y reserva `false`
// EXCLUSIVAMENTE para el lock de liquidacion pendiente. La garantia es la misma:
// ninguna limpieza —manual, propagada por epoca o por marca— avanza con un lock.
check('la limpieza remota no ignora un lock de liquidacion',
  /function localPurgeApplied/.test(store) && /local === false/.test(store)
  && /if \(!localPurgeApplied\(\)\) return false;/.test(store)
  && /if \(!local\) return null;/.test(store));
check('el reintento devuelve el pago autoritativo original',
  /layawayResults/.test(store) && /paymentId/.test(store)
  && /authoritativePaymentId/.test(data));
check('la adopcion historica y la comision viajan en contexto auditable',
  /item_identities/.test(store) && /commission_amount/.test(store)
  && /p_context/.test(migration));
check('los rechazos permanentes no se reintentan automaticamente',
  /operation_mismatch/.test(store) && /seller_effects_mismatch/.test(store)
  && /payment_id_conflict/.test(store));
check('la UI espera confirmacion y no anuncia exito pendiente',
  /async function confirmar/.test(ui) && /await\s+(?:Promise\.resolve\()?D\.registrarPagoApartado/.test(ui)
  && /pendiente/i.test(ui));
check('la migracion lleva verificacion autocontenida e idempotencia',
  /H-65/i.test(verification) && /idempotent/i.test(verification)
  && (/(?:rollback\s*;|cleanup=ok)/i.test(verification)));

// Dos pestanas del mismo navegador comparten localStorage: sin un dueno unico
// de escritura, ambas podrian liquidar el mismo apartado desde memorias
// distintas y la segunda pisaria la respuesta autoritativa de la primera.
check('una sola pestana posee la escritura local y la liquidacion la exige',
  /navigator\.locks/.test(data) && /LOCAL_WRITER_LOCK/.test(data)
  && /function assertLocalWriter/.test(data)
  && /function applySaleCommitResult[\s\S]{0,200}assertLocalWriter\(true\)/.test(data)
  && /hasLocalWriter\(true\)/.test(store)
  && /localwriterchange/.test(app));
check('un navegador sin Web Locks falla cerrado en vez de liquidar a ciegas',
  /LOCAL_WRITER_UNSUPPORTED/.test(data)
  && /localWriterLeaseSupported\s*\?\s*'waiting'\s*:\s*'unsupported'/.test(data));
check('el relevo entre pestanas reconstruye las caches antes de escribir',
  /function rebaseLocalWriterCollections/.test(data)
  && /rebaseLocalWriterCollections\(\)[\s\S]{0,120}CACHE_REBASE_REQUIRED/.test(data));

// Una reserva anterior guardo el JSON tal cual lo recibio. La misma intencion
// escrita en otro orden, o con el par product_id+talla repetido, no puede
// convertirse en un segundo descuento ni en un rechazo falso.
check('una reserva previa equivalente se adopta con su representacion exacta',
  /stock_reservations/.test(reservations)
  && /group by x\.product_id, x\.talla/.test(reservations)
  && /v_stock_lines\s*:=\s*v_prior_reservation\.lines/.test(reservations));
check('una reserva previa con contenido distinto se rechaza como operation_mismatch',
  /'error',\s*'operation_mismatch'/.test(reservations)
  && /reservation_lines_mismatch/.test(reservations)
  && /reservation_folio_mismatch/.test(reservations)
  && /reservation_lines_invalid/.test(reservations));
check('la redefinicion aborta si la funcion desplegada derivo del contrato',
  /pg_get_functiondef/.test(reservations)
  && /H65_LEGACY_RESERVATION_DECLARATION_DRIFT/.test(reservations)
  && /H65_LEGACY_RESERVATION_DERIVATION_DRIFT/.test(reservations)
  && /H65_GENERIC_COMMIT_WRAPPER_DRIFT/.test(reservations));
check('un commit generico tardio no reabre un apartado ya liquidado',
  /layaway_already_liquidated/.test(reservations)
  && /layaway_already_liquidated/.test(store));
check('la verificacion prueba orden equivalente, rechazo y rollback tardio',
  /H65_LEGACY_RESERVATION_ADOPTION_FAILED/.test(reservationsVerification)
  && /H65_RESERVATION_MISMATCH_WROTE_STATE/.test(reservationsVerification)
  && /H65_LEGACY_RESERVATION_LATE_ROLLBACK_FAILED/.test(reservationsVerification));
check('la verificacion demuestra que no movio ni una pieza real',
  /inventory_before/.test(reservationsVerification)
  && /H65_VERIFICATION_MOVED_REAL_INVENTORY/.test(reservationsVerification));

console.log(`\n${pass}/${pass + fail} verificaciones${HEAD ? ' contra HEAD' : ''}`);
process.exit(fail ? 1 : 0);
