-- 0004_storage.sql — image bucket for host-uploaded question photos.
--
-- Public-read so the venue TV (no auth) can render them; host-only write
-- enforced via Storage RLS policies below. Path convention:
--   question-images/{night_id}/{question_id}.{ext}

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'question-images',
  'question-images',
  true,
  10 * 1024 * 1024,  -- 10MB max
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

-- Anyone can read (public bucket).
create policy "question-images public read"
  on storage.objects for select
  using (bucket_id = 'question-images');

-- Only the host of the night in the path can upload.
create policy "question-images host write"
  on storage.objects for insert
  with check (
    bucket_id = 'question-images'
    and exists (
      select 1 from public.nights n
      join public.hosts h on h.id = n.host_id
      where h.user_id = auth.uid()
        and (storage.foldername(name))[1] = n.id::text
    )
  );

create policy "question-images host delete"
  on storage.objects for delete
  using (
    bucket_id = 'question-images'
    and exists (
      select 1 from public.nights n
      join public.hosts h on h.id = n.host_id
      where h.user_id = auth.uid()
        and (storage.foldername(name))[1] = n.id::text
    )
  );
