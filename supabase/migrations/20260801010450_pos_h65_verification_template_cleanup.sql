-- H-65: elimina solamente la plantilla tecnica creada por 10150.
-- En produccion, donde 10150 fue no-op, esta migracion tambien es no-op.

begin;

do $$
declare
  v_deleted integer := 0;
begin
  if exists (
    select 1 from pos.products
     where id = '__h65_verification_template__'
       and (
         sku is distinct from '__H65_VERIFICATION_TEMPLATE__'
         or cat is distinct from '__H65_VERIFY__'
         or manga is distinct from '__H65_VERIFY__'
         or tela is distinct from '__H65_VERIFY__'
         or color is distinct from '__H65_VERIFY__'
         or modelo is distinct from '__H65_VERIFY__'
         or nombre is distinct from 'Plantilla tecnica H65'
         or sync_device_id is distinct from 'migration:h65-verification-template'
         or deleted_at is not null
       )
  ) then
    raise exception 'H65_VERIFICATION_TEMPLATE_CLEANUP_IDENTITY_MISMATCH';
  end if;

  delete from pos.products
   where id = '__h65_verification_template__'
     and sku = '__H65_VERIFICATION_TEMPLATE__'
     and cat = '__H65_VERIFY__'
     and manga = '__H65_VERIFY__'
     and tela = '__H65_VERIFY__'
     and color = '__H65_VERIFY__'
     and modelo = '__H65_VERIFY__'
     and nombre = 'Plantilla tecnica H65'
     and sync_device_id = 'migration:h65-verification-template'
     and deleted_at is null;
  get diagnostics v_deleted = row_count;

  if v_deleted > 1
     or exists (
       select 1 from pos.products
        where id = '__h65_verification_template__'
     ) then
    raise exception 'H65_VERIFICATION_TEMPLATE_CLEANUP_FAILED: %', v_deleted;
  end if;
end;
$$;

commit;
