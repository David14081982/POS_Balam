-- H164: archive exact legacy bytes without interpreting ordinary strings as numbers.
-- Parsing/classification problems remain reviewable evidence, never business replay.
begin;
set local lock_timeout='10s';

create function pos.online_legacy_scan(p_value jsonb,p_depth integer default 0) returns setof jsonb
language plpgsql immutable set search_path=pg_catalog,pos as $$
declare decoded jsonb; child jsonb; raw text;
begin
 if p_depth>32 then
  return next jsonb_build_object('kind','issue','code','LEGACY_NESTING_LIMIT'); return;
 end if;
 if jsonb_typeof(p_value)='string' then
  raw:=ltrim(p_value#>>'{}',E' \t\r\n');
  -- Scalars cannot contain commands. UUID/SKU strings beginning with 1e...
  -- must never enter PostgreSQL's numeric JSON parser.
  if left(raw,1) not in('{','[','"') then return; end if;
  begin decoded:=raw::jsonb;
  exception
   when invalid_text_representation then
    return next jsonb_build_object('kind','issue','code','LEGACY_INVALID_JSON_CONTAINER'); return;
   when numeric_value_out_of_range then
    return next jsonb_build_object('kind','issue','code','LEGACY_JSON_NUMBER_OUT_OF_RANGE'); return;
   when untranslatable_character then
    return next jsonb_build_object('kind','issue','code','LEGACY_JSON_UNSUPPORTED_UNICODE'); return;
  end;
  return query select * from pos.online_legacy_scan(decoded,p_depth+1);
 elsif jsonb_typeof(p_value)='array' then
  for child in select value from jsonb_array_elements(p_value) loop
   return query select * from pos.online_legacy_scan(child,p_depth+1);
  end loop;
 elsif jsonb_typeof(p_value)='object' then
  if p_value->>'type' in('upsert','profileUpdate','staffUpdate','delete','softDelete','productDeleteScope','config','sale','return','exchange','loanOperation','referenceReclassification','commissionSettle','commissionClose','commissionAdjustment') then
   if nullif(coalesce(p_value->>'id',p_value->>'operationId'),'') is not null then
    return next jsonb_build_object('kind','intent','value',p_value); return;
   end if;
   return next jsonb_build_object('kind','issue','code','LEGACY_OPERATION_ID_MISSING');
  end if;
  for child in select value from jsonb_each(p_value) loop
   return query select * from pos.online_legacy_scan(child,p_depth+1);
  end loop;
 end if;
end $$;
revoke all on function pos.online_legacy_scan(jsonb,integer) from public,anon,authenticated;

create or replace function pos.online_legacy_intents(p_value jsonb,p_depth integer default 0) returns setof jsonb
language sql immutable set search_path=pg_catalog,pos as $$
 select scanned->'value' from pos.online_legacy_scan(p_value,p_depth) scanned where scanned->>'kind'='intent';
$$;
revoke all on function pos.online_legacy_intents(jsonb,integer) from public,anon,authenticated;

do $safe_classification$
declare f text; marker text; replacement text;
begin
 f:=pg_get_functiondef('pos.classify_online_legacy(text,jsonb)'::regprocedure);
 marker:=' case p_op->>''type''';
 if (length(f)-length(replace(f,marker,'')))/length(marker)<>1 then raise exception 'H164_CLASSIFIER_START_DRIFT'; end if;
 f:=replace(f,marker,E' begin\n'||marker);
 marker:=' end case;';
 replacement:=marker||$body$
 exception when invalid_text_representation or numeric_value_out_of_range then
  -- A malformed version/boolean cannot prove an immutable receipt match.
  -- Preserve this exact real intent; no authentication or SQL errors are caught.
  return jsonb_build_object('status','needs_review','evidence',jsonb_build_object('h164ClassificationIssue',SQLSTATE));
 end;
$body$;
 if (length(f)-length(replace(f,marker,'')))/length(marker)<>1 then raise exception 'H164_CLASSIFIER_END_DRIFT'; end if;
 execute replace(f,marker,replacement);

 f:=pg_get_functiondef('pos.online_legacy_technical_kind(text,text,jsonb)'::regprocedure);
 marker:=' begin decoded:=raw::jsonb; exception when invalid_text_representation then return null; end;';
 replacement:=E' if left(ltrim(raw,E'' \\t\\r\\n''),1) not in(''{'',''['') then return null; end if;\n'
  ||' begin decoded:=raw::jsonb; exception when invalid_text_representation or numeric_value_out_of_range or untranslatable_character then return null; end;';
 if (length(f)-length(replace(f,marker,'')))/length(marker)<>1 then raise exception 'H164_TECHNICAL_PARSER_DRIFT'; end if;
 execute replace(f,marker,replacement);
end $safe_classification$;

do $intake$
declare f text; marker text; replacement text;
begin
 f:=pg_get_functiondef('pos.archive_online_legacy(text,jsonb)'::regprocedure);
 marker:='operation_count integer;';
 if (length(f)-length(replace(f,marker,'')))/length(marker)<>1 then raise exception 'H164_ARCHIVE_DECLARATION_DRIFT'; end if;
 f:=replace(f,marker,marker||' scan_results jsonb; scan_issues jsonb;');
 marker:='  insert into pos.online_legacy_archives(';
 replacement:=$body$  select coalesce(jsonb_agg(scanned),'[]') into scan_results from pos.online_legacy_scan(e->'original') scanned;
  select coalesce(jsonb_agg(distinct scanned->>'code'),'[]') into scan_issues
   from jsonb_array_elements(scan_results) scanned where scanned->>'kind'='issue';
  if jsonb_array_length(scan_issues)>0 then
   ev:=coalesce(ev,'{}')||jsonb_build_object('h164ScanIssues',scan_issues);
   cls:='needs_review';
  end if;
$body$||marker;
 if (length(f)-length(replace(f,marker,'')))/length(marker)<>1 then raise exception 'H164_ARCHIVE_INSERT_DRIFT'; end if;
 f:=replace(f,marker,replacement);
 marker:='  operation_count:=0;';
 replacement:=$body$  if jsonb_array_length(scan_issues)>0 then
   update pos.online_legacy_archives set classification='needs_review',evidence=coalesce(evidence,'{}')||jsonb_build_object('h164ScanIssues',scan_issues)
    where actor_id=existing.actor_id and device_id=existing.device_id and source_key=existing.source_key and source_hash=existing.source_hash
    returning * into existing;
  end if;
$body$||marker;
 if (length(f)-length(replace(f,marker,'')))/length(marker)<>1 then raise exception 'H164_ARCHIVE_COUNT_DRIFT'; end if;
 f:=replace(f,marker,replacement);
 marker:='for op in select * from pos.online_legacy_intents(e->''original'') loop';
 replacement:='for op in select scanned->''value'' from jsonb_array_elements(scan_results) scanned where scanned->>''kind''=''intent'' loop';
 if (length(f)-length(replace(f,marker,'')))/length(marker)<>1 then raise exception 'H164_ARCHIVE_WALKER_DRIFT'; end if;
 execute replace(f,marker,replacement);

 f:=pg_get_functiondef('pos.online_legacy_review_count()'::regprocedure);
 marker:='and not exists(select 1 from pos.online_legacy_intents(a.original))';
 replacement:='and (jsonb_array_length(coalesce(a.evidence->''h164ScanIssues'',''[]''))>0 or not exists(select 1 from pos.online_legacy_intents(a.original)))';
 if (length(f)-length(replace(f,marker,'')))/length(marker)<>1 then raise exception 'H164_LEGACY_REVIEW_DRIFT'; end if;
 execute replace(f,marker,replacement);
end $intake$;
notify pgrst,'reload schema';
commit;
