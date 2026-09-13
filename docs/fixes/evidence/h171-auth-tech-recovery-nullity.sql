-- H171 BALAM ONLY: two exact recoveries, token NULL boolean only.
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
WITH targets(device_id) AS (VALUES ('qa-h148-b766e373-5279-4e4a-818e-0934a4f8757c-B'),('qa-h148-b766e373-5279-4e4a-818e-0934a4f8757c-C'))
SELECT jsonb_build_object('audit','H171 recovery omitted credential nullity','project_ref','telohdbvbvsfmwyriflz',
 'at',clock_timestamp(),'read_only',current_setting('transaction_read_only'),'expected_rows',2,
 'rows',(SELECT jsonb_agg(jsonb_build_object('device_id',r.device_id,'write_token_is_null',r.write_token IS NULL) ORDER BY r.device_id)
 FROM targets t JOIN pos.sync_device_recoveries r USING(device_id)),
 'limit','No token value, hash, length or prefix is returned; non-null remains excluded from a restorable retirement proposal.') AS report;
COMMIT;
