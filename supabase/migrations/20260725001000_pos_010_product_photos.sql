-- pos_010_product_photos.sql — Bucket de FOTOS DE PRODUCTO en Storage.
-- Las fotos dejan de viajar incrustadas (base64) dentro de pos.products.imagen:
-- se suben una vez a este bucket y el producto guarda solo su URL pública.
-- Mismo modelo que el bucket 'barcodes': lectura pública, escritura autenticada.
-- Seguro de re-correr (no duplica nada).

insert into storage.buckets (id, name, public)
values ('product-photos', 'product-photos', true)
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'product_photos_auth_write') then
    create policy "product_photos_auth_write" on storage.objects for all to authenticated
      using (bucket_id = 'product-photos') with check (bucket_id = 'product-photos');
  end if;
end $$;
