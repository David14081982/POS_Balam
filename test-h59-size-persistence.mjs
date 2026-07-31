import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260731009700_pos_h59_size_category_persistence.sql';
const verificationPath = 'supabase/migrations/20260731009800_pos_h59_size_category_persistence_verification.sql';
const migration = fs.readFileSync(migrationPath, 'utf8');
const verification = fs.readFileSync(verificationPath, 'utf8');

let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`✅ ${name}`);
  } else {
    failed += 1;
    console.error(`❌ ${name}`);
  }
}

check('la migración limita el conjunto a 240 productos',
  /v_expected_count constant integer := 240/.test(migration));
check('la migración fija la huella exacta de los IDs auditados',
  /47fae1aa86a3badec6622ad6b6db2ebb/.test(migration));
check('usa el ID estable size_number y exige que exista en Configuración',
  /v_category_id constant text := 'size_number'/.test(migration)
  && /from pos\.lookup l[\s\S]*l\.kind = v_category_id/.test(migration));
check('la única asignación funcional es attrs.__sizeCategoryId',
  /set attrs = jsonb_set\([\s\S]*'\{__sizeCategoryId\}'/.test(migration)
  && !/set\s+stock\s*=|set\s+sku\s*=|set\s+precio\s*=|set\s+nombre\s*=/i.test(migration));
check('la actualización es idempotente',
  /where p\.attrs ->> '__sizeCategoryId' is distinct from v_category_id/.test(migration));
check('no elimina ni reescribe variantes o valores de talla',
  !/\bdelete\s+from\s+pos\.products\b/i.test(migration)
  && !/jsonb_set\([^;]*\{(?:stock|talla|escala)\}/i.test(migration)
  && !/\bset\s+stock\s*=/i.test(migration));
check('protege todos los campos funcionales y la matriz de stock con huellas',
  /v_products_before_md5/.test(migration)
  && /v_products_after_md5/.test(migration)
  && /v_stock_before_md5/.test(migration)
  && /v_stock_after_md5/.test(migration));
check('protege el historial de movimientos antes y después',
  /v_movements_before_md5/.test(migration)
  && /v_movements_after_md5/.test(migration));
check('BRAULIO, DANTE y VALERIO deben existir y conservar stock cero',
  ['imp-1784582003846-41', 'imp-1784582003845-31', 'imp-1784582003849-56']
    .every(id => migration.includes(id))
  && /ya no tiene stock cero/.test(migration));
check('la verificación posterior exige 240/240 en size_number',
  /where p\.attrs ->> '__sizeCategoryId' = 'size_number'/.test(verification)
  && /v_count <> 240/.test(verification));
check('la verificación posterior exige 237 productos y 3,505 unidades',
  /v_positive_products <> 237 or v_stock_units <> 3505/.test(verification));
check('la verificación posterior demuestra que una repetición modifica cero filas',
  /v_idempotent_candidates <> 0/.test(verification)
  && /repetición=0 cambios/.test(verification));

console.log(`\n════════ ${passed} pasaron, ${failed} fallaron ════════`);
process.exit(failed ? 1 : 0);
