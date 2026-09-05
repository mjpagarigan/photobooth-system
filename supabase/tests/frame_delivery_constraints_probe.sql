-- Read live constraints into a temporary table; never modify guest records.
begin;
create temporary table frame_constraint_probe
  (like public.photo_sessions including defaults including constraints);
insert into frame_constraint_probe select * from public.photo_sessions limit 1;
do $$
declare
  candidate text;
begin
  if not exists (select 1 from frame_constraint_probe) then
    raise exception 'A sample photo row is required for this constraint probe';
  end if;
  update frame_constraint_probe set image_width = 1920, image_height = 1080,
    google_forms_url = 'https://example.org/join?contact=team@example.org';
  update frame_constraint_probe set image_width = 12000, image_height = 6000;
  update frame_constraint_probe set image_width = 1, image_height = 1;
  foreach candidate in array array['https://example.org/join', 'https://example.org:443/join', null] loop
    update frame_constraint_probe set google_forms_url = candidate;
  end loop;
  foreach candidate in array array['http://example.org', 'https://user:password@example.org', 'https://example.org:8443/join'] loop
    begin
      update frame_constraint_probe set google_forms_url = candidate;
      raise exception 'Unsafe URL accepted: %', candidate;
    exception when check_violation then null;
    end;
  end loop;
  begin
    update frame_constraint_probe set image_width = 12001;
    raise exception 'Over-limit edge accepted';
  exception when check_violation then null;
  end;
  begin
    update frame_constraint_probe set image_width = 12000, image_height = 12000;
    raise exception 'Over-limit pixel count accepted';
  exception when check_violation then null;
  end;
end $$;
-- Exercise the same RPC used by create-upload, then roll its row back.
do $$
declare
  sample_owner uuid;
  candidate_id uuid := gen_random_uuid();
begin
  select owner_user_id into strict sample_owner from frame_constraint_probe limit 1;
  perform * from public.create_or_get_photo_session(
    candidate_id, sample_owner, gen_random_uuid(),
    encode(sha256(candidate_id::text::bytea), 'hex'),
    '2026/09/' || candidate_id::text || '.jpg',
    'r2', 'image/jpeg', 1024, repeat('ab', 32), 1920, 1080,
    'https://example.org/join'
  );
  if not exists (select 1 from public.photo_sessions where id = candidate_id
    and image_width = 1920 and image_height = 1080
    and google_forms_url = 'https://example.org/join') then
    raise exception 'Create-upload RPC did not persist the expected metadata';
  end if;
end $$;
select 'Frame dimensions and recruitment URL constraints passed' as result;
rollback;
