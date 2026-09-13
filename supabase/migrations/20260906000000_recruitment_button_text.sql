alter table public.photo_sessions
  add column recruitment_button_text text not null default 'Join a ministry';

alter table public.photo_sessions
  add constraint photo_sessions_recruitment_button_text
  check (
    recruitment_button_text = btrim(recruitment_button_text)
    and char_length(recruitment_button_text) between 1 and 80
    and recruitment_button_text !~ '[\r\n]'
  );

drop function if exists public.create_or_get_photo_session(
  uuid, uuid, uuid, text, text, text, text, bigint, text, integer, integer, text
);

create function public.create_or_get_photo_session(
  p_candidate_id uuid,
  p_owner_user_id uuid,
  p_client_session_id uuid,
  p_public_token_hash_hex text,
  p_storage_object_path text,
  p_storage_backend text,
  p_content_type text,
  p_byte_size bigint,
  p_content_sha256_hex text,
  p_image_width integer,
  p_image_height integer,
  p_google_forms_url text,
  p_recruitment_button_text text default 'Join a ministry'
)
returns table (
  id uuid,
  storage_object_path text,
  storage_backend text,
  created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.photo_sessions%rowtype;
  metadata_matches boolean;
begin
  if p_public_token_hash_hex !~ '^[0-9a-f]{64}$'
    or p_content_sha256_hex !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_hash';
  end if;

  if p_storage_backend not in ('supabase', 'r2') then
    raise exception using errcode = '22023', message = 'invalid_storage_backend';
  end if;

  insert into public.photo_sessions (
    id, owner_user_id, client_session_id, public_token_hash, storage_object_path,
    storage_backend, content_type, byte_size, content_sha256, image_width, image_height,
    google_forms_url, recruitment_button_text
  )
  values (
    p_candidate_id, p_owner_user_id, p_client_session_id,
    decode(p_public_token_hash_hex, 'hex'), p_storage_object_path, p_storage_backend,
    p_content_type, p_byte_size, decode(p_content_sha256_hex, 'hex'), p_image_width,
    p_image_height, p_google_forms_url, p_recruitment_button_text
  )
  on conflict (owner_user_id, client_session_id) do nothing;

  select * into target
  from public.photo_sessions
  where owner_user_id = p_owner_user_id and client_session_id = p_client_session_id
  for update;

  if target.id = p_candidate_id then
    return query select target.id, target.storage_object_path, target.storage_backend, true;
    return;
  end if;

  metadata_matches := target.content_type = p_content_type
    and target.byte_size = p_byte_size
    and target.content_sha256 = decode(p_content_sha256_hex, 'hex')
    and target.image_width = p_image_width
    and target.image_height = p_image_height
    and target.google_forms_url is not distinct from p_google_forms_url
    and target.recruitment_button_text = p_recruitment_button_text
    and target.public_token_hash = decode(p_public_token_hash_hex, 'hex');

  if not metadata_matches then
    raise exception using errcode = 'P0001', message = 'photo_session_conflict';
  end if;

  if target.status = 'pending' then
    update public.photo_sessions set updated_at = statement_timestamp()
    where photo_sessions.id = target.id;
    return query select target.id, target.storage_object_path, target.storage_backend, false;
    return;
  end if;

  if target.status = 'deleted' and target.ready_at is null and target.expires_at is null then
    return query
    update public.photo_sessions
    set status = 'pending', delivery_generation = target.delivery_generation + 1,
      updated_at = statement_timestamp(), deleted_at = null, cleanup_lease_id = null,
      cleanup_lease_until = null
    where photo_sessions.id = target.id
    returning photo_sessions.id, photo_sessions.storage_object_path,
      photo_sessions.storage_backend, false;
    return;
  end if;

  raise exception using errcode = 'P0001', message = 'photo_session_conflict';
end;
$$;

drop function if exists public.resolve_photo_session(text);

create function public.resolve_photo_session(p_public_token_hash_hex text)
returns table (
  id uuid,
  storage_object_path text,
  storage_backend text,
  content_type text,
  byte_size bigint,
  google_forms_url text,
  recruitment_button_text text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select photo_sessions.id, photo_sessions.storage_object_path,
    photo_sessions.storage_backend, photo_sessions.content_type, photo_sessions.byte_size,
    photo_sessions.google_forms_url, photo_sessions.recruitment_button_text,
    photo_sessions.expires_at
  from public.photo_sessions
  where p_public_token_hash_hex ~ '^[0-9a-f]{64}$'
    and photo_sessions.public_token_hash = decode(p_public_token_hash_hex, 'hex')
    and photo_sessions.status = 'ready'
    and photo_sessions.expires_at > clock_timestamp()
  limit 1;
$$;

revoke all on function public.create_or_get_photo_session(
  uuid, uuid, uuid, text, text, text, text, bigint, text, integer, integer, text, text
) from public, anon, authenticated;
revoke all on function public.resolve_photo_session(text) from public, anon, authenticated;

grant execute on function public.create_or_get_photo_session(
  uuid, uuid, uuid, text, text, text, text, bigint, text, integer, integer, text, text
) to service_role;
grant execute on function public.resolve_photo_session(text) to service_role;
