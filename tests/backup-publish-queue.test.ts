/**
 * 백업 형식 version 2: landing_pages.published_at과 공개 대기열(landing_page_queue)을
 * 백업·복구에 반영했는지 확인한다. 가짜 Supabase 클라이언트를 쓰므로 실제 DB 연결은 없다.
 */
import { describe, expect, it } from "vitest";
import { buildBackupFile } from "@/lib/backup/export";
import { executeMergeRestore, computeRestorePlan } from "@/lib/backup/restore";
import { parseAndValidateBackupFile } from "@/lib/backup/sanitize";
import { BACKUP_FORMAT, BACKUP_VERSION, type BackupFile } from "@/types/backup";
import { FakeSupabase } from "./helpers/fake-supabase";
import { setFakeSupabase } from "./helpers/current-supabase";

type Row = Record<string, unknown>;

const uuid = (prefix: number, n: number) =>
  `${String(prefix).padStart(8, "0")}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const pageId = (n: number) => uuid(1, n);
const queueId = (n: number) => uuid(2, n);
const iso = (ms: number) => new Date(ms).toISOString();
const BASE = Date.UTC(2026, 0, 1);

function landingPage(i: number, overrides: Row = {}): Row {
  return {
    id: pageId(i),
    business_name: `업체 ${i}`,
    title: `제목 ${i}`,
    slug: `shop-${i}`,
    hero_text: null,
    description: null,
    phone: null,
    kakao_url: null,
    address: null,
    logo_url: null,
    main_image_url: null,
    template: "template-a",
    status: "public",
    // 짝수 번호만 대기열에서 공개된 페이지
    published_at: i % 2 === 0 ? iso(BASE + i * 1000) : null,
    created_at: iso(BASE + Math.floor(i / 3) * 1000),
    updated_at: iso(BASE + i * 1000),
    ...overrides,
  };
}

const STATES = ["draft", "ready", "hold", "published", "failed"] as const;

function queueRow(i: number, overrides: Row = {}): Row {
  const state = STATES[i % STATES.length];
  return {
    id: queueId(i),
    region: `지역${i}`,
    keyword: "헬스장",
    region_slug: `region-${i}`,
    keyword_slug: "gym",
    business_name: `업체 ${i}`,
    title: `지역${i} 헬스장`,
    slug: `region-${i}-gym`,
    hero_text: "대표 문구",
    description: null,
    phone: "010-1111-2222",
    kakao_url: null,
    address: null,
    template: "template-a",
    seo_title: `지역${i} 헬스장 SEO`,
    seo_description: null,
    service_area: `지역${i}`,
    business_category: "헬스장",
    faqs: [{ question: "주차 되나요?", answer: "네" }],
    source: i % 2 === 0 ? "ai" : "excel",
    state,
    validation_errors: state === "failed" ? [{ code: "slug_conflict", fields: ["slug"], message: "이미 사용 중인 URL입니다." }] : [],
    max_similarity: i % 3 === 0 ? null : 0.4321,
    priority: i % 7,
    published_at: state === "published" ? iso(BASE + i * 1000) : null,
    landing_page_id: state === "published" ? pageId(i) : null,
    batch_id: uuid(3, Math.floor(i / 100)),
    created_at: iso(BASE + Math.floor(i / 4) * 1000),
    ...overrides,
  };
}

function createDb(tables: { landingPages?: Row[]; queue?: Row[] } = {}) {
  return new FakeSupabase({
    tables: {
      landing_pages: tables.landingPages ?? [],
      landing_page_seo_settings: [],
      landing_page_faqs: [],
      consultation_requests: [],
      landing_page_events: [],
      landing_page_queue: tables.queue ?? [],
      site_verification_settings: [
        { id: "default", google_site_verification: null, naver_site_verification: null },
      ],
    },
  });
}

const sortById = (rows: Row[]) =>
  [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));

function backupFile(data: Partial<BackupFile["data"]>, version: number = BACKUP_VERSION) {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version,
    exportedAt: "2026-10-23T00:00:00.000Z",
    site: "https://example.test",
    data: {
      landingPages: [],
      seoSettings: [],
      faqs: [],
      consultations: [],
      events: [],
      siteVerificationSettings: null,
      storageManifest: [],
      ...data,
    },
  });
}

function parse(text: string): BackupFile {
  const parsed = parseAndValidateBackupFile(text);
  if (!parsed.success || !parsed.backup) throw new Error(parsed.error);
  return parsed.backup;
}

describe("백업 내보내기(version 2)", () => {
  it("published_at과 대기열 전체(1,000행 넘어도)를 담는다", async () => {
    const pages = Array.from({ length: 1200 }, (_, i) => landingPage(i));
    const queue = Array.from({ length: 1100 }, (_, i) => queueRow(i));
    setFakeSupabase(createDb({ landingPages: pages, queue }));

    const { success, backup } = await buildBackupFile();

    expect(success).toBe(true);
    expect(backup!.version).toBe(2);
    expect(backup!.counts).toMatchObject({ landingPages: 1200, publishQueue: 1100 });
    expect(sortById(backup!.data.landingPages as Row[])).toEqual(sortById(pages));
    expect(sortById(backup!.data.publishQueue as unknown as Row[])).toEqual(sortById(queue));
  });
});

describe("백업 파일 읽기", () => {
  it("version 2: published_at과 대기열을 그대로 읽는다", () => {
    const backup = parse(
      backupFile({
        landingPages: [landingPage(0), landingPage(1)] as never,
        publishQueue: [queueRow(0), queueRow(3)] as never,
      })
    );
    expect(backup.data.landingPages.map((p) => p.published_at)).toEqual([
      landingPage(0).published_at,
      null,
    ]);
    expect(backup.data.publishQueue).toEqual([queueRow(0), queueRow(3)]);
    expect(backup.counts.publishQueue).toBe(2);
  });

  it("version 1: 계속 읽을 수 있고, published_at 키는 넣지 않으며 대기열은 비어 있다", () => {
    const v1Page = landingPage(0);
    delete v1Page.published_at;
    const parsed = parseAndValidateBackupFile(
      backupFile({ landingPages: [v1Page] as never, publishQueue: [queueRow(0)] as never }, 1)
    );
    expect(parsed.success).toBe(true);
    expect(parsed.invalidCounts).toEqual({});
    expect(parsed.backup!.version).toBe(1);
    expect(parsed.backup!.data.landingPages[0]).not.toHaveProperty("published_at");
    expect(parsed.backup!.data.publishQueue).toEqual([]);
  });

  it("지원하지 않는 버전은 거부", () => {
    expect(parseAndValidateBackupFile(backupFile({}, 3))).toMatchObject({
      success: false,
      error: "지원하지 않는 백업 버전입니다. (version: 3)",
    });
  });

  it("version 2에서 published_at이 없거나 날짜가 아니면 그 페이지만 제외", () => {
    const missing = landingPage(1);
    delete missing.published_at;
    const parsed = parseAndValidateBackupFile(
      backupFile({
        landingPages: [landingPage(0), missing, landingPage(2, { published_at: "어제" })] as never,
      })
    );
    expect(parsed.backup!.data.landingPages).toHaveLength(1);
    expect(parsed.invalidCounts).toEqual({ landingPages: 2 });
  });

  it("형식이 틀린 대기열 행은 제외하고 개수를 센다", () => {
    const parsed = parseAndValidateBackupFile(
      backupFile({
        publishQueue: [
          queueRow(0),
          queueRow(1, { state: "deleted" }),
          queueRow(2, { source: "manual" }),
          queueRow(3, { faqs: [{ question: "q" }] }),
          queueRow(4, { max_similarity: 1.5 }),
          queueRow(5, { landing_page_id: "not-uuid" }),
          queueRow(6, { validation_errors: {} }),
          queueRow(7, { priority: 1.5 }),
          queueRow(8, { max_similarity: "0.8123" }),
        ] as never,
      })
    );
    expect(parsed.invalidCounts).toEqual({ publishQueue: 7 });
    expect(parsed.backup!.data.publishQueue.map((q) => q.id)).toEqual([queueId(0), queueId(8)]);
    // numeric 문자열은 숫자로 바꿔 받는다
    expect(parsed.backup!.data.publishQueue[1].max_similarity).toBe(0.8123);
  });

  it("알 수 없는 키(__proto__ 등)는 옮겨 담지 않는다", () => {
    const text = backupFile({ publishQueue: [queueRow(0)] as never }).replace(
      '"region":',
      '"__proto__":{"polluted":true},"extra":1,"region":'
    );
    const row = parse(text).data.publishQueue[0] as unknown as Row;
    expect(row).not.toHaveProperty("extra");
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    expect(({} as Row).polluted).toBeUndefined();
  });
});

describe("백업 복구", () => {
  it("내보낸 파일을 빈 DB에 복구하면 랜딩페이지(published_at 포함)와 대기열이 그대로 돌아온다", async () => {
    const pages = Array.from({ length: 1200 }, (_, i) => landingPage(i));
    const queue = Array.from({ length: 1100 }, (_, i) => queueRow(i));
    setFakeSupabase(createDb({ landingPages: pages, queue }));
    const { backup } = await buildBackupFile();

    const target = setFakeSupabase(createDb());
    const result = await executeMergeRestore(parse(JSON.stringify(backup)));

    expect(result.status).toBe("success");
    expect(result.landingPages).toEqual({ inserted: 1200, updated: 0, conflicts: 0 });
    expect(result.publishQueue).toEqual({ inserted: 1100, updated: 0, conflicts: 0, unlinked: 0 });
    expect(sortById(target.tables.landing_pages)).toEqual(sortById(pages));
    expect(sortById(target.tables.landing_page_queue)).toEqual(sortById(queue));
  });

  it("version 2 복구는 현재 published_at을 백업 값으로 바꾼다(null 포함)", async () => {
    const target = setFakeSupabase(
      createDb({
        landingPages: [
          landingPage(0, { published_at: "2026-09-09T00:00:00.000Z" }),
          landingPage(1, { published_at: "2026-09-09T00:00:00.000Z" }),
        ],
      })
    );
    await executeMergeRestore(
      parse(backupFile({ landingPages: [landingPage(0), landingPage(1)] as never }))
    );
    expect(sortById(target.tables.landing_pages).map((p) => p.published_at)).toEqual([
      landingPage(0).published_at,
      null,
    ]);
  });

  it("version 1 복구는 현재 published_at을 건드리지 않는다", async () => {
    const target = setFakeSupabase(
      createDb({ landingPages: [landingPage(0, { published_at: "2026-09-09T00:00:00.000Z", title: "현재 제목" })] })
    );
    const v1Page = landingPage(0, { title: "백업 제목" });
    delete v1Page.published_at;

    const result = await executeMergeRestore(parse(backupFile({ landingPages: [v1Page] as never }, 1)));

    expect(result.status).toBe("success");
    expect(result.landingPages.updated).toBe(1);
    expect(target.tables.landing_pages[0]).toMatchObject({
      title: "백업 제목",
      published_at: "2026-09-09T00:00:00.000Z",
    });
  });

  it("대기열 충돌은 그 행만 건너뛰고, 없는 랜딩페이지 연결은 끊고 쓴다", async () => {
    const target = setFakeSupabase(
      createDb({
        landingPages: [landingPage(3)],
        queue: [
          queueRow(0, { title: "현재 0" }),
          queueRow(1),
          queueRow(2),
        ],
      })
    );
    const backup = parse(
      backupFile({
        landingPages: [landingPage(3)] as never,
        publishQueue: [
          queueRow(0, { title: "백업 0" }), // 같은 id → 업데이트
          queueRow(10, { slug: "region-1-gym" }), // 다른 항목이 쓰는 slug → 충돌
          queueRow(11, { region: "지역2" }), // 다른 항목이 쓰는 (지역2, 헬스장) → 충돌
          queueRow(12, { slug: "dup" }), // 백업 안 slug 중복 → 둘 다 충돌
          queueRow(13, { slug: "dup" }),
          queueRow(14, { state: "published", landing_page_id: pageId(999) }), // 없는 페이지 → 연결 해제
          queueRow(15, { state: "published", landing_page_id: pageId(3) }), // 있는 페이지 → 유지
        ] as never,
      })
    );

    const { plan } = await computeRestorePlan(backup);
    expect(plan!.canRestore).toBe(true);
    expect(plan!.publishQueue).toMatchObject({
      toInsertCount: 2,
      toUpdateCount: 1,
      conflictCount: 4,
      unlinkedCount: 1,
    });

    const result = await executeMergeRestore(backup);
    expect(result.status).toBe("success");
    expect(result.publishQueue).toEqual({ inserted: 2, updated: 1, conflicts: 4, unlinked: 1 });

    const byId = new Map(target.tables.landing_page_queue.map((r) => [r.id, r]));
    expect(byId.get(queueId(0))?.title).toBe("백업 0");
    expect(byId.has(queueId(10))).toBe(false);
    expect(byId.has(queueId(11))).toBe(false);
    expect(byId.has(queueId(12))).toBe(false);
    expect(byId.get(queueId(14))?.landing_page_id).toBeNull();
    expect(byId.get(queueId(15))?.landing_page_id).toBe(pageId(3));
    expect(target.tables.landing_page_queue).toHaveLength(5);
  });

  it("랜딩페이지 slug 충돌로 복구가 막히면 대기열도 쓰지 않는다", async () => {
    const target = setFakeSupabase(createDb({ landingPages: [landingPage(0)] }));
    const result = await executeMergeRestore(
      parse(
        backupFile({
          landingPages: [landingPage(1, { slug: "shop-0" })] as never,
          publishQueue: [queueRow(0)] as never,
        })
      )
    );
    expect(result.status).toBe("blocked");
    expect(target.tables.landing_page_queue).toEqual([]);
  });
});
