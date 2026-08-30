select pos.certify_inventory_v3() as certification;

select operation_id,backup_id,manifest_hash,status,data_epoch_before,data_epoch_after,result,created_at
from pos.inventory_v3_operations
where operation_id='42c03d11-9463-59d3-aecf-822d0bb6444a';

select backup_id,operation_id,manifest_hash,payload_hash,verified_restorable,
  payload_hash=pos.h133_payload_hash(payload) as hash_verified,created_at,restored_at
from pos.inventory_v3_backups
where operation_id='42c03d11-9463-59d3-aecf-822d0bb6444a';
