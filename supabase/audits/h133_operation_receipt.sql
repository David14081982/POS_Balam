select operation_id,backup_id,manifest_hash,status,data_epoch_before,data_epoch_after,result,created_at
from pos.inventory_v3_operations
where operation_id='42c03d11-9463-59d3-aecf-822d0bb6444a';
