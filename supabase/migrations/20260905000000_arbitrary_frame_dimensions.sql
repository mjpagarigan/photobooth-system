-- Match original-size frame exports; retain edge and decoded-pixel safety limits.
alter table public.photo_sessions
  drop constraint photo_sessions_image_dimensions;

alter table public.photo_sessions
  add constraint photo_sessions_image_dimensions check (
    image_width between 1 and 12000
    and image_height between 1 and 12000
    and image_width::bigint * image_height::bigint <= 80000000
  );
