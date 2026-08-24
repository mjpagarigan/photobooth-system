-- Qualify the session lookup so PostgreSQL does not confuse table columns with RETURNS TABLE
-- output variables such as `id` and `storage_object_path`.

create or replace function public.resume_or_reopen_photo_session(
  p_session_id uuid,
  p_owner_user_id uuid
)
returns table (
  id uuid,
  storage_object_path text,
  reopened boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.photo_sessions%rowtype;
begin
  select session.*
  into target
  from public.photo_sessions as session
  where session.id = p_session_id
    and session.owner_user_id = p_owner_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'photo_session_not_found';
  end if;

  if target.status = 'pending' then
    update public.photo_sessions
    set updated_at = statement_timestamp()
    where photo_sessions.id = target.id;
    return query select
      target.id,
      target.storage_object_path,
      target.updated_at <= clock_timestamp() - interval '24 hours';
    return;
  end if;

  if target.status = 'deleted'
    and target.ready_at is null
    and target.expires_at is null then
    return query
    update public.photo_sessions
    set
      status = 'pending',
      delivery_generation = target.delivery_generation + 1,
      updated_at = statement_timestamp(),
      deleted_at = null,
      cleanup_lease_id = null,
      cleanup_lease_until = null
    where photo_sessions.id = target.id
    returning photo_sessions.id, photo_sessions.storage_object_path, true;
    return;
  end if;

  raise exception using errcode = 'P0001', message = 'photo_session_not_resumable';
end;
$$;
