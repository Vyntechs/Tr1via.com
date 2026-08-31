-- Host image decisions are authoritative over late automatic photo work.
-- An untouched generated question has both image fields null. Any host
-- choice, including deliberate no-image (`image_source = 'none'`), closes
-- that window without weakening the generation-attempt fence.

set search_path = pg_catalog, public;

create or replace function public.commit_generation_photo(
  p_category_id uuid,
  p_attempt smallint,
  p_question_id uuid,
  p_image_url text,
  p_image_attribution text,
  p_image_source text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated integer;
begin
  if not public._lock_current_generation_attempt(p_category_id, p_attempt) then
    return jsonb_build_object('applied', false, 'code', 'stale');
  end if;

  update public.questions
  set image_url = p_image_url,
      image_attribution = p_image_attribution,
      image_source = p_image_source
  where id = p_question_id
    and category_id = p_category_id
    and image_url is null
    and image_source is null;
  get diagnostics v_updated = row_count;

  if v_updated = 1 then
    return jsonb_build_object('applied', true, 'code', 'applied');
  end if;

  if exists (
    select 1
    from public.questions
    where id = p_question_id
      and category_id = p_category_id
  ) then
    return jsonb_build_object('applied', false, 'code', 'host_override');
  end if;

  return jsonb_build_object('applied', false, 'code', 'stale');
end;
$$;

revoke all on function public.commit_generation_photo(uuid, smallint, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.commit_generation_photo(uuid, smallint, uuid, text, text, text)
  to service_role;
