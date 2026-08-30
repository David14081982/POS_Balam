// Genera mecánicamente la migración ejecutora desde el manifiesto read-only sellado.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = resolve(process.argv[2] || '.evidence-h132-live/v3-manifest-analysis.json');
const target = resolve(process.argv[3] || 'supabase/migrations/20260830017300_pos_h133_execute_inventory_v3.sql');
const hashTarget = resolve('supabase/audits/h133_manifest_hash.sql');
const analysis = JSON.parse(await readFile(source, 'utf8'));
if (!analysis.manifestHash || analysis.signatureCollisions.length || analysis.barcodeCollisions.length) {
  throw new Error('H133_MANIFEST_NOT_SEALED');
}
// jsonb_to_recordset pliega identificadores SQL no citados a minúsculas. El
// manifiesto usa esas claves canónicas para que una ausencia nunca se confunda
// con un valor NULL durante el preflight.
const sqlKeys = row => Object.fromEntries([
  ...Object.entries(row),
  ...Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]),
]);
const migrated = JSON.stringify(analysis.manifest.map(sqlKeys));
const existing = JSON.stringify(analysis.existingManifest.map(sqlKeys));
const sealedHash = String(process.argv[4] || analysis.serverManifestHash || analysis.manifestHash);
const operationId = '42c03d11-9463-59d3-aecf-822d0bb6444a';
const sql = `-- H-133: ejecución única del manifiesto vivo sellado.
-- manifest_sha256=${sealedHash}
-- analyzer_sha256=${analysis.manifestHash}
-- source_products=${analysis.source.products}; migrated=${analysis.migrated.references}; existing_v2=${analysis.existing.references}
begin;

select pos.h133_execute_inventory_v3(
  '${operationId}'::uuid,
  $h133_migrated$${migrated}$h133_migrated$::jsonb,
  $h133_existing$${existing}$h133_existing$::jsonb,
  '${sealedHash}',
  219,
  ${analysis.migrated.references},
  ${analysis.migrated.pieces},
  ${analysis.existing.references},
  ${analysis.existing.pieces}
);

commit;
`;
await writeFile(target, sql, 'utf8');
await writeFile(hashTarget, `select pos.h133_payload_hash(jsonb_build_object(
  'existing',$h133_existing$${existing}$h133_existing$::jsonb,
  'migrated',$h133_migrated$${migrated}$h133_migrated$::jsonb
)) as server_manifest_hash;\n`, 'utf8');
console.log(JSON.stringify({ target, operationId, manifestHash: sealedHash, analyzerHash: analysis.manifestHash,
  bytes: Buffer.byteLength(sql), migrated: analysis.manifest.length, existing: analysis.existingManifest.length }, null, 2));
