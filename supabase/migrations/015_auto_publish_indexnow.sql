-- 대량 공개(bulk publish) 6단계: 매일 자동 공개 래퍼 함수 + IndexNow 전송 기록
-- Supabase Dashboard > SQL Editor 에서 실행한다. (001~014를 먼저 실행한 상태여야 한다)
-- 기존 migration(001~014)은 수정하지 않는다.
-- 되돌리기: supabase/rollback/015_down.sql
--
-- pg_cron 등록은 이 파일에 넣지 않는다 — 운영에서 pg_cron 확장이 꺼져 있어도
-- 이 migration은 실패하지 않아야 하므로, 매일 실행 등록은
-- supabase/manual/015_cron_schedule.sql 을 따로 실행한다(HANDOFF.md 참고).

-- ============================================================
-- 1) 자동 공개 설정·실행 기록 보강
-- ============================================================

-- 관리자 화면에서 고르는 하루 개수는 1~100(기본 50). 013의 1~1000 제약을 좁힌다.
alter table public.auto_publish_settings
  drop constraint if exists auto_publish_settings_daily_limit_check;
alter table public.auto_publish_settings
  add constraint auto_publish_settings_daily_limit_check
  check (daily_limit >= 1 and daily_limit <= 100);

-- 실행 기록에 누가 실행했는지(매일 자동 / 관리자가 지금 실행) 남긴다. 기존 기록은 null.
alter table public.publish_runs
  add column if not exists trigger text check (trigger in ('cron', 'manual'));

-- ============================================================
-- 2) run_auto_publish(p_manual): 설정을 읽어 공개 함수를 부르는 래퍼
-- ============================================================

-- - p_manual = false(매일 pg_cron): auto_publish_settings.enabled 가 true일 때만 실행
-- - p_manual = true(관리자 '지금 1회 실행'): 켜짐/꺼짐과 관계없이 실행
-- 어느 쪽이든 하루 개수는 daily_limit, 같은 KST 날짜 중복 실행은 공개 함수가 막는다.
create or replace function public.run_auto_publish(p_manual boolean default false)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_limit integer;
  v_result jsonb;
begin
  select enabled, daily_limit into v_enabled, v_limit
  from public.auto_publish_settings
  where id = 'default';

  if not found then
    return jsonb_build_object('status', 'no_settings');
  end if;

  if not p_manual and not v_enabled then
    return jsonb_build_object('status', 'disabled');
  end if;

  v_result := public.publish_queued_landing_pages(v_limit);

  if v_result ->> 'status' = 'ok' then
    update public.publish_runs
    set trigger = case when p_manual then 'manual' else 'cron' end
    where run_date = (v_result ->> 'run_date')::date;
  end if;

  return v_result || jsonb_build_object(
    'trigger', case when p_manual then 'manual' else 'cron' end,
    'daily_limit', v_limit
  );
end;
$$;

revoke all on function public.run_auto_publish(boolean) from public;
revoke all on function public.run_auto_publish(boolean) from anon;
revoke all on function public.run_auto_publish(boolean) from service_role;
grant execute on function public.run_auto_publish(boolean) to authenticated;

-- ============================================================
-- 3) IndexNow 전송 기록
-- ============================================================

-- 페이지별 "검색엔진에 알린 시각". landing_pages에 컬럼을 두지 않는 이유:
-- landing_pages의 updated_at 트리거가 함께 바뀌어 sitemap lastmod가 거짓으로
-- 갱신되기 때문이다. 페이지가 삭제되면 기록도 함께 지워진다.
create table if not exists public.indexnow_page_status (
  landing_page_id uuid primary key references public.landing_pages(id) on delete cascade,
  sent_at timestamptz not null default now()
);

-- 전송 시도 기록(성공·실패 모두). 실패한 페이지는 page_status에 남지 않으므로
-- 다음 전송 때 자동으로 다시 대상이 된다(재시도).
create table if not exists public.indexnow_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  trigger text not null check (trigger in ('admin', 'cron', 'manual')),
  url_count integer not null,
  success boolean not null,
  status_code integer,
  error text check (char_length(error) <= 1000)
);

create index if not exists indexnow_submissions_created_at_idx
  on public.indexnow_submissions (created_at desc);

alter table public.indexnow_page_status enable row level security;
alter table public.indexnow_submissions enable row level security;

-- 로그인 사용자는 조회만 가능하다. 쓰기는 아래 함수로만 한다(anon 정책 없음).
drop policy if exists "Authenticated can select indexnow_page_status" on public.indexnow_page_status;
create policy "Authenticated can select indexnow_page_status"
  on public.indexnow_page_status
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated can select indexnow_submissions" on public.indexnow_submissions;
create policy "Authenticated can select indexnow_submissions"
  on public.indexnow_submissions
  for select
  to authenticated
  using (true);

-- ============================================================
-- 4) IndexNow 대상 조회·결과 기록 함수
-- ============================================================

-- 이 프로젝트는 Service Role Key를 쓰지 않는다. 그래서 로그인 세션이 없는
-- 예약 호출(/api/indexnow + CRON_SECRET)도 anon 키로 아래 두 함수만 부를 수
-- 있게 하고, 함수 안에서 호출자를 확인한다(security definer).
--   - 로그인 사용자(authenticated 역할): 그대로 허용
--   - 그 밖(anon): p_secret 이 Supabase Vault의 'indexnow_cron_secret' 값과
--     같을 때만 허용. Vault 값은 supabase/manual/015_cron_schedule.sql 안내대로 등록한다.
create or replace function public.indexnow_caller_allowed(p_secret text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if current_setting('role', true) = 'authenticated' then
    return true;
  end if;
  if p_secret is null or char_length(p_secret) < 16 then
    return false;
  end if;
  return exists (
    select 1 from vault.decrypted_secrets
    where name = 'indexnow_cron_secret' and decrypted_secret = p_secret
  );
end;
$$;

revoke all on function public.indexnow_caller_allowed(text) from public;
revoke all on function public.indexnow_caller_allowed(text) from anon;
revoke all on function public.indexnow_caller_allowed(text) from authenticated;
revoke all on function public.indexnow_caller_allowed(text) from service_role;

-- 아직 알리지 않은 공개 페이지: 공개 중(status=public), 대기열에서 공개됨
-- (published_at 있음), noindex 아님, indexnow_page_status 기록 없음.
create or replace function public.indexnow_pending_pages(p_secret text default null, p_limit integer default 10000)
returns table (landing_page_id uuid, slug text, published_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.indexnow_caller_allowed(p_secret) then
    raise exception 'IndexNow 대상 조회 권한이 없습니다.' using errcode = '42501';
  end if;

  return query
  select lp.id, lp.slug, lp.published_at
  from public.landing_pages lp
  where lp.status = 'public'
    and lp.published_at is not null
    and not exists (
      select 1 from public.landing_page_seo_settings s
      where s.landing_page_id = lp.id and s.seo_noindex
    )
    and not exists (
      select 1 from public.indexnow_page_status st
      where st.landing_page_id = lp.id
    )
  order by lp.published_at, lp.id
  limit greatest(1, least(coalesce(p_limit, 10000), 10000));
end;
$$;

-- 전송 결과 기록. 성공이면 해당 페이지들을 "알림 완료"로 표시한다.
create or replace function public.indexnow_record_submission(
  p_secret text,
  p_page_ids uuid[],
  p_success boolean,
  p_status_code integer,
  p_error text,
  p_trigger text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.indexnow_caller_allowed(p_secret) then
    raise exception 'IndexNow 결과 기록 권한이 없습니다.' using errcode = '42501';
  end if;

  insert into public.indexnow_submissions (trigger, url_count, success, status_code, error)
  values (p_trigger, coalesce(cardinality(p_page_ids), 0), p_success, p_status_code, left(p_error, 1000));

  if p_success then
    insert into public.indexnow_page_status (landing_page_id, sent_at)
    select lp.id, now()
    from public.landing_pages lp
    where lp.id = any(p_page_ids)
    on conflict (landing_page_id) do update set sent_at = excluded.sent_at;
  end if;
end;
$$;

revoke all on function public.indexnow_pending_pages(text, integer) from public;
revoke all on function public.indexnow_record_submission(text, uuid[], boolean, integer, text, text) from public;
revoke all on function public.indexnow_pending_pages(text, integer) from service_role;
revoke all on function public.indexnow_record_submission(text, uuid[], boolean, integer, text, text) from service_role;
grant execute on function public.indexnow_pending_pages(text, integer) to anon, authenticated;
grant execute on function public.indexnow_record_submission(text, uuid[], boolean, integer, text, text) to anon, authenticated;
