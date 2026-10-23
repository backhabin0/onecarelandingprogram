-- 대량 공개(bulk publish) 3단계: 공개 대기열과 하루 단위 자동 공개 함수
-- Supabase Dashboard > SQL Editor 에서 실행한다. (001~012를 먼저 실행한 상태여야 한다)
-- 기존 migration(001~012)은 수정하지 않는다.
-- 되돌리기: supabase/rollback/013_down.sql (자동 실행되지 않는 별도 폴더)
--
-- 이 migration이 하는 일
--   1) landing_pages.published_at 컬럼 추가(nullable, 기본값 없음 → 기존 행은 null 그대로)
--   2) landing_page_queue: 지역×키워드 랜딩페이지 초안을 쌓아 두는 대기열
--   3) auto_publish_settings: 자동 공개 설정(단일 행, 기본 꺼짐 / 하루 50개)
--   4) publish_runs: 하루(KST) 1회 실행 기록 — 같은 날 두 번 실행을 막는다
--   5) publish_queued_landing_pages(p_limit): ready 항목을 오래된 순으로 N개 공개
--
-- 새 테이블은 모두 RLS를 켜고 로그인 사용자(authenticated)만 접근한다.
-- anon 정책은 하나도 만들지 않으므로 비로그인 사용자는 전부 거부된다.

-- ============================================================
-- 1) landing_pages.published_at
-- ============================================================

-- 대기열에서 자동/일괄 공개된 시각. 관리자 화면에서 직접 만든 페이지와
-- 이 migration 이전의 기존 페이지는 null이다. 기본값을 두지 않으므로
-- 기존 행의 값·updated_at은 전혀 바뀌지 않는다(테이블 재작성도 없음).
alter table public.landing_pages
  add column if not exists published_at timestamptz null;

-- ============================================================
-- 2) landing_page_queue
-- ============================================================

-- 대기열 faqs(jsonb 배열)의 각 항목이 landing_page_faqs 제약(009)에 맞는지 검사한다.
-- 형식이 틀린 FAQ가 대기열에 들어오면 공개 단계에서 insert가 실패해 그날 실행
-- 전체가 롤백되므로, 대기열에 넣는 시점에 막는다.
create or replace function public.is_valid_queue_faqs(p_faqs jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_faqs) = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(p_faqs) as faq(value)
      where jsonb_typeof(faq.value) <> 'object'
        or jsonb_typeof(faq.value -> 'question') is distinct from 'string'
        or jsonb_typeof(faq.value -> 'answer') is distinct from 'string'
        or btrim(faq.value ->> 'question') = ''
        or btrim(faq.value ->> 'answer') = ''
        or char_length(faq.value ->> 'question') > 200
        or char_length(faq.value ->> 'answer') > 2000
    );
$$;

create table if not exists public.landing_page_queue (
  id uuid primary key default gen_random_uuid(),

  -- 지역×키워드 조합. 같은 조합은 한 번만 대기열에 들어간다.
  region text not null,
  keyword text not null,
  region_slug text not null,
  keyword_slug text not null,

  -- 공개 시 landing_pages로 그대로 옮겨지는 입력값(관리자 생성 폼과 같은 칸)
  business_name text not null,
  title text not null,
  slug text not null,
  hero_text text,
  description text,
  phone text,
  kakao_url text,
  address text,
  template text not null default 'template-a',

  -- 공개 시 landing_page_seo_settings로 옮겨지는 값. 제한은 009와 같다
  -- (여기서 막아 두지 않으면 공개 단계 insert가 실패한다).
  seo_title text check (char_length(seo_title) <= 120),
  seo_description text check (char_length(seo_description) <= 320),
  service_area text check (char_length(service_area) <= 200),
  business_category text check (char_length(business_category) <= 100),

  -- [{"question": "...", "answer": "..."}, ...] — 공개 시 landing_page_faqs로 옮겨진다.
  faqs jsonb not null default '[]'::jsonb
    check (public.is_valid_queue_faqs(faqs)),

  source text not null check (source in ('ai', 'excel')),
  state text not null default 'draft'
    check (state in ('draft', 'ready', 'hold', 'published', 'failed')),

  -- 앱 검증(lib/landing-page-validation.ts) 결과나 공개 실패 사유. 배열.
  validation_errors jsonb not null default '[]'::jsonb
    check (jsonb_typeof(validation_errors) = 'array'),

  -- 기존 페이지와의 최대 문장 유사도(0~1). 계산 전에는 null.
  max_similarity numeric(5, 4)
    check (max_similarity is null or (max_similarity >= 0 and max_similarity <= 1)),

  priority integer not null default 0,

  published_at timestamptz,
  -- 공개된 랜딩페이지. 그 페이지가 삭제되면 기록만 남고 연결은 끊긴다.
  landing_page_id uuid references public.landing_pages(id) on delete set null,
  -- 같은 엑셀 업로드/AI 생성 묶음을 구분하는 값(별도 테이블 없음)
  batch_id uuid,

  created_at timestamptz not null default now(),

  constraint landing_page_queue_slug_key unique (slug),
  constraint landing_page_queue_region_keyword_key unique (region, keyword)
);

-- 공개 함수가 "ready를 오래된 순으로" 고를 때 쓰는 인덱스
create index if not exists landing_page_queue_state_created_at_idx
  on public.landing_page_queue (state, created_at, id);

create index if not exists landing_page_queue_batch_id_idx
  on public.landing_page_queue (batch_id)
  where batch_id is not null;

alter table public.landing_page_queue enable row level security;

drop policy if exists "Authenticated can manage landing_page_queue"
  on public.landing_page_queue;
create policy "Authenticated can manage landing_page_queue"
  on public.landing_page_queue
  for all
  to authenticated
  using (true)
  with check (true);

-- ============================================================
-- 3) auto_publish_settings (단일 행)
-- ============================================================

create table if not exists public.auto_publish_settings (
  -- 011의 site_verification_settings와 같이 항상 'default' 한 행만 쓴다.
  id text primary key default 'default' check (id = 'default'),
  enabled boolean not null default false,
  daily_limit integer not null default 50
    check (daily_limit >= 1 and daily_limit <= 1000),
  updated_at timestamptz not null default now()
);

insert into public.auto_publish_settings (id)
values ('default')
on conflict (id) do nothing;

drop trigger if exists auto_publish_settings_set_updated_at
  on public.auto_publish_settings;
create trigger auto_publish_settings_set_updated_at
  before update on public.auto_publish_settings
  for each row
  execute function public.set_updated_at();

alter table public.auto_publish_settings enable row level security;

drop policy if exists "Authenticated can select auto_publish_settings"
  on public.auto_publish_settings;
create policy "Authenticated can select auto_publish_settings"
  on public.auto_publish_settings
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated can update auto_publish_settings"
  on public.auto_publish_settings;
create policy "Authenticated can update auto_publish_settings"
  on public.auto_publish_settings
  for update
  to authenticated
  using (id = 'default')
  with check (id = 'default');

-- ============================================================
-- 4) publish_runs (하루 1회 실행 기록)
-- ============================================================

create table if not exists public.publish_runs (
  id uuid primary key default gen_random_uuid(),
  -- 한국 시간(Asia/Seoul) 기준 날짜. unique라서 같은 날 두 번째 실행은 막힌다.
  run_date date not null,
  requested_limit integer not null,
  published_count integer not null default 0,
  failed_count integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint publish_runs_run_date_key unique (run_date)
);

alter table public.publish_runs enable row level security;

-- 공개 함수는 호출한 사용자 권한(security invoker)으로 실행되므로, 로그인
-- 사용자에게 조회·기록·갱신을 허용한다. 삭제 정책은 두지 않는다(실행 기록 보존).
drop policy if exists "Authenticated can select publish_runs" on public.publish_runs;
create policy "Authenticated can select publish_runs"
  on public.publish_runs
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated can insert publish_runs" on public.publish_runs;
create policy "Authenticated can insert publish_runs"
  on public.publish_runs
  for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated can update publish_runs" on public.publish_runs;
create policy "Authenticated can update publish_runs"
  on public.publish_runs
  for update
  to authenticated
  using (true)
  with check (true);

-- ============================================================
-- 5) publish_queued_landing_pages(p_limit)
-- ============================================================

-- ready 상태 대기열 항목을 오래된 순(created_at, id)으로 최대 p_limit개 골라
-- landing_pages(status='public', published_at=now()) + SEO 설정 + FAQ를 만들고
-- 대기열 항목을 published로 바꾼다. 함수 호출 전체가 한 트랜잭션이다.
--
-- - 같은 KST 날짜에 이미 실행 기록이 있으면 아무것도 바꾸지 않고
--   status='already_ran'을 돌려준다(동시에 두 번 호출돼도 unique 제약으로 한 번만 실행).
-- - for update skip locked: 다른 트랜잭션이 잡고 있는 행은 건너뛴다.
-- - slug가 이미 landing_pages에 있으면(충돌) 그 행만 failed로 바꾸고
--   validation_errors에 사유를 남긴 뒤 다음 행으로 넘어간다.
-- - 그 밖의 예상하지 못한 오류는 다시 던진다 → 트랜잭션 전체가 롤백되고
--   실행 기록도 남지 않으므로, 원인을 고친 뒤 같은 날 다시 실행할 수 있다.
-- - auto_publish_settings.enabled는 여기서 보지 않는다. 자동 실행(크론)
--   쪽에서 설정을 확인하고 daily_limit를 p_limit로 넘긴다.
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

-- 실행 권한: 로그인 사용자(authenticated)와 소유자(postgres)만.
-- Supabase는 public 스키마의 새 함수에 anon/authenticated/service_role 실행
-- 권한을 기본으로 주므로, 기본 PUBLIC 권한과 함께 명시적으로 회수한다.
revoke all on function public.publish_queued_landing_pages(integer) from public;
revoke all on function public.publish_queued_landing_pages(integer) from anon;
revoke all on function public.publish_queued_landing_pages(integer) from service_role;
grant execute on function public.publish_queued_landing_pages(integer) to authenticated;
