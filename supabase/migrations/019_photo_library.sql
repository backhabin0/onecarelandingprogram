-- 사진 기능: 사진 보관함(media_assets) + 페이지마다 사진 3장 + 대표 업체 로고
-- Supabase Dashboard > SQL Editor 에서 실행한다. (001~018을 먼저 실행한 상태여야 한다)
-- 기존 migration(001~018)은 수정하지 않는다.
-- 되돌리기: supabase/rollback/019_down.sql
--
-- 1) media_assets: 보관함 사진 목록. 브라우저에서 압축한 파일을 library/{sha256}.webp 에 한 번만 저장하고,
--    og:image용 1200×630 JPEG(library/{sha256}-og.jpg)도 함께 둔다. sha256은 원본 파일 내용의 해시라
--    같은 사진을 다시 올리면 새로 저장하지 않고 기존 행을 쓴다.
--    사진마다 짧은 설명(description)을 두고, 페이지 사진 설명(alt)이 비어 있으면 이 설명을 쓴다.
-- 2) 사진 2·3 칸(사진 1 = 기존 main_image_url / main_image_alt 그대로): landing_pages, landing_page_queue
-- 3) site_profile.logo_url: 대표 업체 로고(페이지 로고가 비어 있고 업체명이 대표 업체와 같은 페이지가 씀)
--    landing_page_queue.logo_url: 대량 등록 공통 사진 설정·엑셀 '로고' 칸의 페이지 로고(공개할 때 페이지로 복사)
-- 4) Storage: 버킷 파일 상한 10MB → 2MB(압축 후 기준), 업로드 경로를 library/ 와 landing-pages/ 로만 제한
-- 5) publish_queued_landing_pages: 사진 2·3·로고도 공개 페이지로 복사, 얇은 페이지 판단에 사진 2·3 포함
--    (그 밖의 동작은 016과 같다)

-- ============================================================
-- 1) 사진 보관함
-- ============================================================

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  -- 원본 파일 내용의 sha256(소문자 16진수 64자)
  sha256 text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  -- photo: 사진(긴 변 1600px) / logo: 로고(512px, 투명 유지)
  kind text not null check (kind in ('photo', 'logo')),
  -- 관리자가 보는 이름(올린 파일 이름). 엑셀 사진 칸에 이 이름을 쓴다. 대소문자 무시하고 겹치지 않게 둔다.
  name text not null check (char_length(name) between 1 and 200),
  -- 짧은 설명(예: 정화조 작업 현장). 페이지 사진 설명(alt)이 비어 있으면 이 값을 쓰고, AI 프롬프트에도 넣는다.
  description text not null default '' check (char_length(description) <= 200),
  -- 브라우저가 WebP를 못 만들면 JPEG(사진)·PNG(로고)로 저장한다.
  storage_path text not null unique check (storage_path ~ '^library/[0-9a-f]{64}\.(webp|jpg|png)$'),
  url text not null unique check (char_length(url) <= 500),
  og_storage_path text not null unique check (og_storage_path ~ '^library/[0-9a-f]{64}-og\.jpg$'),
  og_url text not null check (char_length(og_url) <= 500),
  mime text not null check (mime in ('image/webp', 'image/jpeg', 'image/png')),
  width integer not null check (width between 1 and 4096),
  height integer not null check (height between 1 and 4096),
  -- 버킷 상한과 같은 2MB
  bytes integer not null check (bytes between 1 and 2097152),
  og_bytes integer not null check (og_bytes between 1 and 2097152),
  created_at timestamptz not null default now()
);

create unique index if not exists media_assets_name_lower_key on public.media_assets (lower(name));
create index if not exists media_assets_created_at_idx on public.media_assets (created_at desc, id desc);

alter table public.media_assets enable row level security;

-- 관리자(로그인한 authenticated 사용자)만 조회·추가·삭제. 수정은 쓰지 않으므로 정책을 두지 않는다.
-- anon(비로그인 방문자)은 목록을 볼 수 없다. 공개 페이지는 사진 주소(Storage 공개 경로)만 쓴다.
drop policy if exists "Authenticated can select media_assets" on public.media_assets;
create policy "Authenticated can select media_assets"
  on public.media_assets
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated can insert media_assets" on public.media_assets;
create policy "Authenticated can insert media_assets"
  on public.media_assets
  for insert
  to authenticated
  with check (true);

-- 수정은 설명(description)만 쓴다(화면·Server Action이 다른 칸을 바꾸지 않음).
drop policy if exists "Authenticated can update media_assets" on public.media_assets;
create policy "Authenticated can update media_assets"
  on public.media_assets
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated can delete media_assets" on public.media_assets;
create policy "Authenticated can delete media_assets"
  on public.media_assets
  for delete
  to authenticated
  using (true);

-- ============================================================
-- 2) 사진 2·3 칸 / 3) 대표 업체 로고
-- ============================================================

alter table public.landing_pages
  add column if not exists image_2_url text check (char_length(image_2_url) <= 500),
  add column if not exists image_2_alt text check (char_length(image_2_alt) <= 200),
  add column if not exists image_3_url text check (char_length(image_3_url) <= 500),
  add column if not exists image_3_alt text check (char_length(image_3_alt) <= 200);

alter table public.landing_page_queue
  add column if not exists image_2_url text check (char_length(image_2_url) <= 500),
  add column if not exists image_2_alt text check (char_length(image_2_alt) <= 200),
  add column if not exists image_3_url text check (char_length(image_3_url) <= 500),
  add column if not exists image_3_alt text check (char_length(image_3_alt) <= 200),
  add column if not exists logo_url text check (char_length(logo_url) <= 500);

alter table public.site_profile
  add column if not exists logo_url text check (char_length(logo_url) <= 500);

-- ============================================================
-- 4) Storage
-- ============================================================

-- 이미 올라가 있는 파일에는 적용되지 않고, 새로 올리는 파일부터 2MB를 넘으면 거절된다.
update storage.buckets
set file_size_limit = 2097152
where id = 'landing-page-assets';

-- 업로드·교체: 로그인한 관리자만, 보관함(library/)과 예전 페이지별 경로(landing-pages/)에만
drop policy if exists "Authenticated can upload landing-page-assets" on storage.objects;
create policy "Authenticated can upload landing-page-assets"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'landing-page-assets'
    and (name like 'library/%' or name like 'landing-pages/%')
  );

drop policy if exists "Authenticated can update landing-page-assets" on storage.objects;
create policy "Authenticated can update landing-page-assets"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'landing-page-assets')
  with check (
    bucket_id = 'landing-page-assets'
    and (name like 'library/%' or name like 'landing-pages/%')
  );

-- ============================================================
-- 5) 공개 함수 갱신
-- ============================================================

create or replace function public.publish_queued_landing_pages(p_limit integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run_date date := (now() at time zone 'Asia/Seoul')::date;
  v_run_id uuid;
  v_item public.landing_page_queue%rowtype;
  v_page_id uuid;
  v_published integer := 0;
  v_failed integer := 0;
  v_published_ids uuid[] := '{}';
  v_failed_ids uuid[] := '{}';
  v_noindex_thin boolean;
  v_is_thin boolean;
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'p_limit는 1~1000 사이여야 합니다. (받은 값: %)', p_limit
      using errcode = '22023';
  end if;

  insert into public.publish_runs (run_date, requested_limit)
  values (v_run_date, p_limit)
  on conflict (run_date) do nothing
  returning id into v_run_id;

  if v_run_id is null then
    return jsonb_build_object(
      'status', 'already_ran',
      'run_date', v_run_date,
      'published', 0,
      'failed', 0,
      'published_ids', '[]'::jsonb,
      'failed_ids', '[]'::jsonb
    );
  end if;

  -- 016: 설정에서 켠 경우에만 "얇은 페이지"를 noindex로 공개한다(기본 꺼짐).
  select coalesce(noindex_thin_pages, false) into v_noindex_thin
  from public.auto_publish_settings where id = 'default';
  v_noindex_thin := coalesce(v_noindex_thin, false);

  for v_item in
    select *
    from public.landing_page_queue
    where state = 'ready'
    order by created_at, id
    limit p_limit
    for update skip locked
  loop
    -- 이미 같은 slug의 랜딩페이지가 있으면 이 행만 실패 처리
    if exists (select 1 from public.landing_pages lp where lp.slug = v_item.slug) then
      update public.landing_page_queue
      set state = 'failed',
          validation_errors = validation_errors || jsonb_build_array(jsonb_build_object(
            'code', 'slug_conflict',
            'fields', jsonb_build_array('slug'),
            'message', '이미 사용 중인 URL입니다.'
          ))
      where id = v_item.id;
      v_failed := v_failed + 1;
      v_failed_ids := v_failed_ids || v_item.id;
      continue;
    end if;

    begin
      insert into public.landing_pages (
        business_name, title, slug, hero_text, description, phone,
        kakao_url, address, template, status, published_at,
        region, keyword, city, city_slug, main_image_url, main_image_alt, case_study,
        image_2_url, image_2_alt, image_3_url, image_3_alt, logo_url
      )
      values (
        v_item.business_name, v_item.title, v_item.slug, v_item.hero_text,
        v_item.description, v_item.phone, v_item.kakao_url, v_item.address,
        v_item.template, 'public', now(),
        v_item.region, v_item.keyword, v_item.city, v_item.city_slug,
        v_item.main_image_url, v_item.main_image_alt, v_item.case_study,
        v_item.image_2_url, v_item.image_2_alt, v_item.image_3_url, v_item.image_3_alt, v_item.logo_url
      )
      returning id into v_page_id;
    exception
      -- 위 검사와 insert 사이에 다른 곳에서 같은 slug가 생긴 경우
      when unique_violation then
        update public.landing_page_queue
        set state = 'failed',
            validation_errors = validation_errors || jsonb_build_array(jsonb_build_object(
              'code', 'slug_conflict',
              'fields', jsonb_build_array('slug'),
              'message', '이미 사용 중인 URL입니다.'
            ))
        where id = v_item.id;
        v_failed := v_failed + 1;
        v_failed_ids := v_failed_ids || v_item.id;
        continue;
    end;

    -- 얇은 페이지: 소개 문구가 200자 미만이고 사진(1~3)·현장 사례가 모두 없음
    -- (lib/landing-page-validation.ts THIN_DESCRIPTION_MIN_LENGTH와 같은 기준)
    v_is_thin := char_length(btrim(coalesce(v_item.description, ''))) < 200
      and nullif(btrim(coalesce(v_item.main_image_url, '')), '') is null
      and nullif(btrim(coalesce(v_item.image_2_url, '')), '') is null
      and nullif(btrim(coalesce(v_item.image_3_url, '')), '') is null
      and nullif(btrim(coalesce(v_item.case_study, '')), '') is null;

    insert into public.landing_page_seo_settings (
      landing_page_id, seo_title, seo_description, service_area, business_category, seo_noindex
    )
    values (
      v_page_id, v_item.seo_title, v_item.seo_description,
      v_item.service_area, v_item.business_category, v_noindex_thin and v_is_thin
    );

    insert into public.landing_page_faqs (landing_page_id, question, answer, sort_order)
    select v_page_id, faq.value ->> 'question', faq.value ->> 'answer', (faq.ordinality - 1)::integer
    from jsonb_array_elements(v_item.faqs) with ordinality as faq(value, ordinality);

    update public.landing_page_queue
    set state = 'published',
        published_at = now(),
        landing_page_id = v_page_id
    where id = v_item.id;

    v_published := v_published + 1;
    v_published_ids := v_published_ids || v_item.id;
  end loop;

  update public.publish_runs
  set published_count = v_published,
      failed_count = v_failed,
      finished_at = clock_timestamp()
  where id = v_run_id;

  return jsonb_build_object(
    'status', 'ok',
    'run_date', v_run_date,
    'published', v_published,
    'failed', v_failed,
    'published_ids', to_jsonb(v_published_ids),
    'failed_ids', to_jsonb(v_failed_ids)
  );
end;
$$;

-- 실행 권한은 013·016과 같다(create or replace는 기존 권한을 유지하지만, 다시 한 번 명시한다).
revoke all on function public.publish_queued_landing_pages(integer) from public;
revoke all on function public.publish_queued_landing_pages(integer) from anon;
revoke all on function public.publish_queued_landing_pages(integer) from service_role;
grant execute on function public.publish_queued_landing_pages(integer) to authenticated;
