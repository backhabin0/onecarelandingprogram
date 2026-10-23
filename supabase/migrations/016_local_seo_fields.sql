-- 대량 공개(bulk publish) 7단계: 지역 SEO용 칸(시/군·지역·키워드·사진 설명·현장 사례)
-- Supabase Dashboard > SQL Editor 에서 실행한다. (001~015를 먼저 실행한 상태여야 한다)
-- 기존 migration(001~015)은 수정하지 않는다.
-- 되돌리기: supabase/rollback/016_down.sql
--
-- 1) landing_pages / landing_page_queue 에 칸 추가(모두 nullable, 기존 행은 null)
--    - city, city_slug: 시/군(예: 군포시, gunpo) — 지역 모음 페이지(/area/{city_slug})와 내부 링크용
--    - region, keyword: 대기열의 지역·키워드를 공개 페이지에도 남김(제목·H1·내부 링크·구조화 데이터용)
--    - main_image_alt: 대표 사진 설명(alt), case_study: 현장 사례(손님이 직접 작성)
--    - 대기열에는 main_image_url도 추가(엑셀의 "대표 사진 URL")
-- 2) auto_publish_settings.noindex_thin_pages(기본 false): 켜면 얇은 페이지를 noindex로 공개
-- 3) publish_queued_landing_pages: 위 칸을 공개 페이지로 복사, 얇은 페이지 noindex 옵션 반영
--    (그 밖의 동작 — 오래된 순, 같은 KST 날짜 차단, slug 충돌 행만 failed — 은 013과 같다)

-- ============================================================
-- 1) 칸 추가
-- ============================================================

alter table public.landing_pages
  add column if not exists region text check (char_length(region) <= 50),
  add column if not exists keyword text check (char_length(keyword) <= 50),
  add column if not exists city text check (char_length(city) <= 50),
  add column if not exists city_slug text check (city_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  add column if not exists main_image_alt text check (char_length(main_image_alt) <= 200),
  add column if not exists case_study text check (char_length(case_study) <= 2000);

-- 지역 모음 페이지·내부 링크 조회용(공개 페이지만)
create index if not exists landing_pages_city_slug_public_idx
  on public.landing_pages (city_slug, keyword)
  where status = 'public' and city_slug is not null;

alter table public.landing_page_queue
  add column if not exists city text check (char_length(city) <= 50),
  add column if not exists city_slug text check (city_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  add column if not exists main_image_url text check (char_length(main_image_url) <= 500),
  add column if not exists main_image_alt text check (char_length(main_image_alt) <= 200),
  add column if not exists case_study text check (char_length(case_study) <= 2000);

-- 대기열의 지역·키워드도 공개 페이지와 같은 50자 제한(공개 단계 insert가 실패하지 않도록).
-- not valid: 이미 들어 있는 행은 검사하지 않고 새로 넣거나 고치는 행부터 적용한다.
alter table public.landing_page_queue
  drop constraint if exists landing_page_queue_region_keyword_length_check;
alter table public.landing_page_queue
  add constraint landing_page_queue_region_keyword_length_check
  check (char_length(region) <= 50 and char_length(keyword) <= 50) not valid;

-- ============================================================
-- 2) 얇은 페이지 noindex 옵션(기본 꺼짐 — 자동 noindex는 관리자가 켤 때만)
-- ============================================================

alter table public.auto_publish_settings
  add column if not exists noindex_thin_pages boolean not null default false;

-- ============================================================
-- 3) 공개 함수 갱신
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
        region, keyword, city, city_slug, main_image_url, main_image_alt, case_study
      )
      values (
        v_item.business_name, v_item.title, v_item.slug, v_item.hero_text,
        v_item.description, v_item.phone, v_item.kakao_url, v_item.address,
        v_item.template, 'public', now(),
        v_item.region, v_item.keyword, v_item.city, v_item.city_slug,
        v_item.main_image_url, v_item.main_image_alt, v_item.case_study
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

    -- 얇은 페이지: 소개 문구가 200자 미만이고 사진·현장 사례가 모두 없음
    -- (lib/landing-page-validation.ts THIN_DESCRIPTION_MIN_LENGTH와 같은 기준)
    v_is_thin := char_length(btrim(coalesce(v_item.description, ''))) < 200
      and nullif(btrim(coalesce(v_item.main_image_url, '')), '') is null
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

-- 실행 권한은 013과 같다(create or replace는 기존 권한을 유지하지만, 다시 한 번 명시한다).
revoke all on function public.publish_queued_landing_pages(integer) from public;
revoke all on function public.publish_queued_landing_pages(integer) from anon;
revoke all on function public.publish_queued_landing_pages(integer) from service_role;
grant execute on function public.publish_queued_landing_pages(integer) to authenticated;
