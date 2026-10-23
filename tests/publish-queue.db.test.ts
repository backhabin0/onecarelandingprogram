/**
 * 013_publish_queue.sql을 컴퓨터 안의 Postgres(PGlite)에 실제로 적용해서 검증한다.
 * 실제 Supabase에는 연결하지 않는다(tests/helpers/pglite-db.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite, PGliteInterface } from "@electric-sql/pglite";
import { asRole, createMigratedDb, readMigration, readRollback } from "./helpers/pglite-db";

interface PublishResult {
  status: "ok" | "already_ran";
  run_date: string;
  published: number;
  failed: number;
  published_ids: string[];
  failed_ids: string[];
}

const EXISTING_PAGES = [
  { slug: "existing-a", status: "public" },
  { slug: "existing-b", status: "private" },
  { slug: "existing-c", status: "public" },
];

/** 기존(관리자가 직접 만든) 랜딩페이지 + SEO + FAQ를 넣는다. created/updated_at은 과거로 고정. */
async function seedExistingPages(db: PGliteInterface) {
  for (const [i, page] of EXISTING_PAGES.entries()) {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.landing_pages
         (business_name, title, slug, phone, template, status, created_at, updated_at)
       values ($1, $2, $3, '010-0000-0000', 'template-b', $4,
               '2026-01-0${i + 1}T00:00:00Z', '2026-02-0${i + 1}T00:00:00Z')
       returning id`,
      [`기존 업체 ${i}`, `기존 페이지 ${i}`, page.slug, page.status]
    );
    await db.query(
      `insert into public.landing_page_seo_settings (landing_page_id, seo_title) values ($1, $2)`,
      [rows[0].id, `기존 SEO ${i}`]
    );
    await db.query(
      `insert into public.landing_page_faqs (landing_page_id, question, answer) values ($1, '기존 질문', '기존 답변')`,
      [rows[0].id]
    );
  }
}

async function snapshotExisting(db: PGliteInterface) {
  const slugs = EXISTING_PAGES.map((p) => p.slug);
  const pages = await db.query(
    `select * from public.landing_pages where slug = any($1) order by slug`,
    [slugs]
  );
  const seo = await db.query(
    `select s.* from public.landing_page_seo_settings s
       join public.landing_pages lp on lp.id = s.landing_page_id
      where lp.slug = any($1) order by lp.slug`,
    [slugs]
  );
  const faqs = await db.query(
    `select f.* from public.landing_page_faqs f
       join public.landing_pages lp on lp.id = f.landing_page_id
      where lp.slug = any($1) order by lp.slug`,
    [slugs]
  );
  return { pages: pages.rows, seo: seo.rows, faqs: faqs.rows };
}

interface QueueSeed {
  slug?: (i: number) => string;
  state?: string;
}

/** 대기열 n개. i가 작을수록 오래된 항목(created_at이 이르다). */
async function seedQueue(db: PGliteInterface, n: number, options: QueueSeed = {}, offset = 0) {
  for (let k = 0; k < n; k += 1) {
    const i = k + offset;
    await db.query(
      `insert into public.landing_page_queue
         (region, keyword, region_slug, keyword_slug, business_name, title, slug,
          hero_text, phone, seo_title, seo_description, service_area, business_category,
          faqs, source, state, priority, created_at)
       values ($1, '헬스장', $2, 'gym', $3, $4, $5, '대표 문구', '010-1111-2222',
               $6, '설명', $1, '헬스장', $7::jsonb, 'ai', $8, $9,
               timestamptz '2026-10-01T00:00:00Z' + make_interval(secs => $10))`,
      [
        `지역${i}`,
        `region-${i}`,
        `업체 ${i}`,
        `지역${i} 헬스장`,
        options.slug ? options.slug(i) : `region-${i}-gym`,
        `지역${i} 헬스장 SEO`,
        JSON.stringify([
          { question: `지역${i} 주차 되나요?`, answer: "네" },
          { question: "가격은?", answer: "상담 시 안내" },
        ]),
        options.state ?? "ready",
        // priority는 공개 순서에 쓰지 않는다(오래된 순). 최신 항목일수록 높게 넣어서 확인.
        i,
        i,
      ]
    );
  }
}

async function publish(db: PGliteInterface, limit: number): Promise<PublishResult> {
  return asRole(db, "authenticated", async (tx) => {
    const { rows } = await tx.query<{ result: PublishResult }>(
      "select public.publish_queued_landing_pages($1) as result",
      [limit]
    );
    return rows[0].result;
  });
}

async function countBy(db: PGliteInterface, sql: string, params: unknown[] = []) {
  const { rows } = await db.query<{ n: number }>(sql, params);
  return Number(rows[0].n);
}

const kstToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

let base: PGlite;
let db: PGliteInterface;

beforeAll(async () => {
  base = await createMigratedDb();
  await seedExistingPages(base);
}, 60_000);

afterAll(async () => {
  await base.close();
});

beforeEach(async () => {
  db = await base.clone();
});

describe("migration 013 스키마", () => {
  it("001~013이 순서대로 오류 없이 적용된다", async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' order by table_name`
    );
    expect(rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining(["landing_page_queue", "auto_publish_settings", "publish_runs"])
    );
  });

  it("새 테이블 3개 모두 RLS가 켜져 있고 anon 정책이 없다", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
        where relname in ('landing_page_queue', 'auto_publish_settings', 'publish_runs')`
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);

    const policies = await db.query<{ tablename: string; roles: string[] }>(
      `select tablename, roles from pg_policies
        where tablename in ('landing_page_queue', 'auto_publish_settings', 'publish_runs')`
    );
    expect(policies.rows.length).toBeGreaterThan(0);
    for (const p of policies.rows) {
      expect(p.roles).toEqual(["authenticated"]);
    }
  });

  it("auto_publish_settings는 기본값(꺼짐, 50개)인 단일 행", async () => {
    const { rows } = await db.query("select id, enabled, daily_limit from public.auto_publish_settings");
    expect(rows).toEqual([{ id: "default", enabled: false, daily_limit: 50 }]);
    await expect(
      db.query("insert into public.auto_publish_settings (id) values ('second')")
    ).rejects.toThrow();
  });

  it("대기열 slug와 (region, keyword)는 중복 불가", async () => {
    await seedQueue(db, 1);
    await expect(seedQueue(db, 1, { slug: () => "other-slug" })).rejects.toThrow(
      /landing_page_queue_region_keyword_key/
    );
    await expect(seedQueue(db, 1, { slug: () => "region-0-gym" }, 5)).rejects.toThrow(
      /landing_page_queue_slug_key/
    );
  });

  it("source·state 값과 FAQ 형식을 DB에서 검사한다", async () => {
    await expect(seedQueue(db, 1, { state: "deleted" })).rejects.toThrow(/check/i);
    const insertFaqs = (faqs: unknown) =>
      db.query(
        `insert into public.landing_page_queue
           (region, keyword, region_slug, keyword_slug, business_name, title, slug, faqs, source)
         values ('r', 'k', 'r', 'k', 'b', 't', 'r-k', $1::jsonb, 'excel')`,
        [JSON.stringify(faqs)]
      );
    await expect(insertFaqs({ question: "q" })).rejects.toThrow(/check/i);
    await expect(insertFaqs([{ question: "q" }])).rejects.toThrow(/check/i);
    await expect(insertFaqs([{ question: " ", answer: "a" }])).rejects.toThrow(/check/i);
    await expect(insertFaqs([{ question: "가".repeat(201), answer: "a" }])).rejects.toThrow(/check/i);
    await expect(insertFaqs([{ question: "q", answer: "가".repeat(2000) }])).resolves.toBeDefined();
  });
});

describe("publish_queued_landing_pages", () => {
  it("대기열 120개, p_limit 50 → 오래된 50개 공개, 70개 대기, published_at 기록", async () => {
    await seedQueue(db, 120);
    const before = await snapshotExisting(db);

    const result = await publish(db, 50);

    expect(result).toMatchObject({ status: "ok", run_date: kstToday(), published: 50, failed: 0 });
    expect(result.published_ids).toHaveLength(50);

    // 대기열 상태
    expect(await countBy(db, "select count(*) n from public.landing_page_queue where state = 'published'")).toBe(50);
    expect(await countBy(db, "select count(*) n from public.landing_page_queue where state = 'ready'")).toBe(70);

    // 오래된 순(region 0~49)으로 공개됨 — priority는 순서에 영향 없음
    const published = await db.query<{ region: string; published_at: Date | null; landing_page_id: string | null }>(
      `select region, published_at, landing_page_id from public.landing_page_queue
        where state = 'published' order by created_at`
    );
    expect(published.rows.map((r) => r.region)).toEqual(
      Array.from({ length: 50 }, (_, i) => `지역${i}`)
    );
    expect(published.rows.every((r) => r.published_at instanceof Date && r.landing_page_id)).toBe(true);

    // 새 랜딩페이지: public + published_at, 대기열 값 그대로
    const pages = await db.query<{
      slug: string; status: string; published_at: Date | null; title: string; template: string; queue_published_at: Date;
    }>(
      `select lp.slug, lp.status, lp.published_at, lp.title, lp.template, q.published_at as queue_published_at
         from public.landing_pages lp
         join public.landing_page_queue q on q.landing_page_id = lp.id`
    );
    expect(pages.rows).toHaveLength(50);
    for (const page of pages.rows) {
      expect(page.status).toBe("public");
      expect(page.published_at).toBeInstanceOf(Date);
      expect(page.published_at?.getTime()).toBe(page.queue_published_at.getTime());
      expect(page.template).toBe("template-a");
    }
    expect(pages.rows.find((p) => p.slug === "region-0-gym")?.title).toBe("지역0 헬스장");

    // SEO 설정 50개, FAQ 100개(순서 0, 1)
    const seo = await db.query<{ seo_title: string; service_area: string; business_category: string }>(
      `select s.seo_title, s.service_area, s.business_category
         from public.landing_page_seo_settings s
         join public.landing_page_queue q on q.landing_page_id = s.landing_page_id
        where q.region = '지역7'`
    );
    expect(seo.rows).toEqual([{ seo_title: "지역7 헬스장 SEO", service_area: "지역7", business_category: "헬스장" }]);
    expect(
      await countBy(db, `select count(*) n from public.landing_page_faqs f
                           join public.landing_page_queue q on q.landing_page_id = f.landing_page_id`)
    ).toBe(100);
    const faqs = await db.query<{ question: string; sort_order: number; is_active: boolean }>(
      `select f.question, f.sort_order, f.is_active from public.landing_page_faqs f
         join public.landing_page_queue q on q.landing_page_id = f.landing_page_id
        where q.region = '지역3' order by f.sort_order`
    );
    expect(faqs.rows).toEqual([
      { question: "지역3 주차 되나요?", sort_order: 0, is_active: true },
      { question: "가격은?", sort_order: 1, is_active: true },
    ]);

    // 실행 기록
    const runs = await db.query<{ run_date: Date; requested_limit: number; published_count: number; failed_count: number; finished_at: Date | null }>(
      "select run_date, requested_limit, published_count, failed_count, finished_at from public.publish_runs"
    );
    expect(runs.rows).toHaveLength(1);
    expect(runs.rows[0]).toMatchObject({ requested_limit: 50, published_count: 50, failed_count: 0 });
    expect(runs.rows[0].finished_at).toBeInstanceOf(Date);

    // 기존 행은 그대로
    expect(await snapshotExisting(db)).toEqual(before);
  });

  it("같은 KST 날짜에 다시 실행하면 막히고 아무것도 바뀌지 않는다", async () => {
    await seedQueue(db, 120);
    await publish(db, 50);
    const pagesBefore = await countBy(db, "select count(*) n from public.landing_pages");

    const second = await publish(db, 50);

    expect(second).toMatchObject({ status: "already_ran", published: 0, failed: 0 });
    expect(await countBy(db, "select count(*) n from public.landing_pages")).toBe(pagesBefore);
    expect(await countBy(db, "select count(*) n from public.landing_page_queue where state = 'ready'")).toBe(70);
    expect(await countBy(db, "select count(*) n from public.publish_runs")).toBe(1);
  });

  it("어제(KST) 실행 기록은 오늘 실행을 막지 않는다", async () => {
    await seedQueue(db, 5);
    await db.query(
      `insert into public.publish_runs (run_date, requested_limit)
       values ((now() at time zone 'Asia/Seoul')::date - 1, 50)`
    );
    const result = await publish(db, 50);
    expect(result).toMatchObject({ status: "ok", published: 5 });
    expect(await countBy(db, "select count(*) n from public.publish_runs")).toBe(2);
  });

  it("대기가 30개면 p_limit 50이어도 30개만 공개", async () => {
    await seedQueue(db, 30);
    const result = await publish(db, 50);
    expect(result).toMatchObject({ status: "ok", published: 30, failed: 0 });
    expect(await countBy(db, "select count(*) n from public.landing_page_queue where state = 'ready'")).toBe(0);
    expect(await countBy(db, "select count(*) n from public.landing_pages where published_at is not null")).toBe(30);
  });

  it("대기 0개여도 실행 기록은 남는다(그날 다시 실행 불가)", async () => {
    const result = await publish(db, 50);
    expect(result).toMatchObject({ status: "ok", published: 0, failed: 0 });
    expect((await publish(db, 50)).status).toBe("already_ran");
  });

  it("slug가 기존 랜딩페이지와 겹치는 행만 failed, 나머지는 공개", async () => {
    // 지역2, 지역5 항목이 기존 페이지 slug와 충돌
    await seedQueue(db, 10, {
      slug: (i) => (i === 2 ? "existing-a" : i === 5 ? "existing-b" : `region-${i}-gym`),
    });
    const before = await snapshotExisting(db);

    const result = await publish(db, 50);

    expect(result).toMatchObject({ status: "ok", published: 8, failed: 2 });
    const failed = await db.query<{ region: string; validation_errors: unknown[]; landing_page_id: string | null; published_at: Date | null }>(
      `select region, validation_errors, landing_page_id, published_at
         from public.landing_page_queue where state = 'failed' order by created_at`
    );
    expect(failed.rows.map((r) => r.region)).toEqual(["지역2", "지역5"]);
    for (const row of failed.rows) {
      expect(row.landing_page_id).toBeNull();
      expect(row.published_at).toBeNull();
      expect(row.validation_errors).toEqual([
        { code: "slug_conflict", fields: ["slug"], message: "이미 사용 중인 URL입니다." },
      ]);
    }
    expect(result.failed_ids).toHaveLength(2);
    const run = await db.query<{ published_count: number; failed_count: number }>(
      "select published_count, failed_count from public.publish_runs"
    );
    expect(run.rows[0]).toEqual({ published_count: 8, failed_count: 2 });

    // 충돌한 기존 페이지는 그대로
    expect(await snapshotExisting(db)).toEqual(before);
  });

  it("실패한 행도 p_limit 개수에 포함된다(그날 고른 N개 중 성공한 것만 공개)", async () => {
    await seedQueue(db, 10, { slug: (i) => (i === 0 ? "existing-c" : `region-${i}-gym`) });
    const result = await publish(db, 5);
    expect(result).toMatchObject({ published: 4, failed: 1 });
    expect(await countBy(db, "select count(*) n from public.landing_page_queue where state = 'ready'")).toBe(5);
  });

  it("ready가 아닌 상태(draft/hold/failed/published)는 건드리지 않는다", async () => {
    await seedQueue(db, 3, { state: "draft" }, 0);
    await seedQueue(db, 3, { state: "hold" }, 10);
    await seedQueue(db, 3, { state: "failed" }, 20);
    await seedQueue(db, 2, { state: "ready" }, 30);
    const result = await publish(db, 50);
    expect(result.published).toBe(2);
    const states = await db.query<{ state: string; n: number }>(
      "select state, count(*)::int n from public.landing_page_queue group by state order by state"
    );
    expect(states.rows).toEqual([
      { state: "draft", n: 3 },
      { state: "failed", n: 3 },
      { state: "hold", n: 3 },
      { state: "published", n: 2 },
    ]);
  });

  it("예상하지 못한 오류면 전체 롤백 — 공개·실행 기록 모두 남지 않고 같은 날 다시 실행 가능", async () => {
    await seedQueue(db, 10);
    // 4번째 항목의 FAQ 저장이 실패하도록 테스트용 트리거를 건다.
    await db.exec(`
      create function public.test_fail_faq() returns trigger language plpgsql as $$
      begin
        if new.question like '지역3 %' then raise exception 'test failure'; end if;
        return new;
      end $$;
      create trigger test_fail_faq before insert on public.landing_page_faqs
        for each row execute function public.test_fail_faq();
    `);

    await expect(publish(db, 50)).rejects.toThrow(/test failure/);
    expect(await countBy(db, "select count(*) n from public.landing_pages where published_at is not null")).toBe(0);
    expect(await countBy(db, "select count(*) n from public.landing_page_queue where state = 'ready'")).toBe(10);
    expect(await countBy(db, "select count(*) n from public.publish_runs")).toBe(0);

    await db.exec("drop trigger test_fail_faq on public.landing_page_faqs");
    expect(await publish(db, 50)).toMatchObject({ status: "ok", published: 10 });
  });

  it.each([0, -1, 1001])("p_limit %i는 거부", async (limit) => {
    await expect(publish(db, limit)).rejects.toThrow(/p_limit/);
    expect(await countBy(db, "select count(*) n from public.publish_runs")).toBe(0);
  });
});

describe("권한", () => {
  it("실행 권한은 authenticated와 postgres만(anon·service_role 거부)", async () => {
    await seedQueue(db, 3);
    for (const role of ["anon", "service_role"] as const) {
      await expect(
        asRole(db, role, (tx) => tx.query("select public.publish_queued_landing_pages(10)"))
      ).rejects.toThrow(/permission denied/);
    }
    const { rows } = await db.query<{ grantee: string }>(
      `select grantee from information_schema.routine_privileges
        where routine_name = 'publish_queued_landing_pages' and privilege_type = 'EXECUTE'
        order by grantee`
    );
    expect(rows.map((r) => r.grantee)).toEqual(["authenticated", "postgres"]);

    // 소유자(postgres)는 실행 가능
    const owner = await db.query<{ r: PublishResult }>("select public.publish_queued_landing_pages(10) r");
    expect(owner.rows[0].r.published).toBe(3);
  });

  it("anon은 새 테이블을 읽지도 쓰지도 못한다", async () => {
    await seedQueue(db, 2);
    await asRole(db, "anon", async (tx) => {
      for (const table of ["landing_page_queue", "auto_publish_settings", "publish_runs"]) {
        const { rows } = await tx.query(`select * from public.${table}`);
        expect(rows).toEqual([]);
      }
    });
    await expect(
      asRole(db, "anon", (tx) =>
        tx.query("insert into public.publish_runs (run_date, requested_limit) values (current_date, 1)")
      )
    ).rejects.toThrow(/row-level security/);
    await expect(
      asRole(db, "anon", (tx) => tx.query("update public.auto_publish_settings set enabled = true returning id"))
    ).resolves.toMatchObject({ rows: [] });
    expect((await db.query("select enabled from public.auto_publish_settings")).rows).toEqual([{ enabled: false }]);
  });

  it("authenticated는 대기열·설정을 관리할 수 있다", async () => {
    await seedQueue(db, 2);
    await asRole(db, "authenticated", async (tx) => {
      expect((await tx.query("select id from public.landing_page_queue")).rows).toHaveLength(2);
      await tx.query("update public.landing_page_queue set state = 'hold'");
      await tx.query("update public.auto_publish_settings set enabled = true, daily_limit = 30");
    });
    expect((await db.query("select enabled, daily_limit from public.auto_publish_settings")).rows).toEqual([
      { enabled: true, daily_limit: 30 },
    ]);
  });
});

describe("기존 데이터 영향 없음", () => {
  it("012까지 적용된 DB에 기존 행이 있을 때 013을 적용해도 기존 값이 그대로다(published_at만 null로 추가)", async () => {
    const old = await createMigratedDb({ upTo: "012" });
    try {
      await seedExistingPages(old);
      const before = await old.query("select * from public.landing_pages order by slug");
      await old.exec(readMigration("013_publish_queue.sql"));
      const after = await old.query<Record<string, unknown>>("select * from public.landing_pages order by slug");

      expect(after.rows).toEqual(before.rows.map((row) => ({ ...(row as object), published_at: null })));
    } finally {
      await old.close();
    }
  });

  it("013을 두 번 적용해도 오류가 없다(재실행 안전)", async () => {
    await db.exec(readMigration("013_publish_queue.sql"));
    expect((await db.query("select count(*)::int n from public.auto_publish_settings")).rows).toEqual([{ n: 1 }]);
  });
});

describe("롤백(013_down.sql)", () => {
  it("013에서 만든 것만 지우고 기존 페이지와 공개된 페이지는 남긴다", async () => {
    await seedQueue(db, 5);
    await publish(db, 50);
    const before = await snapshotExisting(db);

    await db.exec(readRollback("013_down.sql"));

    const tables = await db.query<{ n: number }>(
      `select count(*)::int n from information_schema.tables
        where table_schema = 'public'
          and table_name in ('landing_page_queue', 'auto_publish_settings', 'publish_runs')`
    );
    expect(tables.rows).toEqual([{ n: 0 }]);
    const column = await db.query(
      `select 1 from information_schema.columns
        where table_name = 'landing_pages' and column_name = 'published_at'`
    );
    expect(column.rows).toEqual([]);
    const fn = await db.query(
      "select 1 from pg_proc where proname in ('publish_queued_landing_pages', 'is_valid_queue_faqs')"
    );
    expect(fn.rows).toEqual([]);

    // 기존 3개 + 공개된 5개는 남음(published_at 컬럼만 사라짐)
    expect(await countBy(db, "select count(*) n from public.landing_pages")).toBe(8);
    const after = await snapshotExisting(db);
    expect(after.pages).toEqual(
      before.pages.map((row) => {
        const copy = { ...(row as Record<string, unknown>) };
        delete copy.published_at;
        return copy;
      })
    );
    expect(after.seo).toEqual(before.seo);
    expect(after.faqs).toEqual(before.faqs);

    // 롤백 후 013을 다시 적용할 수 있다
    await db.exec(readMigration("013_publish_queue.sql"));
  });
});
