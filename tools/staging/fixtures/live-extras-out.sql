-- live extras, read from live at 2026-11-12 (fixture)
create extension if not exists pgcrypto with schema extensions;
alter publication supabase_realtime add table public.vp_session_events;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('venue-logos', 'venue-logos', true, 2097152, null) on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
