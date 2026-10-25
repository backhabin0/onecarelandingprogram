/**
 * 6단계: 매일 자동 공개 래퍼(run_auto_publish), pg_cron 등록 SQL, IndexNow 전송 대상·재시도,
 * /api/indexnow 인증. 컴퓨터 안 Postgres(PGlite, migration 001~015)로 검증하고
 * IndexNow 외부 호출은 가짜 fetch로 대신한다. 실제 Supabase·검색엔진에는 연결하지 않는다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite, PGliteInterface } from "@electric-sql/pglite";
import { NextRequest } from "next/server";
import { asRole, createMigratedDb, readMigration, readRollback } from "./helpers/pglite-db";
import { PgliteSupabase } from "./helpers/pglite-supabase";
import { setFakeSupabase } from "./helpers/current-supabase";
import * as auth from "@/lib/auth";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const autoPublish = await import("@/lib/auto-publish");
const indexnow = await import("@/lib/indexnow");
const { GET: indexNowRoute } = await import("@/app/api/indexnow/route");

const KEY = "d8480180f2798f02382139f1dfd53952";
const CRON_SECRET = "cron-secret-for-tests-0123456789";

let base: PGlite;
let db: PGliteInterface;
let client: PgliteSupabase;

beforeAll(async () => {
  base = await createMigratedDb();
}, 60_000);

afterAll(async () => {
  await base.close();
});

beforeEach(async () => {
  db = await base.clone();
  client = setFakeSupabase(new PgliteSupabase(db));
  vi.stubEnv("INDEXNOW_KEY", KEY);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://onecare.example");
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function seedQueue(n: number) {
  await db.query(
    `insert into public.landing_page_queue
       (region, keyword, region_slug, keyword_slug, business_name, title, slug, source, state, created_at)
     select '지역' || i, '헬스장', 'region-' || i, 'gym', '업체', '제목 ' || i, 'region-' || i || '-gym',
            'excel', 'ready', timestamptz '2026-10-01' + make_interval(secs => i)
       from generate_series(0, $1::int - 1) as i`,
    [n]
  );
}

async function setSettings(enabled: boolean, dailyLimit: number) {
  await db.query("update public.auto_publish_settings set enabled = $1, daily_limit = $2", [enabled, dailyLimit]);
}

async function runAsAuthenticated(manual: boolean) {
  return asRole(db, "authenticated", async (tx) => {
    const { rows } = await tx.query<{ r: Record<string, unknown> }>("select public.run_auto_publish($1) r", [manual]);
    return rows[0].r;
  });
}

const count = async (sql: string) => Number((await db.query<{ n: number }>(sql)).rows[0].n);

describe("migration 015 스키마", () => {
  it("하루 개수 제약 1~100, 실행 기록에 trigger 컬럼", async () => {
    await expect(db.query("update public.auto_publish_settings set daily_limit = 101")).rejects.toThrow(/daily_limit_check/);
    await expect(db.query("update public.auto_publish_settings set daily_limit = 0")).rejects.toThrow(/daily_limit_check/);
    await db.query("update public.auto_publish_settings set daily_limit = 100");
    const col = await db.query("select 1 from information_schema.columns where table_name = 'publish_runs' and column_name = 'trigger'");
    expect(col.rows).toHaveLength(1);
  });

  it("015_down 후 015 다시 적용 가능, 013의 1~1000 제약으로 돌아감", async () => {
    await db.exec(readRollback("015_down.sql"));
    await db.query("update public.auto_publish_settings set daily_limit = 500");
    await db.query("update public.auto_publish_settings set daily_limit = 50");
    expect((await db.query("select 1 from pg_proc where proname like 'indexnow%' or proname = 'run_auto_publish'")).rows).toEqual([]);
    await db.exec(readMigration("015_auto_publish_indexnow.sql"));
  });
});

describe("run_auto_publish 래퍼", () => {
  it("자동(enabled=false)이면 아무것도 하지 않는다 — 공개·실행 기록 모두 없음", async () => {
    await seedQueue(10);
    await setSettings(false, 50);
    expect(await runAsAuthenticated(false)).toEqual({ status: "disabled" });
    expect(await count("select count(*) n from public.landing_page_queue where state = 'ready'")).toBe(10);
    expect(await count("select count(*) n from public.publish_runs")).toBe(0);
  });

  it("자동(enabled=true)이면 하루 개수만큼 공개, trigger=cron, 같은 날 두 번째는 차단", async () => {
    await seedQueue(20);
    await setSettings(true, 7);
    const result = await runAsAuthenticated(false);
    expect(result).toMatchObject({ status: "ok", published: 7, failed: 0, trigger: "cron", daily_limit: 7 });
    expect(await count("select count(*) n from public.landing_page_queue where state = 'ready'")).toBe(13);
    const run = await db.query("select requested_limit, published_count, trigger from public.publish_runs");
    expect(run.rows).toEqual([{ requested_limit: 7, published_count: 7, trigger: "cron" }]);

    expect(await runAsAuthenticated(false)).toMatchObject({ status: "already_ran", published: 0 });
    expect(await runAsAuthenticated(true)).toMatchObject({ status: "already_ran" });
    expect(await count("select count(*) n from public.landing_page_queue where state = 'ready'")).toBe(13);
  });

  it("'지금 1회 실행'(manual)은 꺼져 있어도 실행, trigger=manual", async () => {
    await seedQueue(5);
    await setSettings(false, 3);
    expect(await runAsAuthenticated(true)).toMatchObject({ status: "ok", published: 3, trigger: "manual" });
    expect((await db.query("select trigger from public.publish_runs")).rows).toEqual([{ trigger: "manual" }]);
  });

  it("pg_cron(postgres 역할)으로도 실행되고, anon·service_role은 실행 권한 없음", async () => {
    await seedQueue(2);
    await setSettings(true, 50);
    const owner = await db.query<{ r: { status: string; published: number } }>("select public.run_auto_publish(false) r");
    expect(owner.rows[0].r).toMatchObject({ status: "ok", published: 2 });
    for (const role of ["anon", "service_role"] as const) {
      await expect(asRole(db, role, (tx) => tx.query("select public.run_auto_publish(true)"))).rejects.toThrow(/permission denied/);
    }
  });
});

describe("매일 실행 등록 SQL(supabase/manual/015_cron_schedule.sql)", () => {
  it("여러 번 실행해도 작업 1개(매일 00:00 UTC), 등록된 명령이 래퍼를 부른다", async () => {
    // PGlite에는 pg_cron이 없어 cron 스키마를 흉내 낸다(확장 생성 줄만 빼고 그대로 실행).
    await db.exec(`
      create schema cron;
      create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
      create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as
        $$ insert into cron.job (jobname, schedule, command) values (job_name, schedule, command) returning jobid $$;
      create function cron.unschedule(job_id bigint) returns boolean language sql as
        $$ delete from cron.job where jobid = job_id returning true $$;
    `);
    const sql = readFileSync(join(__dirname, "..", "supabase", "manual", "015_cron_schedule.sql"), "utf8").replace(
      "create extension if not exists pg_cron with schema pg_catalog;",
      ""
    );
    await db.exec(sql);
    await db.exec(sql);
    const jobs = await db.query<{ jobname: string; schedule: string; command: string }>(
      "select jobname, schedule, command from cron.job"
    );
    expect(jobs.rows).toEqual([
      { jobname: "onecare-daily-auto-publish", schedule: "0 0 * * *", command: "select public.run_auto_publish(false)" },
    ]);

    await seedQueue(3);
    await setSettings(true, 2);
    await db.exec(jobs.rows[0].command);
    expect(await count("select count(*) n from public.landing_pages where published_at is not null")).toBe(2);
  });
});

describe("앱: 자동 공개 설정·지금 실행(lib/auto-publish)", () => {
  it("설정 저장(1~100), 지금 실행, 최근 실행 기록", async () => {
    await seedQueue(4);
    expect(await autoPublish.updateAutoPublishSettings({ enabled: true, dailyLimit: 101, noindexThinPages: false })).toMatchObject({ success: false });
    expect(await autoPublish.updateAutoPublishSettings({ enabled: false, dailyLimit: 3, noindexThinPages: false })).toEqual({ success: true });
    expect(await autoPublish.getAutoPublishSettings()).toEqual({ data: { enabled: false, dailyLimit: 3, noindexThinPages: false }, error: null });

    expect(await autoPublish.runAutoPublishNow()).toEqual({
      success: true,
      status: "ok",
      published: 3,
      failed: 0,
      error: undefined,
    });
    expect(await autoPublish.runAutoPublishNow()).toMatchObject({ success: true, status: "already_ran", published: 0 });

    const runs = await autoPublish.getRecentPublishRuns(10);
    expect(runs.error).toBeNull();
    expect(runs.data).toHaveLength(1);
    expect(runs.data[0]).toMatchObject({ published_count: 3, failed_count: 0, trigger: "manual" });
  });
});

// ------------------------------------------------------------
// IndexNow
// ------------------------------------------------------------

/** 공개 페이지 여러 종류를 만든다. 대상이 되는 것: published-a, published-b */
async function seedPages() {
  const insert = (slug: string, status: string, publishedAt: string | null) =>
    db.query<{ id: string }>(
      `insert into public.landing_pages (business_name, title, slug, status, published_at)
       values ('업체', '제목', $1, $2, $3) returning id`,
      [slug, status, publishedAt]
    );
  const a = (await insert("published-a", "public", "2026-10-23T00:00:01Z")).rows[0].id;
  const b = (await insert("published-b", "public", "2026-10-23T00:00:02Z")).rows[0].id;
  await insert("manual-page", "public", null); // 관리자가 직접 만든 페이지(대기열 공개 아님)
  await insert("private-page", "private", "2026-10-23T00:00:03Z");
  const noindex = (await insert("noindex-page", "public", "2026-10-23T00:00:04Z")).rows[0].id;
  await db.query("insert into public.landing_page_seo_settings (landing_page_id, seo_noindex) values ($1, true)", [noindex]);
  return { a, b };
}

function fakeFetch(...statuses: (number | Error)[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const next = statuses[Math.min(i, statuses.length - 1)];
    i += 1;
    if (next instanceof Error) throw next;
    return new Response(next === 200 || next === 202 ? "" : "too many", { status: next });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const pendingSlugs = async () =>
  ((await client.rpc("indexnow_pending_pages", { p_secret: null, p_limit: 100 })).data as { slug: string }[]).map((p) => p.slug);

describe("IndexNow 키 파일(public/{key}.txt)", () => {
  it("파일 이름과 내용이 같은 키이고, 키 형식(영문·숫자·하이픈 8~128자)에 맞는다", async () => {
    const { readdirSync } = await import("node:fs");
    const publicDir = join(__dirname, "..", "public");
    const keyFiles = readdirSync(publicDir).filter((name) => /^[A-Za-z0-9-]{8,128}\.txt$/.test(name));
    expect(keyFiles).toEqual([`${KEY}.txt`]);
    expect(readFileSync(join(publicDir, keyFiles[0]), "utf8")).toBe(KEY);
  });
});

describe("IndexNow 전송 대상", () => {
  it("공개 중 + 대기열에서 공개(published_at) + noindex 아님 + 아직 안 보냄", async () => {
    await seedPages();
    expect(await pendingSlugs()).toEqual(["published-a", "published-b"]);
  });
});

describe("IndexNow 전송(외부 호출은 가짜)", () => {
  it("네이버 IndexNow 엔드포인트로 공식 형식(host·key·keyLocation·urlList) POST, 성공하면 다음 대상에서 빠진다", async () => {
    await seedPages();
    const { fn, calls } = fakeFetch(200);
    const result = await indexnow.submitPendingToIndexNow({ supabase: client as never, trigger: "manual", fetchImpl: fn });

    expect(result).toEqual({ status: "sent", urlCount: 2, statusCode: 200 });
    expect(calls).toEqual([
      {
        url: "https://searchadvisor.naver.com/indexnow",
        body: {
          host: "onecare.example",
          key: KEY,
          keyLocation: `https://onecare.example/${KEY}.txt`,
          urlList: ["https://onecare.example/published-a", "https://onecare.example/published-b"],
        },
      },
    ]);
    expect(await pendingSlugs()).toEqual([]);
    const log = await db.query("select trigger, url_count, success, status_code, error from public.indexnow_submissions");
    expect(log.rows).toEqual([{ trigger: "manual", url_count: 2, success: true, status_code: 200, error: null }]);

    // 보낼 것이 없으면 호출하지 않는다
    const again = await indexnow.submitPendingToIndexNow({ supabase: client as never, trigger: "manual", fetchImpl: fn });
    expect(again).toEqual({ status: "nothing", urlCount: 0 });
    expect(calls).toHaveLength(1);
  });

  it("202(키 확인 대기)도 성공으로 본다", async () => {
    await seedPages();
    const { fn } = fakeFetch(202);
    expect((await indexnow.submitPendingToIndexNow({ supabase: client as never, trigger: "admin", fetchImpl: fn })).status).toBe("sent");
  });

  it("실패(429·네트워크 오류)하면 공개에는 영향 없이 기록만 남고, 다음 전송 때 다시 보낸다(재시도)", async () => {
    await seedPages();
    const { fn, calls } = fakeFetch(429, new Error("network down"), 200);

    const first = await indexnow.submitPendingToIndexNow({ supabase: client as never, trigger: "cron", fetchImpl: fn });
    expect(first).toMatchObject({ status: "failed", urlCount: 2, statusCode: 429 });
    expect(first.message).toMatch(/HTTP 429/);
    expect(await pendingSlugs()).toEqual(["published-a", "published-b"]);

    const second = await indexnow.submitPendingToIndexNow({ supabase: client as never, trigger: "cron", fetchImpl: fn });
    expect(second).toMatchObject({ status: "failed", statusCode: null, message: "network down" });

    const third = await indexnow.submitPendingToIndexNow({ supabase: client as never, trigger: "cron", fetchImpl: fn });
    expect(third.status).toBe("sent");
    expect(calls.map((c) => (c.body.urlList as string[]).length)).toEqual([2, 2, 2]);
    expect(await pendingSlugs()).toEqual([]);

    const log = await db.query<{ success: boolean; status_code: number | null }>("select success, status_code from public.indexnow_submissions order by created_at, success");
    expect(log.rows.map((r) => r.success)).toEqual([false, false, true]);
    // 공개된 페이지는 그대로
    expect(await count("select count(*) n from public.landing_pages where status = 'public'")).toBe(4);
  });

  it("키가 없거나 형식이 틀리거나, 사이트 주소가 localhost/http면 보내지 않는다", async () => {
    await seedPages();
    const { fn, calls } = fakeFetch(200);
    for (const [env, value] of [
      ["INDEXNOW_KEY", ""],
      ["INDEXNOW_KEY", "short"],
      ["INDEXNOW_KEY", "has space key 123"],
    ] as const) {
      vi.stubEnv(env, value);
      expect((await indexnow.submitPendingToIndexNow({ supabase: client as never, trigger: "manual", fetchImpl: fn })).status).toBe(
        "not_configured"
      );
    }
    vi.stubEnv("INDEXNOW_KEY", KEY);
    for (const site of ["http://localhost:3000", "http://onecare.example"]) {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", site);
      expect(indexnow.getIndexNowConfig().ok).toBe(false);
    }
    expect(calls).toEqual([]);
    expect(await pendingSlugs()).toEqual(["published-a", "published-b"]);
  });

  it("관리자 화면 자동 전송은 최근 10분 안에 실패했으면 쉬어 간다", async () => {
    await seedPages();
    const { fn, calls } = fakeFetch(429, 200);
    await indexnow.submitPendingToIndexNow({ supabase: client as never, trigger: "admin", fetchImpl: fn });
    expect(await indexnow.autoSubmitIndexNow(client as never, fn)).toBeNull();
    expect(calls).toHaveLength(1);

    const last = Date.now();
    expect(await indexnow.shouldAutoSubmit(client as never, last + 9 * 60 * 1000)).toBe(false);
    expect(await indexnow.shouldAutoSubmit(client as never, last + 11 * 60 * 1000)).toBe(true);

    await db.query("update public.indexnow_submissions set created_at = now() - interval '11 minutes'");
    expect(await indexnow.autoSubmitIndexNow(client as never, fn)).toMatchObject({ status: "sent" });
  });

  it("설정 화면용 상태: 설정 여부, 남은 개수, 최근 기록", async () => {
    await seedPages();
    const status = await indexnow.getIndexNowStatus(client as never);
    expect(status).toMatchObject({ pendingCount: 2, recent: [], error: null });
    expect(status.config).toEqual({
      ok: true,
      key: KEY,
      host: "onecare.example",
      keyLocation: `https://onecare.example/${KEY}.txt`,
    });
  });
});

describe("IndexNow 권한(로그인 없이 부르는 예약 호출)", () => {
  it("anon은 비밀값이 없거나 틀리면 거부, Vault의 값과 같으면 허용. 테이블은 직접 못 읽음", async () => {
    await seedPages();
    const anon = new PgliteSupabase(db, "anon");
    expect((await anon.rpc("indexnow_pending_pages", { p_secret: null, p_limit: 10 })).error?.code).toBe("42501");
    expect((await anon.rpc("indexnow_pending_pages", { p_secret: CRON_SECRET, p_limit: 10 })).error?.code).toBe("42501");

    await db.query("select vault.create_secret($1, 'indexnow_cron_secret')", [CRON_SECRET]);
    expect((await anon.rpc("indexnow_pending_pages", { p_secret: "wrong-secret-0123456789", p_limit: 10 })).error?.code).toBe(
      "42501"
    );
    const ok = await anon.rpc("indexnow_pending_pages", { p_secret: CRON_SECRET, p_limit: 10 });
    expect((ok.data as { slug: string }[]).map((p) => p.slug)).toEqual(["published-a", "published-b"]);

    const { fn } = fakeFetch(200);
    const sent = await indexnow.submitPendingToIndexNow({ supabase: anon as never, trigger: "cron", secret: CRON_SECRET, fetchImpl: fn });
    expect(sent.status).toBe("sent");

    expect((await anon.from("indexnow_submissions").select("*")).data).toEqual([]);
    expect((await anon.from("indexnow_page_status").select("*")).data).toEqual([]);
    expect((await anon.rpc("indexnow_record_submission", {
      p_secret: null, p_page_ids: [], p_success: true, p_status_code: 200, p_error: null, p_trigger: "cron",
    })).error?.code).toBe("42501");
  });
});

describe("/api/indexnow 라우트", () => {
  const request = (authorization?: string) =>
    new NextRequest("https://onecare.example/api/indexnow", {
      headers: authorization ? { authorization } : {},
    });

  it("로그인도 CRON_SECRET도 없으면 401", async () => {
    vi.spyOn(auth, "getCurrentUser").mockResolvedValue(null);
    const response = await indexNowRoute(request("Bearer wrong"));
    expect(response.status).toBe(401);
  });

  it("CRON_SECRET(Bearer)이면 로그인 없이 anon + Vault 비밀값으로 전송(trigger=cron)", async () => {
    vi.spyOn(auth, "getCurrentUser").mockResolvedValue(null);
    await seedPages();
    await db.query("select vault.create_secret($1, 'indexnow_cron_secret')", [CRON_SECRET]);
    setFakeSupabase(new PgliteSupabase(db, "anon"));
    const { fn } = fakeFetch(200);
    vi.stubGlobal("fetch", fn);

    const response = await indexNowRoute(request(`Bearer ${CRON_SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, status: "sent", urlCount: 2 });
    expect((await db.query("select trigger from public.indexnow_submissions")).rows).toEqual([{ trigger: "cron" }]);
  });

  it("로그인한 관리자는 비밀값 없이 전송(trigger=manual), 전송 실패는 502", async () => {
    await seedPages();
    vi.stubGlobal("fetch", fakeFetch(500).fn);
    const response = await indexNowRoute(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ success: false, status: "failed" });
    expect((await db.query("select trigger, success from public.indexnow_submissions")).rows).toEqual([
      { trigger: "manual", success: false },
    ]);
  });
});
