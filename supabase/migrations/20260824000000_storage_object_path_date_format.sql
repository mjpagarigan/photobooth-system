-- Migration: 20260824000000_storage_object_path_date_format.sql
-- Allow date-based MM-DD-YYYY/MM-DD-YYYY-HH-MM-SS(-<suffix>)?.jpg storage paths while maintaining legacy UUID support.

alter table public.photo_sessions
  drop constraint if exists photo_sessions_storage_object_path_shape;

alter table public.photo_sessions
  add constraint photo_sessions_storage_object_path_shape
  check (
    storage_object_path ~ '^[0-9]{4}/[0-9]{2}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]jpg$'
    or storage_object_path ~ '^[0-9]{2}-[0-9]{2}-[0-9]{4}/[0-9]{2}-[0-9]{2}-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}(-[0-9]+)?[.]jpg$'
  );
