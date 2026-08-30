select
  count(*) filter(where deleted_at is not null and record_model='v2') as deleted_v2,
  count(*) filter(where deleted_at is not null and record_model='v1') as deleted_v1
from pos.products;
