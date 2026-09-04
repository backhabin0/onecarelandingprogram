-- 7단계: landing-page-assets Storage bucket 및 정책
-- Supabase Dashboard > SQL Editor 에서 실행한다. (001~004를 먼저 실행한 상태여야 한다)

-- 로고/메인 이미지를 위한 public bucket.
-- public = true 이므로 고객(anon)도 이미지를 직접 조회할 수 있다.
-- 파일 크기는 버킷 전체 상한을 10MB로 두고, 로고의 3MB 제한은
-- 애플리케이션(lib/storage/landing-page-assets.ts)에서 추가로 검증한다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'landing-page-assets',
  'landing-page-assets',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 공개 조회: 누구나(anon 포함) 이 버킷의 object를 조회할 수 있다.
-- (고객용 /[slug] 페이지에서 로고/메인 이미지를 표시하기 위해 필요)
drop policy if exists "Public can read landing-page-assets" on storage.objects;
create policy "Public can read landing-page-assets"
  on storage.objects
  for select
  to public
  using (bucket_id = 'landing-page-assets');

-- 업로드: 로그인한 관리자(authenticated)만 가능
drop policy if exists "Authenticated can upload landing-page-assets" on storage.objects;
create policy "Authenticated can upload landing-page-assets"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'landing-page-assets');

-- 교체(upsert 등 UPDATE 경로): 로그인한 관리자만 가능
drop policy if exists "Authenticated can update landing-page-assets" on storage.objects;
create policy "Authenticated can update landing-page-assets"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'landing-page-assets')
  with check (bucket_id = 'landing-page-assets');

-- 삭제: 로그인한 관리자만 가능
drop policy if exists "Authenticated can delete landing-page-assets" on storage.objects;
create policy "Authenticated can delete landing-page-assets"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'landing-page-assets');

-- anon 사용자는 이 bucket에 대해 INSERT/UPDATE/DELETE 정책이 하나도 없으므로
-- 업로드/교체/삭제는 계속 거부된다. 조회(public GET)만 가능하다.
