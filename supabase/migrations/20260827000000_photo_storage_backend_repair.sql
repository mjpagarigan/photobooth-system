-- Forward-only recovery support for photos uploaded during the R2 metadata transition.
-- No object is copied or deleted here; callers must verify storage before invoking the RPC.

create table public.photo_storage_backend_repairs (
  id uuid primary key default extensions.gen_random_uuid(),
  batch_id uuid not null,
  photo_session_id uuid not null references public.photo_sessions (id) on delete restrict,
  owner_user_id uuid not null,
  public_token_hash bytea not null,
  storage_object_path text not null,
  from_backend text not null,
  to_backend text not null,
  content_type text not null,
  byte_size bigint not null,
  content_sha256 bytea not null,
  image_width integer not null,
  image_height integer not null,
  status public.photo_session_status not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  ready_at timestamptz not null,
  expires_at timestamptz not null,
  source text not null,
  repaired_at timestamptz not null default statement_timestamp(),
  rollback_state text not null default 'not_requested',
  rolled_back_at timestamptz,
  constraint photo_storage_backend_repairs_batch_session_key
    unique (batch_id, photo_session_id),
  constraint photo_storage_backend_repairs_transition
    check (from_backend = 'supabase' and to_backend = 'r2'),
  constraint photo_storage_backend_repairs_hash_lengths
    check (octet_length(public_token_hash) = 32 and octet_length(content_sha256) = 32),
  constraint photo_storage_backend_repairs_source
    check (source ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  constraint photo_storage_backend_repairs_rollback_state
    check (
      (rollback_state = 'not_requested' and rolled_back_at is null)
      or (rollback_state = 'rolled_back' and rolled_back_at is not null)
    )
);

comment on table public.photo_storage_backend_repairs is
  'Service-role-only immutable snapshots for guarded Supabase-to-R2 metadata repairs.';

create index photo_storage_backend_repairs_batch_idx
  on public.photo_storage_backend_repairs (batch_id, repaired_at, photo_session_id);

alter table public.photo_storage_backend_repairs enable row level security;
alter table public.photo_storage_backend_repairs force row level security;

revoke all on public.photo_storage_backend_repairs from public, anon, authenticated;
grant all on public.photo_storage_backend_repairs to service_role;

create function public.repair_photo_storage_backend(
  p_batch_id uuid,
  p_session_id uuid,
  p_expected_storage_object_path text,
  p_expected_byte_size bigint,
  p_expected_content_sha256_hex text,
  p_expected_expires_at timestamptz,
  p_expected_status public.photo_session_status,
  p_expected_storage_backend text,
  p_source text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.photo_storage_backend_repairs%rowtype;
  repaired public.photo_sessions%rowtype;
begin
  if p_expected_content_sha256_hex !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_hash';
  end if;
  if p_source !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
    raise exception using errcode = '22023', message = 'invalid_repair_source';
  end if;

  select ledger.*
  into existing
  from public.photo_storage_backend_repairs as ledger
  where ledger.batch_id = p_batch_id
    and ledger.photo_session_id = p_session_id;

  if found then
    if existing.rollback_state = 'not_requested'
      and exists (
        select 1
        from public.photo_sessions as session
        where session.id = existing.photo_session_id
          and session.storage_backend = existing.to_backend
          and session.owner_user_id = existing.owner_user_id
          and session.public_token_hash = existing.public_token_hash
          and session.storage_object_path = existing.storage_object_path
          and session.content_type = existing.content_type
          and session.byte_size = existing.byte_size
          and session.content_sha256 = existing.content_sha256
          and session.image_width = existing.image_width
          and session.image_height = existing.image_height
          and session.status = existing.status
          and session.created_at = existing.created_at
          and session.updated_at = existing.updated_at
          and session.ready_at = existing.ready_at
          and session.expires_at = existing.expires_at
      ) then
      return 'already_applied';
    end if;
    return 'stale';
  end if;

  if p_expected_status <> 'ready'
    or p_expected_storage_backend <> 'supabase'
    or p_expected_expires_at <= clock_timestamp() then
    return 'stale';
  end if;

  update public.photo_sessions as session
  set storage_backend = 'r2'
  where session.id = p_session_id
    and session.storage_backend = p_expected_storage_backend
    and session.storage_object_path = p_expected_storage_object_path
    and session.byte_size = p_expected_byte_size
    and session.content_sha256 = decode(p_expected_content_sha256_hex, 'hex')
    and session.expires_at = p_expected_expires_at
    and session.status = p_expected_status
    and session.status = 'ready'
    and session.expires_at > clock_timestamp()
  returning session.* into repaired;

  if not found then
    return 'stale';
  end if;

  insert into public.photo_storage_backend_repairs (
    batch_id,
    photo_session_id,
    owner_user_id,
    public_token_hash,
    storage_object_path,
    from_backend,
    to_backend,
    content_type,
    byte_size,
    content_sha256,
    image_width,
    image_height,
    status,
    created_at,
    updated_at,
    ready_at,
    expires_at,
    source
  ) values (
    p_batch_id,
    repaired.id,
    repaired.owner_user_id,
    repaired.public_token_hash,
    repaired.storage_object_path,
    p_expected_storage_backend,
    repaired.storage_backend,
    repaired.content_type,
    repaired.byte_size,
    repaired.content_sha256,
    repaired.image_width,
    repaired.image_height,
    repaired.status,
    repaired.created_at,
    repaired.updated_at,
    repaired.ready_at,
    repaired.expires_at,
    p_source
  );

  return 'updated';
end;
$$;

create function public.rollback_photo_storage_backend_repair(
  p_batch_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rollback_count integer;
begin
  with restored as (
    update public.photo_sessions as session
    set storage_backend = ledger.from_backend
    from public.photo_storage_backend_repairs as ledger
    where ledger.batch_id = p_batch_id
      and ledger.rollback_state = 'not_requested'
      and session.id = ledger.photo_session_id
      and session.storage_backend = ledger.to_backend
      and session.owner_user_id = ledger.owner_user_id
      and session.public_token_hash = ledger.public_token_hash
      and session.storage_object_path = ledger.storage_object_path
      and session.content_type = ledger.content_type
      and session.byte_size = ledger.byte_size
      and session.content_sha256 = ledger.content_sha256
      and session.image_width = ledger.image_width
      and session.image_height = ledger.image_height
      and session.status = ledger.status
      and session.created_at = ledger.created_at
      and session.updated_at = ledger.updated_at
      and session.ready_at = ledger.ready_at
      and session.expires_at = ledger.expires_at
    returning session.id
  ), marked as (
    update public.photo_storage_backend_repairs as ledger
    set
      rollback_state = 'rolled_back',
      rolled_back_at = statement_timestamp()
    from restored
    where ledger.batch_id = p_batch_id
      and ledger.photo_session_id = restored.id
    returning 1
  )
  select count(*)::integer into rollback_count from marked;

  return rollback_count;
end;
$$;

revoke all on function public.repair_photo_storage_backend(
  uuid, uuid, text, bigint, text, timestamptz, public.photo_session_status, text, text
) from public, anon, authenticated;
revoke all on function public.rollback_photo_storage_backend_repair(uuid)
  from public, anon, authenticated;

grant execute on function public.repair_photo_storage_backend(
  uuid, uuid, text, bigint, text, timestamptz, public.photo_session_status, text, text
) to service_role;
grant execute on function public.rollback_photo_storage_backend_repair(uuid) to service_role;
