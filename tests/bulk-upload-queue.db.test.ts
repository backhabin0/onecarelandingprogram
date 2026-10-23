/**
 * 대기열 저장·관리 코드를 컴퓨터 안의 Postgres(PGlite, migration 001~014 적용)에서 검증한다.
 * lib/ 코드는 PgliteSupabase 어댑터를 통해 authenticated 역할로 실제 SQL을 실행한다
 * (RLS·unique·check 제약이 실제처럼 적용됨). 실제 Supabase에는 연결하지 않는다.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite, PGliteInterface } from "@electric-sql/pglite";
import { createMigratedDb, readMigration, readRollback } from "./helpers/pglite-db";
import { PgliteSupabase } from "./helpers/pglite-supabase";
import { setFakeSupabase } from "./helpers/current-supabase";
import type { UploadRow, UploadValues } from "@/lib/bulk-upload/parse";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { enqueueUploadRows } = await import("@/lib/bulk-upload/enqueue");
const { loadBulkCheckContext } = await import("@/lib/bulk-upload/context");
const { getSimilarityThresholds, updateSimilarityThresholds } = await import("@/lib/bulk-publish-settings");
const queue = await import("@/lib/publish-queue");
const { enqueueBulkRowsAction } = await import("@/app/admin/bulk/actions");
const { updateQueueItemAction, deleteQueueItemsAction } = await import("@/app/admin/queue/actions");

const BATCH = "11111111-1111-4111-8111-111111111111";
const LONG_TEXT =
  "역에서 3분 거리에 있는 헬스장입니다. 10년째 운영하며 체형 분석 후 개인별 운동 계획을 세워 드립니다. 첫 상담은 무료입니다.";

function values(i: number, patch: UploadValues = {}): UploadValues {
  return {
    region: `지역${i}`,
    keyword: "헬스장",
    regionSlug: `region-${i}`,
    keywordSlug: "gym",
    businessName: `업체 ${i}`,
    title: `지역${i} 헬스장`,
    heroText: `고유 문구 ${i}`,
    description: `행 ${i} 전용 설명 ${String.fromCharCode(0xac00 + i * 37)}${String.fromCharCode(0xac10 + i * 53)}`,
    faqQuestion1: "주차 되나요?",
    faqAnswer1: "네",
    seoTitle: `지역${i} 헬스장 SEO`,
    mainImageUrl: `https://img.example/${i}.jpg`,
    ...patch,
  };
}

const row = (rowNumber: number, v: UploadValues): UploadRow => ({ rowNumber, values: v, warnings: [] });

let base: PGlite;
let db: PGliteInterface;

beforeAll(async () => {
  base = await createMigratedDb();
}, 60_000);

afterAll(async () => {
  await base.close();
});

beforeEach(async () => {
  db = await base.clone();
  setFakeSupabase(new PgliteSupabase(db));
});

async function queueRows() {
  const { rows } = await db.query<Record<string, unknown>>(
    "select * from public.landing_page_queue order by created_at, slug"
  );
  return rows;
}

async function insertPage(slug: string, title: string, heroText: string, description: string) {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.landing_pages (business_name, title, slug, hero_text, description, status)
     values ('기존 업체', $1, $2, $3, $4, 'public') returning id`,
    [title, slug, heroText, description]
  );
  return rows[0].id;
}

describe("migration 014(유사도 기준값)", () => {
  it("기본값 0.6/0.8, 0 < 경고 < 오류 ≤ 1 제약", async () => {
    expect(await getSimilarityThresholds()).toEqual({ thresholds: { warning: 0.6, error: 0.8 }, error: null });
    await expect(
      db.query("update public.auto_publish_settings set similarity_warning_threshold = 0.9")
    ).rejects.toThrow(/similarity_thresholds_check/);
    await expect(
      db.query("update public.auto_publish_settings set similarity_error_threshold = 1.5")
    ).rejects.toThrow();
  });

  it("014_down: 기준값 컬럼만 지우고, 그 뒤 설정 조회는 기본값 + 안내 문구로 버틴다. 다시 014 적용 가능", async () => {
    await db.exec(readRollback("014_down.sql"));
    const columns = await db.query(
      `select column_name from information_schema.columns
        where table_name = 'auto_publish_settings' and column_name like 'similarity%'`
    );
    expect(columns.rows).toEqual([]);
    expect((await db.query("select enabled, daily_limit from public.auto_publish_settings")).rows).toEqual([
      { enabled: false, daily_limit: 50 },
    ]);
    const fallback = await getSimilarityThresholds();
    expect(fallback.thresholds).toEqual({ warning: 0.6, error: 0.8 });
    expect(fallback.error).toMatch(/기본값/);

    await db.exec(readMigration("014_bulk_upload_similarity_settings.sql"));
    expect(await getSimilarityThresholds()).toEqual({ thresholds: { warning: 0.6, error: 0.8 }, error: null });
  });

  it("설정 저장(로그인 사용자 권한)과 잘못된 값 거부", async () => {
    expect(await updateSimilarityThresholds({ warning: 0.5, error: 0.7 })).toEqual({ success: true });
    expect((await getSimilarityThresholds()).thresholds).toEqual({ warning: 0.5, error: 0.7 });
    expect((await updateSimilarityThresholds({ warning: 0.7, error: 0.7 })).success).toBe(false);
    expect((await getSimilarityThresholds()).thresholds).toEqual({ warning: 0.5, error: 0.7 });
  });
});

describe("대기열 저장(enqueueUploadRows)", () => {
  it("통과 행은 ready로 저장되고 값이 그대로 들어간다", async () => {
    const result = await enqueueUploadRows({
      rows: [row(2, values(0, { phone: "010-1111-2222" })), row(3, values(1))],
      holdSimilar: false,
      batchId: BATCH,
    });

    expect(result).toEqual({
      results: [
        { rowNumber: 2, outcome: "ready" },
        { rowNumber: 3, outcome: "ready" },
      ],
      error: null,
    });
    const rows = await queueRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      region: "지역0",
      keyword: "헬스장",
      region_slug: "region-0",
      keyword_slug: "gym",
      slug: "region-0-gym",
      business_name: "업체 0",
      phone: "010-1111-2222",
      kakao_url: null,
      template: "template-a",
      seo_title: "지역0 헬스장 SEO",
      faqs: [{ question: "주차 되나요?", answer: "네" }],
      source: "excel",
      state: "ready",
      validation_errors: [],
      batch_id: BATCH,
      published_at: null,
      landing_page_id: null,
    });
  });

  it("오류 행은 저장하지 않고 이유를 돌려준다", async () => {
    await insertPage("region-1-gym", "다른 페이지", "a", "b");
    const result = await enqueueUploadRows({
      rows: [row(2, values(0, { businessName: "" })), row(3, values(1)), row(4, values(2))],
      holdSimilar: true,
      batchId: BATCH,
    });
    expect(result.results).toEqual([
      { rowNumber: 2, outcome: "skipped", reason: "업체명, 페이지 제목, URL Slug, 템플릿은 필수 입력값입니다." },
      { rowNumber: 3, outcome: "skipped", reason: "이미 사용 중인 URL입니다." },
      { rowNumber: 4, outcome: "ready" },
    ]);
    expect((await queueRows()).map((r) => r.slug)).toEqual(["region-2-gym"]);
  });

  it("같은 키워드 기존 페이지와 유사도 0.8 이상: 선택 시 hold로 저장(유사도·사유 기록), 아니면 건너뜀", async () => {
    await insertPage("gangnam-gym", "강남 헬스장 원케어", "강남 헬스장", LONG_TEXT);
    const similarRow = row(2, values(0, { heroText: "서초 헬스장", description: LONG_TEXT }));

    const skipped = await enqueueUploadRows({ rows: [similarRow], holdSimilar: false, batchId: BATCH });
    expect(skipped.results[0]).toMatchObject({ outcome: "skipped" });
    expect(skipped.results[0].reason).toMatch(/기존 페이지 \/gangnam-gym과\(와\) \d+% 비슷합니다/);
    expect(await queueRows()).toEqual([]);

    const held = await enqueueUploadRows({ rows: [similarRow], holdSimilar: true, batchId: BATCH });
    expect(held.results).toEqual([{ rowNumber: 2, outcome: "hold" }]);
    const [saved] = await queueRows();
    expect(saved.state).toBe("hold");
    expect(Number(saved.max_similarity)).toBeGreaterThanOrEqual(0.8);
    expect(saved.validation_errors).toEqual([
      expect.objectContaining({ code: "similarity_too_high", level: "error" }),
    ]);
  });

  it("나눠 보낸 앞 묶음은 다음 묶음의 비교 대상이 된다(파일 안 앞 행과 비교와 같은 결과)", async () => {
    await enqueueUploadRows({
      rows: [row(2, values(0, { heroText: "강남 헬스장", description: LONG_TEXT }))],
      holdSimilar: true,
      batchId: BATCH,
    });
    const second = await enqueueUploadRows({
      rows: [row(3, values(1, { heroText: "서초 헬스장", description: LONG_TEXT }))],
      holdSimilar: true,
      batchId: BATCH,
    });
    expect(second.results).toEqual([{ rowNumber: 3, outcome: "hold" }]);
    const rows = await queueRows();
    expect(rows.map((r) => r.state)).toEqual(["ready", "hold"]);
    expect(JSON.stringify(rows[1].validation_errors)).toContain("대기열 /region-0-gym");
  });

  it("이미 대기열에 있는 지역·키워드는 건너뛴다", async () => {
    await enqueueUploadRows({ rows: [row(2, values(0))], holdSimilar: false, batchId: BATCH });
    const again = await enqueueUploadRows({
      rows: [row(2, values(0, { regionSlug: "other" }))],
      holdSimilar: false,
      batchId: BATCH,
    });
    expect(again.results[0]).toEqual({
      rowNumber: 2,
      outcome: "skipped",
      reason: "같은 지역·키워드가 이미 대기열에 있습니다.",
    });
  });

  it("검사 후 저장 사이에 unique 충돌이 나면 그 행만 건너뛰고 나머지는 저장한다", async () => {
    // 'region-1-gym' insert 시 unique 위반을 일으키는 테스트용 트리거
    await db.exec(`
      create function public.test_race() returns trigger language plpgsql as $$
      begin
        if new.slug = 'region-1-gym' then
          raise exception 'duplicate key value' using errcode = '23505';
        end if;
        return new;
      end $$;
      create trigger test_race before insert on public.landing_page_queue
        for each row execute function public.test_race();
    `);
    const result = await enqueueUploadRows({
      rows: [row(2, values(0)), row(3, values(1)), row(4, values(2))],
      holdSimilar: false,
      batchId: BATCH,
    });
    expect(result.results).toEqual([
      { rowNumber: 2, outcome: "ready" },
      {
        rowNumber: 3,
        outcome: "skipped",
        reason: "이미 사용 중인 URL이거나 같은 지역·키워드가 대기열에 있습니다.",
      },
      { rowNumber: 4, outcome: "ready" },
    ]);
    expect((await queueRows()).map((r) => r.slug)).toEqual(["region-0-gym", "region-2-gym"]);
  });

  it("저장한 ready 항목은 3단계 공개 함수로 공개되고, hold는 남는다", async () => {
    await insertPage("gangnam-gym", "강남 헬스장 원케어", "강남 헬스장", LONG_TEXT);
    await enqueueUploadRows({
      rows: [
        row(2, values(0, { faqQuestion2: "가격은?", faqAnswer2: "상담 후 안내" })),
        row(3, values(1)),
        row(4, values(2, { heroText: "서초 헬스장", description: LONG_TEXT })),
      ],
      holdSimilar: true,
      batchId: BATCH,
    });

    const { rows } = await db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      return tx.query<{ r: { published: number } }>("select public.publish_queued_landing_pages(50) as r");
    });
    expect(rows[0].r.published).toBe(2);

    expect((await queueRows()).map((r) => [r.slug, r.state])).toEqual([
      ["region-0-gym", "published"],
      ["region-1-gym", "published"],
      ["region-2-gym", "hold"],
    ]);
    const faqs = await db.query(
      `select f.question from public.landing_page_faqs f
         join public.landing_pages lp on lp.id = f.landing_page_id
        where lp.slug = 'region-0-gym' order by f.sort_order`
    );
    expect(faqs.rows).toEqual([{ question: "주차 되나요?" }, { question: "가격은?" }]);
  });
});

describe("비교 대상 불러오기(loadBulkCheckContext)", () => {
  it("공개된 대기열 항목은 연결된 페이지의 현재 문구, 대기열 밖 페이지는 제목에 키워드가 있으면 포함", async () => {
    const linkedId = await insertPage("linked-gym", "연결된 페이지", "고친 문구", "공개 후 고친 설명");
    await db.query(
      `insert into public.landing_page_queue
         (region, keyword, region_slug, keyword_slug, business_name, title, slug, hero_text, source, state, landing_page_id, published_at)
       values ('연결', '헬스장', 'linked', 'gym', 'b', 't', 'linked-gym', '대기열 사본 문구', 'excel', 'published', $1, now())`,
      [linkedId]
    );
    await insertPage("title-match", "강남 헬스장 원케어", "제목 일치", "설명");
    await insertPage("title-other", "강남 필라테스", "다른 키워드", "설명");
    await db.query(
      `insert into public.landing_page_queue
         (region, keyword, region_slug, keyword_slug, business_name, title, slug, hero_text, source, state)
       values ('대기', '헬스장', 'wait', 'gym', 'b', 't', 'wait-gym', '대기 문구', 'ai', 'draft')`
    );

    const { context, error } = await loadBulkCheckContext({
      slugs: ["linked-gym", "WAIT-GYM", "new-gym"],
      keywords: ["헬스장"],
    });
    expect(error).toBeNull();
    expect(context.existingSlugs.sort()).toEqual(["linked-gym", "wait-gym"]);
    expect(context.existingPairs).toEqual(
      expect.arrayContaining([
        { region: "연결", keyword: "헬스장" },
        { region: "대기", keyword: "헬스장" },
      ])
    );
    expect(context.corpus.map((c) => [c.label, c.text]).sort()).toEqual(
      [
        ["기존 페이지 /linked-gym", "고친문구공개후고친설명"],
        ["기존 페이지 /title-match", "제목일치설명"],
        ["대기열 /wait-gym", "대기문구"],
      ].sort()
    );
  });

  it("수정할 때는 자기 자신을 빼고, 키워드의 %·_는 글자 그대로 찾는다", async () => {
    await enqueueUploadRows({ rows: [row(2, values(0))], holdSimilar: false, batchId: BATCH });
    const [self] = await queueRows();
    const { context } = await loadBulkCheckContext({
      slugs: ["region-0-gym"],
      keywords: ["헬스장"],
      excludeQueueId: self.id as string,
    });
    expect(context).toEqual({ existingSlugs: [], existingPairs: [], corpus: [] });

    await insertPage("percent", "100% 환불 헬스장", "a", "b");
    await insertPage("no-percent", "100 환불 헬스장", "a", "b");
    const percent = await loadBulkCheckContext({ slugs: [], keywords: ["100%"] });
    expect(percent.context.corpus.map((c) => c.label)).toEqual(["기존 페이지 /percent"]);
  });
});

describe("공개 대기열 화면 기능(lib/publish-queue)", () => {
  async function seed(n: number, state = "ready", offset = 0) {
    await db.query(
      `insert into public.landing_page_queue
         (region, keyword, region_slug, keyword_slug, business_name, title, slug, source, state, created_at)
       select '지역' || i, '헬스장', 'region-' || i, 'gym', '업체 ' || i, '제목 ' || i, 'region-' || i || '-gym',
              'excel', $1, timestamptz '2026-10-01' + make_interval(secs => i)
         from generate_series($2::int, $3::int) as i`,
      [state, offset, offset + n - 1]
    );
  }

  it("50개씩, 오래된 순, 마지막 페이지, 범위 밖 페이지", async () => {
    await seed(120);
    const first = await queue.getQueuePage({ state: "all", search: "", page: 1 });
    expect(first.count).toBe(120);
    expect(first.data).toHaveLength(50);
    expect(first.data[0].region).toBe("지역0");
    const last = await queue.getQueuePage({ state: "all", search: "", page: 3 });
    expect(last.data.map((r) => r.region)).toEqual(Array.from({ length: 20 }, (_, i) => `지역${100 + i}`));
    expect(await queue.getQueuePage({ state: "all", search: "", page: 9 })).toEqual({ data: [], count: 120, error: null });
  });

  it("상태 필터·검색·상태별 건수", async () => {
    await seed(5, "ready", 0);
    await seed(3, "hold", 10);
    await seed(2, "published", 20);
    const counts = await queue.getQueueStateCounts();
    expect(counts).toEqual({
      data: { all: 10, draft: 0, ready: 5, hold: 3, published: 2, failed: 0 },
      error: null,
    });
    expect((await queue.getQueuePage({ state: "hold", search: "", page: 1 })).count).toBe(3);
    const search = await queue.getQueuePage({ state: "all", search: "지역1", page: 1 });
    expect(search.data.map((r) => r.region).sort()).toEqual(["지역1", "지역10", "지역11", "지역12"]);
    // 필터 문법 문자(쉼표·괄호)는 지우고 검색
    expect((await queue.getQueuePage({ state: "all", search: "지역2,0)", page: 1 })).error).toBeNull();
  });

  it("보류 → 공개 대기: hold만 바뀐다", async () => {
    await seed(2, "hold", 0);
    await seed(1, "draft", 10);
    const ids = (await queueRows()).map((r) => r.id as string);
    expect(await queue.releaseHeldItems(ids)).toEqual({ success: true, changed: 2 });
    expect((await queueRows()).map((r) => r.state).sort()).toEqual(["draft", "ready", "ready"]);
  });

  it("삭제: 공개된 항목은 지우지 않는다", async () => {
    await seed(2, "ready", 0);
    await seed(1, "published", 10);
    const ids = (await queueRows()).map((r) => r.id as string);
    expect(await deleteQueueItemsAction(ids)).toEqual({ success: true, changed: 2 });
    expect((await queueRows()).map((r) => r.state)).toEqual(["published"]);
    expect(await deleteQueueItemsAction(["not-a-uuid"])).toMatchObject({ success: false, error: "잘못된 요청입니다." });
  });

  it("내용 수정: 같은 규칙으로 재검사, 유사도 오류면 ready 불가·hold 가능, 공개된 항목은 불가", async () => {
    await insertPage("gangnam-gym", "강남 헬스장 원케어", "강남 헬스장", LONG_TEXT);
    await enqueueUploadRows({ rows: [row(2, values(0)), row(3, values(1))], holdSimilar: false, batchId: BATCH });
    const [item, other] = await queueRows();
    const id = item.id as string;
    const current = queue.queueRowToValues((await queue.getQueueItem(id)).data!);
    expect(current).toMatchObject({ region: "지역0", slug: "region-0-gym", faqQuestion1: "주차 되나요?", faqAnswer2: "" });

    // 규칙 위반
    const invalid = await queue.updateQueueItem(id, { ...current, title: "" }, "ready");
    expect(invalid).toMatchObject({ success: false, errors: ["업체명, 페이지 제목, URL Slug, 템플릿은 필수 입력값입니다."] });

    // 다른 항목과 slug 충돌
    const clash = await queue.updateQueueItem(id, { ...current, slug: other.slug as string }, "ready");
    expect(clash.errors).toContain("이미 사용 중인 URL입니다.");

    // 유사도 오류: ready 거부, hold 허용
    const similar = { ...current, heroText: "서초 헬스장", description: LONG_TEXT };
    expect((await queue.updateQueueItem(id, similar, "ready")).error).toMatch(/ready로 저장할 수 없습니다/);
    expect(await updateQueueItemAction(id, similar, "hold")).toEqual({ success: true });
    const saved = (await queue.getQueueItem(id)).data!;
    expect(saved.state).toBe("hold");
    expect(saved.hero_text).toBe("서초 헬스장");
    expect(Number(saved.max_similarity)).toBeGreaterThanOrEqual(0.8);

    // 자기 자신과는 비교하지 않음: 그대로 다시 저장 가능
    expect(await queue.updateQueueItem(id, { ...current, heroText: "새 문구" }, "ready")).toEqual({ success: true });

    // 공개된 항목
    await db.query("update public.landing_page_queue set state = 'published' where id = $1", [id]);
    expect((await queue.updateQueueItem(id, current, "ready")).error).toMatch(/이미 공개된 항목/);

    // 잘못된 요청
    expect(await updateQueueItemAction(id, current, "published")).toMatchObject({ error: "잘못된 요청입니다." });
  });
});

describe("Server Action 입력 확인", () => {
  it("형식이 틀린 묶음·batchId는 거부, 정상 묶음은 저장", async () => {
    expect(await enqueueBulkRowsAction({ rows: "x", holdSimilar: false, batchId: BATCH })).toEqual({
      success: false,
      error: "잘못된 요청입니다.",
    });
    expect(
      await enqueueBulkRowsAction({ rows: [{ rowNumber: 2, values: values(0) }], holdSimilar: false, batchId: "bad" })
    ).toMatchObject({ success: false });
    expect(
      await enqueueBulkRowsAction({ rows: [{ rowNumber: 2, values: values(0) }], holdSimilar: false, batchId: BATCH })
    ).toEqual({ success: true, results: [{ rowNumber: 2, outcome: "ready" }] });
  });
});
