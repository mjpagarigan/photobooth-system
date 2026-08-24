-- Photo size is validated for positivity and exact object/metadata equality, without an
-- application-defined byte ceiling. Storage providers still enforce their own platform limits.

alter table public.photo_sessions
  drop constraint if exists photo_sessions_byte_size;

alter table public.photo_sessions
  add constraint photo_sessions_byte_size
  check (byte_size > 0);
