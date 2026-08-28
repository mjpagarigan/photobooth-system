-- Google Photos Shared Album Live Sync
-- Stores OAuth configuration, target album details, and an asynchronous sync queue.

create table if not exists public.google_photos_config (
  id integer primary key default 1 check (id = 1),
  connected_email text,
  album_id text,
  album_title text,
  album_share_url text,
  refresh_token_encrypted text,
  enabled boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);

-- Seed default singleton row if not exists
insert into public.google_photos_config (id, enabled)
values (1, false)
on conflict (id) do nothing;

create table if not exists public.google_sync_queue (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.photo_sessions(id) on delete cascade,
  storage_object_path text not null,
  storage_backend text not null default 'r2',
  status text not null default 'pending',
  attempt_count integer not null default 0,
  google_media_id text,
  error_message text,
  leased_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  next_attempt_at timestamptz not null default clock_timestamp(),
  constraint google_sync_queue_status check (status in ('pending', 'syncing', 'synced', 'failed'))
);

create index if not exists google_sync_queue_pending_idx
  on public.google_sync_queue (status, next_attempt_at, leased_until)
  where status in ('pending', 'failed');

create index if not exists google_sync_queue_session_idx
  on public.google_sync_queue (session_id);

-- Enqueue function
create or replace function public.enqueue_google_photos_sync(
  p_session_id uuid,
  p_storage_object_path text,
  p_storage_backend text default 'r2'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_enabled boolean;
  v_album_id text;
begin
  select enabled, album_id
  into v_enabled, v_album_id
  from public.google_photos_config
  where id = 1;

  if v_enabled is not true or v_album_id is null or length(trim(v_album_id)) = 0 then
    return null;
  end if;

  insert into public.google_sync_queue (
    session_id,
    storage_object_path,
    storage_backend,
    status
  )
  values (
    p_session_id,
    p_storage_object_path,
    coalesce(p_storage_backend, 'r2'),
    'pending'
  )
  returning id into v_job_id;

  return v_job_id;
end;
$$;

-- Lease batch of jobs
create or replace function public.claim_google_photos_sync(
  p_batch_size integer default 5,
  p_lease_seconds integer default 60
)
returns table (
  id uuid,
  session_id uuid,
  storage_object_path text,
  storage_backend text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_lease_until timestamptz := v_now + make_interval(secs => p_lease_seconds);
begin
  return query
  with candidate as (
    select q.id as queue_id
    from public.google_sync_queue q
    where (
      (q.status = 'pending' and q.next_attempt_at <= v_now and (q.leased_until is null or q.leased_until < v_now))
      or (q.status = 'syncing' and q.leased_until < v_now)
      or (q.status = 'failed' and q.attempt_count < 10 and q.next_attempt_at <= v_now and (q.leased_until is null or q.leased_until < v_now))
    )
    order by q.created_at asc
    limit p_batch_size
    for update skip locked
  )
  update public.google_sync_queue u
  set
    status = 'syncing',
    attempt_count = u.attempt_count + 1,
    leased_until = v_lease_until,
    updated_at = v_now
  from candidate
  where u.id = candidate.queue_id
  returning
    u.id,
    u.session_id,
    u.storage_object_path,
    u.storage_backend,
    u.attempt_count;
end;
$$;

-- Complete job
create or replace function public.complete_google_photos_sync(
  p_job_id uuid,
  p_google_media_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.google_sync_queue
  set
    status = 'synced',
    google_media_id = p_google_media_id,
    leased_until = null,
    error_message = null,
    updated_at = clock_timestamp()
  where id = p_job_id;
end;
$$;

-- Fail job with exponential backoff
create or replace function public.fail_google_photos_sync(
  p_job_id uuid,
  p_error_message text,
  p_backoff_seconds integer default 15
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  update public.google_sync_queue
  set
    status = 'failed',
    error_message = p_error_message,
    leased_until = null,
    next_attempt_at = v_now + make_interval(secs => p_backoff_seconds),
    updated_at = v_now
  where id = p_job_id;
end;
$$;

-- Get sync stats
create or replace function public.get_google_photos_sync_stats()
returns table (
  synced_count bigint,
  pending_count bigint,
  failed_count bigint,
  last_synced_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select
    count(*) filter (where status = 'synced') as synced_count,
    count(*) filter (where status in ('pending', 'syncing')) as pending_count,
    count(*) filter (where status = 'failed' and attempt_count >= 10) as failed_count,
    max(updated_at) filter (where status = 'synced') as last_synced_at
  from public.google_sync_queue;
end;
$$;

-- Trigger to auto-enqueue on session finalization
create or replace function public.trig_photo_session_ready_google_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (TG_OP = 'UPDATE' and OLD.status <> 'ready' and NEW.status = 'ready')
     or (TG_OP = 'INSERT' and NEW.status = 'ready') then
    perform public.enqueue_google_photos_sync(NEW.id, NEW.storage_object_path, NEW.storage_backend);
  end if;
  return NEW;
end;
$$;

drop trigger if exists photo_session_google_sync_trigger on public.photo_sessions;
create trigger photo_session_google_sync_trigger
  after insert or update of status on public.photo_sessions
  for each row
  execute function public.trig_photo_session_ready_google_sync();
