begin;

create extension if not exists pgtap with schema extensions;

select plan(86);

set local timezone = 'America/Denver';

select has_table('public', 'booth_devices', 'booth device allow-list exists');
select has_table('public', 'photo_sessions', 'photo session table exists');
select has_column('public', 'photo_sessions', 'owner_user_id', 'owner is stored');
select has_column('public', 'photo_sessions', 'public_token_hash', 'token hash is stored');
select has_column('public', 'photo_sessions', 'storage_object_path', 'private path is stored');
select has_column('public', 'photo_sessions', 'storage_backend', 'storage provider is stored');
select has_column('public', 'photo_sessions', 'status', 'status is stored');
select has_column(
  'public',
  'photo_sessions',
  'delivery_generation',
  'delivery generation guards confirmation across cleanup recovery'
);
select has_column('public', 'photo_sessions', 'expires_at', 'expiry is stored');
select col_type_is('public', 'photo_sessions', 'public_token_hash', 'bytea', 'token hash is bytea');
select is(
  (
    select udt_schema || '.' || udt_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'photo_sessions'
      and column_name = 'status'
  ),
  'public.photo_session_status',
  'status uses the constrained enum'
);
select has_index(
  'public',
  'photo_sessions',
  'photo_sessions_public_token_hash_key',
  'token lookup is indexed'
);
select has_index(
  'public',
  'photo_sessions',
  'photo_sessions_storage_object_path_key',
  'storage paths are unique'
);
select has_index(
  'public',
  'photo_sessions',
  'photo_sessions_expiry_cleanup_idx',
  'expiry cleanup is indexed'
);
select has_index(
  'public',
  'photo_sessions',
  'photo_sessions_owner_client_session_key',
  'booth and client session idempotency is unique'
);
select has_index(
  'public',
  'photo_sessions',
  'photo_sessions_deleting_cleanup_idx',
  'cleanup retry leases are indexed'
);
select ok(
  exists(
    select 1
    from unnest(enum_range(null::public.photo_session_status)) as status(value)
    where status.value::text = 'deleting'
  ),
  'cleanup has a terminal deleting state'
);
select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.booth_devices'::regclass
  ),
  'booth devices force RLS'
);
select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.photo_sessions'::regclass
  ),
  'photo sessions force RLS'
);
select ok(
  not has_table_privilege('anon', 'public.photo_sessions', 'SELECT'),
  'anon cannot read photos'
);
select ok(
  not has_table_privilege('authenticated', 'public.photo_sessions', 'SELECT'),
  'authenticated users cannot read photos directly'
);
select ok(
  not has_table_privilege('anon', 'public.booth_devices', 'SELECT'),
  'anon cannot read booth identities'
);
select has_function(
  'public',
  'create_or_get_photo_session',
  array[
    'uuid', 'uuid', 'uuid', 'text', 'text', 'text', 'text', 'bigint', 'text', 'integer',
    'integer', 'text'
  ],
  'atomic stable create replay exists'
);
select has_function(
  'public',
  'resume_or_reopen_photo_session',
  array['uuid', 'uuid'],
  'owner-bound pending recovery exists'
);
select has_function(
  'public',
  'finalize_photo_session',
  array['uuid', 'uuid', 'text', 'integer'],
  'atomic finalize function exists'
);
select has_function(
  'public',
  'resolve_photo_session',
  array['text'],
  'exact-expiry resolver exists'
);
select has_function(
  'public',
  'claim_photo_cleanup',
  array['integer', 'uuid'],
  'leased cleanup claim exists'
);
select has_function(
  'public',
  'complete_photo_cleanup',
  array['uuid', 'uuid'],
  'cleanup completion exists'
);
select has_table(
  'public',
  'photo_storage_backend_repairs',
  'storage-backend repair ledger exists'
);
select has_function(
  'public',
  'repair_photo_storage_backend',
  array['uuid', 'uuid', 'text', 'bigint', 'text', 'timestamp with time zone', 'photo_session_status', 'text', 'text'],
  'guarded storage-backend repair exists'
);
select has_function(
  'public',
  'rollback_photo_storage_backend_repair',
  array['uuid'],
  'ledger-based batch rollback exists'
);
select ok(exists(select 1 from storage.buckets where id = 'photos'), 'photos bucket exists');
select is(
  (select public from storage.buckets where id = 'photos'),
  false,
  'photos bucket is private'
);
select ok(
  exists(select 1 from cron.job where jobname = 'grace-booth-cleanup-expired'),
  'daily cleanup cron exists'
);
select is(
  (select schedule from cron.job where jobname = 'grace-booth-cleanup-expired'),
  '17 19 * * *',
  'cleanup cron runs daily'
);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
)
values (
  '11111111-1111-4111-8111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'booth-test@example.invalid',
  '',
  statement_timestamp(),
  statement_timestamp(),
  statement_timestamp()
);

insert into public.booth_devices (user_id, device_name)
values ('11111111-1111-4111-8111-111111111111', 'Test booth');

select lives_ok(
  $$
    insert into public.photo_sessions (
      id,
      owner_user_id,
      client_session_id,
      public_token_hash,
      storage_object_path,
      content_type,
      byte_size,
      content_sha256,
      image_width,
      image_height
    )
    values (
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
      decode(repeat('ab', 32), 'hex'),
      '2026/08/22222222-2222-4222-8222-222222222222.jpg',
      'image/jpeg',
      1000000,
      decode(repeat('cd', 32), 'hex'),
      2800,
      1800
    )
  $$,
  'a valid pending session can be inserted'
);

select is(
  (
    select storage_backend
    from public.photo_sessions
    where id = '22222222-2222-4222-8222-222222222222'
  ),
  'supabase',
  'existing and omitted-provider rows default to Supabase Storage'
);

select lives_ok(
  $$
    update public.photo_sessions
    set byte_size = 20000000
    where id = '22222222-2222-4222-8222-222222222222'
  $$,
  'photo metadata accepts sizes above the former 12 MiB ceiling'
);

update public.photo_sessions
set byte_size = 1000000
where id = '22222222-2222-4222-8222-222222222222';

select lives_ok(
  $$
    select *
    from public.create_or_get_photo_session(
      'aaaaaaaa-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-2222-4222-8222-222222222222',
      repeat('de', 32),
      '08-24-2026/08-24-2026-07-19-44.jpg',
      'r2',
      'image/jpeg',
      1000000,
      repeat('ef', 32),
      1200,
      3600,
      null
    )
  $$,
  'date-based object paths are accepted through the create RPC'
);

select is(
  (
    select storage_backend
    from public.photo_sessions
    where id = 'aaaaaaaa-1111-4111-8111-111111111111'
  ),
  'r2',
  'the create RPC persists R2 as the selected backend'
);

select throws_ok(
  $$
    insert into public.photo_sessions (
      id, owner_user_id, client_session_id, public_token_hash, storage_object_path,
      storage_backend, content_type, byte_size, content_sha256, image_width, image_height
    ) values (
      'bbbbbbbb-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111',
      'bbbbbbbb-2222-4222-8222-222222222222',
      decode(repeat('aa', 32), 'hex'),
      '08-24-2026/08-24-2026-07-19-45.jpg',
      'r2',
      'image/jpeg',
      1000000,
      decode(repeat('bb', 32), 'hex'),
      1200,
      6001
    )
  $$,
  '23514',
  'new row for relation "photo_sessions" violates check constraint "photo_sessions_image_dimensions"',
  'dimensions above 6000 pixels remain rejected'
);

select is(
  (
    select id
    from public.create_or_get_photo_session(
      '77777777-7777-4777-8777-777777777777',
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
      repeat('ab', 32),
      '2026/08/77777777-7777-4777-8777-777777777777.jpg',
      'supabase',
      'image/jpeg',
      1000000,
      repeat('cd', 32),
      2800,
      1800,
      null
    )
  ),
  '22222222-2222-4222-8222-222222222222'::uuid,
  'a repeat request retains the canonical session id'
);

select is(
  (
    select count(*)
    from public.photo_sessions
    where owner_user_id = '11111111-1111-4111-8111-111111111111'
      and client_session_id = '33333333-3333-4333-8333-333333333333'
  ),
  1::bigint,
  'repeat and racing creates cannot duplicate a client session'
);

select is(
  (
    select encode(public_token_hash, 'hex')
    from public.photo_sessions
    where id = '22222222-2222-4222-8222-222222222222'
  ),
  repeat('ab', 32),
  'a repeat request preserves its deterministic stored hash'
);

insert into public.photo_sessions (
  id,
  owner_user_id,
  client_session_id,
  public_token_hash,
  storage_object_path,
  content_type,
  byte_size,
  content_sha256,
  image_width,
  image_height,
  created_at,
  updated_at
)
values (
  '88888888-8888-4888-8888-888888888888',
  '11111111-1111-4111-8111-111111111111',
  '99999999-9999-4999-8999-999999999999',
  decode(repeat('aa', 32), 'hex'),
  '2026/08/88888888-8888-4888-8888-888888888888.jpg',
  'image/jpeg',
  1000000,
  decode(repeat('02', 32), 'hex'),
  2800,
  1800,
  statement_timestamp() - interval '25 hours',
  statement_timestamp() - interval '25 hours'
);

select is(
  (
    select reopened
    from public.resume_or_reopen_photo_session(
      '88888888-8888-4888-8888-888888888888',
      '11111111-1111-4111-8111-111111111111'
    )
  ),
  true,
  'resuming a stale pending session atomically refreshes its activity window'
);

select is(
  (
    select count(*)
    from public.claim_photo_cleanup(100, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  ),
  0::bigint,
  'cleanup cannot immediately claim a just-resumed stale pending session'
);

select throws_ok(
  $$
    select *
    from public.create_or_get_photo_session(
      '77777777-7777-4777-8777-777777777777',
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
      repeat('bb', 32),
      '2026/08/77777777-7777-4777-8777-777777777777.jpg',
      'supabase',
      'image/jpeg',
      999999,
      repeat('cd', 32),
      2800,
      1800,
      null
    )
  $$,
  'P0001',
  'photo_session_conflict',
  'a repeat with changed immutable metadata is rejected'
);

select is(
  (
    select count(*)
    from public.resolve_photo_session(repeat('ab', 32))
  ),
  0::bigint,
  'pending photos never resolve publicly'
);

select throws_ok(
  $$
    select *
    from public.finalize_photo_session(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      repeat('ff', 32),
      0
    )
  $$,
  'P0001',
  'public_token_mismatch',
  'finalization rechecks the expected public-token hash while holding the row lock'
);

select is(
  (
    select status::text
    from public.finalize_photo_session(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      repeat('ab', 32),
      0
    )
  ),
  'ready',
  'finalize marks a pending photo ready'
);

select is(
  (
    select extract(epoch from expires_at - ready_at)::bigint
    from public.photo_sessions
    where id = '22222222-2222-4222-8222-222222222222'
  ),
  2592000::bigint,
  'expiry is exactly 720 absolute hours after readiness'
);

select is(
  (
    select expires_at
    from public.finalize_photo_session(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      repeat('ab', 32),
      0
    )
  ),
  (
    select expires_at
    from public.photo_sessions
    where id = '22222222-2222-4222-8222-222222222222'
  ),
  'finalize is idempotent'
);

select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.photo_storage_backend_repairs'::regclass
  ),
  'repair ledger forces RLS'
);
select ok(
  not has_table_privilege('anon', 'public.photo_storage_backend_repairs', 'SELECT'),
  'anon cannot read the repair ledger'
);

select is(
  public.repair_photo_storage_backend(
    '13131313-1313-4313-8313-131313131313',
    '22222222-2222-4222-8222-222222222222',
    '2026/08/22222222-2222-4222-8222-222222222222.jpg',
    999999,
    repeat('cd', 32),
    (select expires_at from public.photo_sessions where id = '22222222-2222-4222-8222-222222222222'),
    'ready'::public.photo_session_status,
    'supabase',
    'admin-r2-verification'
  ),
  'stale',
  'metadata drift prevents repair while the row still has the expected backend'
);
select is(
  public.repair_photo_storage_backend(
    '14141414-1414-4414-8414-141414141414',
    '22222222-2222-4222-8222-222222222222',
    '2026/08/22222222-2222-4222-8222-222222222222.jpg',
    1000000,
    repeat('cd', 32),
    (select expires_at from public.photo_sessions where id = '22222222-2222-4222-8222-222222222222'),
    'ready'::public.photo_session_status,
    'r2',
    'admin-r2-verification'
  ),
  'stale',
  'a non-Supabase caller snapshot cannot start a repair'
);

select is(
  public.repair_photo_storage_backend(
    '12121212-1212-4212-8212-121212121212',
    '22222222-2222-4222-8222-222222222222',
    '2026/08/22222222-2222-4222-8222-222222222222.jpg',
    1000000,
    repeat('cd', 32),
    (select expires_at from public.photo_sessions where id = '22222222-2222-4222-8222-222222222222'),
    'ready'::public.photo_session_status,
    'supabase',
    'admin-r2-verification'
  ),
  'updated',
  'an exact ready and unexpired snapshot can be repaired'
);
select is(
  (select storage_backend from public.photo_sessions where id = '22222222-2222-4222-8222-222222222222'),
  'r2',
  'repair changes only the selected backend'
);
select is(
  (
    select jsonb_build_object(
      'path', storage_object_path,
      'bytes', byte_size,
      'hash', encode(content_sha256, 'hex'),
      'status', status,
      'expiry', expires_at,
      'token', encode(public_token_hash, 'hex'),
      'owner', owner_user_id,
      'created', created_at,
      'ready', ready_at
    )
    from public.photo_sessions
    where id = '22222222-2222-4222-8222-222222222222'
  ),
  (
    select jsonb_build_object(
      'path', storage_object_path,
      'bytes', byte_size,
      'hash', encode(content_sha256, 'hex'),
      'status', status,
      'expiry', expires_at,
      'token', encode(public_token_hash, 'hex'),
      'owner', owner_user_id,
      'created', created_at,
      'ready', ready_at
    )
    from public.photo_storage_backend_repairs
    where batch_id = '12121212-1212-4212-8212-121212121212'
      and photo_session_id = '22222222-2222-4222-8222-222222222222'
  ),
  'the repair ledger preserves the guarded metadata snapshot'
);
select is(
  (
    select count(*)
    from public.photo_storage_backend_repairs
    where batch_id = '12121212-1212-4212-8212-121212121212'
  ),
  1::bigint,
  'successful repair creates one ledger record'
);
select is(
  public.repair_photo_storage_backend(
    '12121212-1212-4212-8212-121212121212',
    '22222222-2222-4222-8222-222222222222',
    '2026/08/22222222-2222-4222-8222-222222222222.jpg',
    1000000,
    repeat('cd', 32),
    (select expires_at from public.photo_sessions where id = '22222222-2222-4222-8222-222222222222'),
    'ready'::public.photo_session_status,
    'supabase',
    'admin-r2-verification'
  ),
  'already_applied',
  'repeating the same batch is idempotent'
);
select is(
  public.rollback_photo_storage_backend_repair('12121212-1212-4212-8212-121212121212'),
  1,
  'a matching ledger batch rolls back one repair'
);
select is(
  (select storage_backend from public.photo_sessions where id = '22222222-2222-4222-8222-222222222222'),
  'supabase',
  'rollback restores the recorded backend'
);
select ok(
  (
    select rolled_back_at is not null and rollback_state = 'rolled_back'
    from public.photo_storage_backend_repairs
    where batch_id = '12121212-1212-4212-8212-121212121212'
      and photo_session_id = '22222222-2222-4222-8222-222222222222'
  ),
  'rollback is recorded without deleting the ledger entry'
);
select is(
  public.rollback_photo_storage_backend_repair('12121212-1212-4212-8212-121212121212'),
  0,
  'repeating a rollback is safe'
);

update public.photo_sessions
set
  ready_at = statement_timestamp() - interval '721 hours',
  expires_at = statement_timestamp() - interval '1 hour'
where id = '22222222-2222-4222-8222-222222222222';

select is(
  public.repair_photo_storage_backend(
    '15151515-1515-4515-8515-151515151515',
    '22222222-2222-4222-8222-222222222222',
    '2026/08/22222222-2222-4222-8222-222222222222.jpg',
    1000000,
    repeat('cd', 32),
    (select expires_at from public.photo_sessions where id = '22222222-2222-4222-8222-222222222222'),
    'ready'::public.photo_session_status,
    'supabase',
    'admin-r2-verification'
  ),
  'stale',
  'expired rows cannot be repaired'
);

update public.photo_sessions
set
  ready_at = statement_timestamp(),
  expires_at = statement_timestamp() + interval '720 hours'
where id = '22222222-2222-4222-8222-222222222222';

select is(
  (
    select count(*)
    from public.resolve_photo_session(repeat('ab', 32))
  ),
  1::bigint,
  'a ready unexpired photo resolves'
);

select is(
  (
    select storage_backend
    from public.resolve_photo_session(repeat('ab', 32))
  ),
  'supabase',
  'photo resolution preserves the session storage backend'
);

select throws_ok(
  $$
    select *
    from public.create_or_get_photo_session(
      '77777777-7777-4777-8777-777777777777',
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
      repeat('ab', 32),
      '2026/08/77777777-7777-4777-8777-777777777777.jpg',
      'supabase',
      'image/jpeg',
      1000000,
      repeat('cd', 32),
      2800,
      1800,
      null
    )
  $$,
  'P0001',
  'photo_session_conflict',
  'a completed client session cannot rotate to a new token'
);

update public.photo_sessions
set
  status = 'expired',
  ready_at = statement_timestamp() - interval '744 hours',
  expires_at = statement_timestamp() - interval '24 hours'
where id = '22222222-2222-4222-8222-222222222222';

select is(
  (
    select count(*)
    from public.resolve_photo_session(repeat('ab', 32))
  ),
  0::bigint,
  'expired photos are indistinguishable from missing photos'
);

insert into public.photo_sessions (
  id,
  owner_user_id,
  client_session_id,
  public_token_hash,
  storage_object_path,
  content_type,
  byte_size,
  content_sha256,
  image_width,
  image_height,
  created_at,
  updated_at
)
values (
  '44444444-4444-4444-8444-444444444444',
  '11111111-1111-4111-8111-111111111111',
  '55555555-5555-4555-8555-555555555555',
  decode(repeat('ef', 32), 'hex'),
  '2026/08/44444444-4444-4444-8444-444444444444.jpg',
  'image/jpeg',
  1000000,
  decode(repeat('01', 32), 'hex'),
  2800,
  1800,
  statement_timestamp() - interval '25 hours',
  statement_timestamp() - interval '25 hours'
);

select is(
  (
    select count(*)
    from public.claim_photo_cleanup(100, '66666666-6666-4666-8666-666666666666')
  ),
  2::bigint,
  'cleanup claims both expired and stale pending rows'
);

select is(
  (
    select count(*)
    from public.photo_sessions
    where id in (
      '22222222-2222-4222-8222-222222222222',
      '44444444-4444-4444-8444-444444444444'
    )
      and status = 'deleting'
  ),
  2::bigint,
  'cleanup claims atomically enter the deleting state'
);

select throws_ok(
  $$
    select *
    from public.finalize_photo_session(
      '44444444-4444-4444-8444-444444444444',
      '11111111-1111-4111-8111-111111111111',
      repeat('ef', 32),
      0
    )
  $$,
  'P0001',
  'photo_session_not_pending',
  'a cleanup-claimed pending session cannot become ready'
);

select is(
  (
    select count(*)
    from public.claim_photo_cleanup(100, '77777777-7777-4777-8777-777777777777')
  ),
  0::bigint,
  'active failed-item leases cannot be reclaimed by the next batch'
);

select ok(
  public.complete_photo_cleanup(
    '22222222-2222-4222-8222-222222222222',
    '66666666-6666-4666-8666-666666666666'
  ),
  'a matching lease completes cleanup'
);

select is(
  (
    select status::text
    from public.photo_sessions
    where id = '22222222-2222-4222-8222-222222222222'
  ),
  'deleted',
  'completed cleanup records deletion'
);

select throws_ok(
  $$
    select *
    from public.resume_or_reopen_photo_session(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111'
    )
  $$,
  'P0001',
  'photo_session_not_resumable',
  'an expired ready tombstone can never be reopened'
);

update public.photo_sessions
set cleanup_lease_until = statement_timestamp() - interval '1 second'
where id = '44444444-4444-4444-8444-444444444444';

select is(
  (
    select previous_status::text
    from public.claim_photo_cleanup(100, '77777777-7777-4777-8777-777777777777')
    where id = '44444444-4444-4444-8444-444444444444'
  ),
  'deleting',
  'an expired deleting lease can be retried idempotently'
);

select ok(
  public.complete_photo_cleanup(
    '44444444-4444-4444-8444-444444444444',
    '77777777-7777-4777-8777-777777777777'
  ),
  'a retried stale-pending cleanup completes'
);

select is(
  (
    select reopened
    from public.resume_or_reopen_photo_session(
      '44444444-4444-4444-8444-444444444444',
      '11111111-1111-4111-8111-111111111111'
    )
  ),
  true,
  'an owner can reopen a cleaned never-ready pending session'
);

select is(
  (
    select status::text
    from public.photo_sessions
    where id = '44444444-4444-4444-8444-444444444444'
  ),
  'pending',
  'recovery returns the stale-pending tombstone to pending'
);

select is(
  (
    select storage_object_path
    from public.photo_sessions
    where id = '44444444-4444-4444-8444-444444444444'
  ),
  '2026/08/44444444-4444-4444-8444-444444444444.jpg',
  'recovery preserves the opaque storage path and expected metadata'
);

select is(
  (
    select delivery_generation
    from public.photo_sessions
    where id = '44444444-4444-4444-8444-444444444444'
  ),
  1,
  'reopening a cleaned session advances its delivery generation'
);

update public.photo_sessions
set updated_at = statement_timestamp() - interval '25 hours'
where id = 'aaaaaaaa-1111-4111-8111-111111111111';

select is(
  (
    select storage_backend
    from public.claim_photo_cleanup(100, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    where id = 'aaaaaaaa-1111-4111-8111-111111111111'
  ),
  'r2',
  'cleanup claims preserve the object storage backend'
);

select throws_ok(
  $$
    select *
    from public.finalize_photo_session(
      '44444444-4444-4444-8444-444444444444',
      '11111111-1111-4111-8111-111111111111',
      repeat('ef', 32),
      0
    )
  $$,
  'P0001',
  'photo_session_generation_mismatch',
  'a pre-cleanup confirmation cannot finalize a reopened generation'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (roles @> array['anon']::name[] or roles @> array['authenticated']::name[])
  ),
  0::bigint,
  'storage has no anon or authenticated object policy'
);

select * from finish();
rollback;
