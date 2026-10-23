-- 016_local_seo_fields.sql 되돌리기 (운영 적용이 실패했을 때만 수동으로 실행)
-- supabase/migrations 밖에 있어 자동으로 실행되지 않는다. 015까지 되돌릴 때는 이 파일 → 015_down → ...
-- 주의: 시/군·지역·키워드·사진 설명·현장 사례 값과 얇은 페이지 설정이 사라진다.
-- 공개 함수는 013의 내용으로 되돌린다.

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
        kakao_url, address, template, status, published_at
      )
      values (
        v_item.business_name, v_item.title, v_item.slug, v_item.hero_text,
        v_item.description, v_item.phone, v_item.kakao_url, v_item.address,
        v_item.template, 'public', now()
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

    insert into public.landing_page_seo_settings (
      landing_page_id, seo_title, seo_description, service_area, business_category
    )
    values (
      v_page_id, v_item.seo_title, v_item.seo_description,
      v_item.service_area, v_item.business_category
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

alter table public.auto_publish_settings drop column if exists noindex_thin_pages;

alter table public.landing_page_queue
  drop constraint if exists landing_page_queue_region_keyword_length_check;
alter table public.landing_page_queue
  drop column if exists city,
  drop column if exists city_slug,
  drop column if exists main_image_url,
  drop column if exists main_image_alt,
  drop column if exists case_study;

drop index if exists public.landing_pages_city_slug_public_idx;
alter table public.landing_pages
  drop column if exists region,
  drop column if exists keyword,
  drop column if exists city,
  drop column if exists city_slug,
  drop column if exists main_image_alt,
  drop column if exists case_study;

commit;
