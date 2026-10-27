-- 019_photo_library.sql 되돌리기 (운영 적용이 실패했을 때만 수동으로 실행)
-- supabase/migrations 밖에 있어 자동으로 실행되지 않는다. 018까지 되돌릴 때는 이 파일 → 018_down → ...
-- 주의: 사진 보관함 목록(media_assets), 사진 2·3과 설명, 대표 업체 로고 값이 사라진다.
--       Storage의 library/ 파일은 지우지 않는다(목록만 사라짐). 필요하면 Storage API로 따로 정리한다.
-- 공개 함수는 016의 내용으로 되돌린다.

begin;

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

-- Storage: 005의 정책·상한으로 되돌린다.
update storage.buckets
set file_size_limit = 10485760
where id = 'landing-page-assets';

drop policy if exists "Authenticated can upload landing-page-assets" on storage.objects;
create policy "Authenticated can upload landing-page-assets"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'landing-page-assets');

drop policy if exists "Authenticated can update landing-page-assets" on storage.objects;
create policy "Authenticated can update landing-page-assets"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'landing-page-assets')
  with check (bucket_id = 'landing-page-assets');

alter table public.site_profile
  drop column if exists logo_url;

alter table public.landing_page_queue
  drop column if exists image_2_url,
  drop column if exists image_2_alt,
  drop column if exists image_3_url,
  drop column if exists image_3_alt,
  drop column if exists logo_url;

alter table public.landing_pages
  drop column if exists image_2_url,
  drop column if exists image_2_alt,
  drop column if exists image_3_url,
  drop column if exists image_3_alt;

drop table if exists public.media_assets;

commit;
