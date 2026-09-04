-- Replace Google-Forms-only URL constraint with generic valid HTTPS URL constraint.
-- Requires HTTPS protocol, no embedded credentials, standard port 443, and max 2,048 characters.
alter table photo_sessions
  drop constraint if exists photo_sessions_google_forms_url;

alter table photo_sessions
  add constraint photo_sessions_google_forms_url
  check (
    google_forms_url is null
    or (
      char_length(google_forms_url) <= 2048
      and google_forms_url ~ '^https://([^/?#@\s]+)(:443)?([/?#].*)?$'
      and google_forms_url not like '%@%'
    )
  );
