-- H166: admit the reviewed online client without widening business authority.
begin;
do $definition$
declare definition text; previous text;
begin
 definition:=pg_get_functiondef('pos.online_adoption_report(text,jsonb)'::regprocedure);
 previous:=$previous$  or d.client_build is distinct from '2026-09-12-h164-online'
  or h->>'x-balam-client-build' is distinct from '2026-09-12-h164-online'$previous$;
 if (length(definition)-length(replace(definition,previous,'')))/length(previous)<>1 then
  raise exception 'H166_ADOPTION_SOURCE_DRIFT';
 end if;
 definition:=replace(definition,previous,$replacement$  or coalesce(d.client_build,'') not in ('2026-09-12-h164-online','2026-09-12-h166-online')
  or h->>'x-balam-client-build' is distinct from d.client_build$replacement$);
 execute definition;
end $definition$;
notify pgrst,'reload schema';
commit;
