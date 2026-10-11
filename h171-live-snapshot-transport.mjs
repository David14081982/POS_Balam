// H186 private snapshot transport only. Decoding never connects to BALAM.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const ROW_BODY_TRANSPORT=Object.freeze({format:'balam-pgp-row-bodies-v1',threshold_bytes:64*1024});
const MAX_DECODED_BYTES=512*1024*1024;
const envelopeKeys=['ciphertextBase64','md5','sha256','utf8Bytes'];
const requireValue=(ok,code)=>{if(!ok)throw Error(code);};
const digest=(algorithm,text)=>createHash(algorithm).update(text,'utf8').digest('hex');

export async function decodePrivateSnapshotBodies({input,passphrase,catalog,sourceUrl,projectRef}){
  requireValue(typeof passphrase==='string'&&/^[A-Za-z0-9_-]{43}$/.test(passphrase),'SNAPSHOT_TRANSPORT_PASSPHRASE_REQUIRED');
  requireValue(input?.format==='balam-canonical-snapshot-v1'&&input.expected_project_ref===projectRef&&input.source_url===sourceUrl,
    'SNAPSHOT_TRANSPORT_BINDING_MISMATCH');
  assert.deepEqual(input.row_body_transport,ROW_BODY_TRANSPORT,'SNAPSHOT_TRANSPORT_FORMAT_MISMATCH');
  requireValue(Array.isArray(input.tables)&&input.tables.length===catalog.length,'SNAPSHOT_TRANSPORT_TABLES_INCOMPLETE');
  assert.deepEqual(input.tables.map(t=>t.table),catalog.map(t=>t.table).sort(),'SNAPSHOT_TRANSPORT_TABLE_ORDER_MISMATCH');
  const snapshot=structuredClone(input);let db,totalBytes=0,encryptedBodies=0;
  try{
    for(const table of snapshot.tables){
      requireValue(Array.isArray(table.rows)&&table.rows.length===table.row_count,'SNAPSHOT_TRANSPORT_ROWS_INCOMPLETE');
      for(const row of table.rows)for(const [field,hashField] of [['row_json_text','projected_row_md5'],['restorable_row_json_text','full_row_md5']]){
        const value=row[field];
        if(value===null)continue; // Exact baseline-body reuse and non-restorable sensitive rows stay NULL.
        if(typeof value==='string'){
          const bytes=Buffer.byteLength(value,'utf8');
          requireValue(bytes<=ROW_BODY_TRANSPORT.threshold_bytes,'SNAPSHOT_TRANSPORT_LARGE_BODY_UNENCODED');
          totalBytes+=bytes;requireValue(totalBytes<=MAX_DECODED_BYTES,'SNAPSHOT_TRANSPORT_TOTAL_LIMIT');continue;
        }
        requireValue(value&&typeof value==='object'&&!Array.isArray(value),'SNAPSHOT_TRANSPORT_BODY_INVALID');
        assert.deepEqual(Object.keys(value).sort(),envelopeKeys,'SNAPSHOT_TRANSPORT_ENVELOPE_FIELDS_INVALID');
        requireValue(Number.isSafeInteger(value.utf8Bytes)&&value.utf8Bytes>ROW_BODY_TRANSPORT.threshold_bytes&&value.utf8Bytes<=MAX_DECODED_BYTES,
          'SNAPSHOT_TRANSPORT_LENGTH_INVALID');
        totalBytes+=value.utf8Bytes;requireValue(totalBytes<=MAX_DECODED_BYTES,'SNAPSHOT_TRANSPORT_TOTAL_LIMIT');
        requireValue(/^[a-f0-9]{32}$/.test(value.md5)&&value.md5===row[hashField]&&/^[a-f0-9]{64}$/.test(value.sha256),
          'SNAPSHOT_TRANSPORT_HASH_BINDING_INVALID');
        requireValue(typeof value.ciphertextBase64==='string'&&/^[A-Za-z0-9+/=\r\n]+$/.test(value.ciphertextBase64),
          'SNAPSHOT_TRANSPORT_BASE64_INVALID');
        const normalized=value.ciphertextBase64.replace(/[\r\n]/g,''),ciphertext=Buffer.from(normalized,'base64');
        requireValue(ciphertext.toString('base64')===normalized,'SNAPSHOT_TRANSPORT_BASE64_INVALID');
        if(!db){
          const [{PGlite},{pgcrypto}]=await Promise.all([import('@electric-sql/pglite'),import('@electric-sql/pglite/contrib/pgcrypto')]);
          db=new PGlite({extensions:{pgcrypto}});
          await db.exec('CREATE SCHEMA extensions;CREATE EXTENSION pgcrypto WITH SCHEMA extensions;');
        }
        let plaintext;
        try{plaintext=(await db.query('SELECT extensions.pgp_sym_decrypt($1::bytea,$2::text) body',[ciphertext,passphrase])).rows[0]?.body;}
        catch{throw Error('SNAPSHOT_TRANSPORT_DECRYPT_FAILED');} // Never expose query parameters/passphrases.
        requireValue(typeof plaintext==='string'&&Buffer.byteLength(plaintext,'utf8')===value.utf8Bytes,'SNAPSHOT_TRANSPORT_LENGTH_MISMATCH');
        requireValue(digest('md5',plaintext)===value.md5&&digest('sha256',plaintext)===value.sha256,'SNAPSHOT_TRANSPORT_BODY_HASH_MISMATCH');
        row[field]=plaintext;encryptedBodies++;
      }
    }
    delete snapshot.row_body_transport;
    return {snapshot,evidence:{format:ROW_BODY_TRANSPORT.format,encryptedBodies,decodedBodyBytes:totalBytes,verified:true}};
  }finally{if(db)await db.close();}
}
