/**
 * 사진 기능(feature/photos, migration 019)
 * 1) 사진 보관함: media_assets 권한·제약, Storage 상한·경로, 등록(같은 사진 1번만·이름 번호), 삭제(쓰는 사진은 막음)
 * 2) 페이지 사진 3장 + 로고: 저장·검사, 공개 함수 복사, 갤러리 <img alt>, 대표 로고 대체, og:image 1200×630, 구조화 데이터 image 배열
 * 3) 엑셀: 사진2·3 칸(맨 뒤), 이전 양식 호환, 보관함 이름 → 주소, 없는 이름은 오류
 * 4) 삭제 안전장치: 사진 칸이 하나라도 빠지면 실패하도록 칸 목록을 DB와 맞춰 본다
 * 5) 백업 version 4
 * 컴퓨터 안 Postgres(PGlite, migration 001~019)와 가짜 Supabase만 쓴다 — 운영 DB에는 연결하지 않는다.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PGlite, PGliteInterface } from "@electric-sql/pglite";
import { asRole, createMigratedDb, readMigration, readRollback } from "./helpers/pglite-db";
import { PgliteSupabase } from "./helpers/pglite-supabase";
import { FakeSupabase } from "./helpers/fake-supabase";
import { setFakeSupabase } from "./helpers/current-supabase";
import type { LandingPage } from "@/types/landing-page";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/media",
}));

const {
  buildLibraryPaths,
  libraryOgUrlOf,
  numberedMediaName,
  photoNameCandidates,
  resolvePhotoReference,
  sanitizeMediaName,
} = await import("@/lib/media/library");
const { checkSourceFile, coverCrop, fitWithin, isHeicFile, HEIC_MESSAGE, MEDIA_PRESETS } = await import(
  "@/lib/media/compress"
);
const { IMAGE_REFERENCE_COLUMNS, countImageReferences } = await import("@/lib/storage/asset-references");
const { removeLandingPageImageByUrl } = await import("@/lib/storage/landing-page-assets");
const { registerMediaAsset, getMediaLibraryEntries, getUsedImageUrlCounts } = await import("@/lib/media-assets");
const { deleteMediaAssetAction, registerMediaAssetAction, findMediaAssetByShaAction } = await import(
  "@/app/admin/media/actions"
);
const { updateLandingPagePhotosAction, createLandingPageAction, duplicateLandingPageAction, deleteLandingPageAction } =
  await import("@/app/admin/pages/actions");
const { updateSiteProfileLogoAction } = await import("@/app/admin/settings/actions");
const { getSiteProfile } = await import("@/lib/site-profile");
const { validateLandingPagePhotosInput } = await import("@/lib/landing-page-validation");
const { getGalleryPhotos, getLandingPhotos, resolvePageLogoUrl, resolveAutoOgImage } = await import(
  "@/lib/landing-photos"
);
const { resolveLandingPageSeo } = await import("@/lib/seo-resolver");
const { buildLandingPageMetadata } = await import("@/lib/seo");
const { buildOrganizationJsonLd, buildSiteBusinessJsonLd } = await import("@/lib/structured-data");
const { default: LandingPageRenderer } = await import("@/components/landing/LandingPageRenderer");
const { BULK_UPLOAD_COLUMNS, CUSTOMER_ONLY_FIELDS } = await import("@/lib/bulk-upload/columns");
const { buildTemplateSheet } = await import("@/lib/bulk-upload/template");
const { checkBulkUploadRows, collectPhotoValues } = await import("@/lib/bulk-upload/check");
const { sheetToUploadRows } = await import("@/lib/bulk-upload/parse");
const { DEFAULT_SIMILARITY_THRESHOLDS } = await import("@/lib/bulk-upload/similarity");
const { enqueueUploadRows } = await import("@/lib/bulk-upload/enqueue");
const { updateQueueItem } = await import("@/lib/publish-queue");
const { buildBackupFile } = await import("@/lib/backup/export");
const { parseAndValidateBackupFile } = await import("@/lib/backup/sanitize");
const { executeMergeRestore } = await import("@/lib/backup/restore");
const { BACKUP_FORMAT, BACKUP_VERSION } = await import("@/types/backup");
const { default: MediaLibraryPanel } = await import("@/components/admin/MediaLibraryPanel");
const { default: LandingPagePhotosCard, EMPTY_PHOTOS } = await import("@/components/admin/LandingPagePhotosCard");
const { default: QueueItemForm } = await import("@/components/admin/QueueItemForm");
const { default: AdminSidebar } = await import("@/components/admin/AdminSidebar");

const SUPA = "https://proj.supabase.co";
const PUBLIC = `${SUPA}/storage/v1/object/public/landing-page-assets`;
const sha = (n: number) => n.toString(16).padStart(64, "0");
const libUrl = (n: number) => `${PUBLIC}/library/${sha(n)}.webp`;
const ogUrl = (n: number) => `${PUBLIC}/library/${sha(n)}-og.jpg`;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

// ------------------------------------------------------------
// 가짜 Storage(목록·삭제만). PgliteSupabase에 storage 속성으로 붙인다.
// ------------------------------------------------------------
class FakeStorage {
  objects = new Map<string, number>();
  removed: string[][] = [];
  failList = false;

  from() {
    return {
      list: async (prefix: string, options: { search?: string } = {}) => {
        if (this.failList) return { data: null, error: { message: "list failed" } };
        const data = Array.from(this.objects)
          .filter(([path]) => path.startsWith(`${prefix}/`) && path.includes(options.search ?? ""))
          .map(([path, size]) => ({ name: path.slice(prefix.length + 1), metadata: { size } }));
        return { data, error: null };
      },
      remove: async (paths: string[]) => {
        this.removed.push(paths);
        for (const path of paths) this.objects.delete(path);
        return { data: [], error: null };
      },
    };
  }
}

let base: PGlite;
let db: PGliteInterface;
let storage: FakeStorage;

function useClient(role: "authenticated" | "anon" = "authenticated") {
  const client = new PgliteSupabase(db, role);
  Object.assign(client, { storage });
  return setFakeSupabase(client);
}

beforeAll(async () => {
  base = await createMigratedDb();
}, 60_000);

afterAll(async () => {
  await base.close();
});

beforeEach(async () => {
  db = await base.clone();
  storage = new FakeStorage();
  useClient();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function insertAsset(n: number, name: string, kind: "photo" | "logo" = "photo") {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.media_assets
       (sha256, kind, name, storage_path, url, og_storage_path, og_url, mime, width, height, bytes, og_bytes)
     values ($1, $2, $3, $4, $5, $6, $7, 'image/webp', 1600, 1200, 300000, 150000) returning id`,
    [sha(n), kind, name, `library/${sha(n)}.webp`, libUrl(n), `library/${sha(n)}-og.jpg`, ogUrl(n)]
  );
  return rows[0].id;
}

async function insertPage(slug: string, columns: Record<string, unknown> = {}) {
  const cols = ["business_name", "title", "slug", "status", ...Object.keys(columns)];
  const values = ["업체", "제목", slug, "public", ...Object.values(columns)];
  const { rows } = await db.query<{ id: string }>(
    `insert into public.landing_pages (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    values
  );
  return rows[0].id;
}

async function insertQueue(slug: string, columns: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    region: `${slug}-r`,
    keyword: "헬스장",
    region_slug: slug,
    keyword_slug: "gym",
    business_name: "원케어",
    title: "제목",
    slug,
    source: "excel",
    state: "ready",
    ...columns,
  };
  const cols = Object.keys(row);
  const values = Object.values(row);
  const { rows } = await db.query<{ id: string }>(
    `insert into public.landing_page_queue (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    values
  );
  return rows[0].id;
}

const count = async (sql: string) => (await db.query<{ n: number }>(sql)).rows[0].n;

function page(overrides: Partial<LandingPage> = {}): LandingPage {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    business_name: "원케어배관",
    title: "배관 수리",
    slug: "sanbon-pipe",
    hero_text: "빠른 출장",
    description: "산본동 배관 수리 전문입니다.",
    phone: "010-0000-0000",
    kakao_url: null,
    address: null,
    logo_url: null,
    main_image_url: null,
    template: "template-a",
    status: "public",
    published_at: null,
    region: "산본동",
    keyword: "배관 수리",
    city: "군포시",
    city_slug: "gunpo",
    main_image_alt: null,
    case_study: null,
    image_2_url: null,
    image_2_alt: null,
    image_3_url: null,
    image_3_alt: null,
    created_at: "2026-10-26T00:00:00.000Z",
    updated_at: "2026-10-26T00:00:00.000Z",
    ...overrides,
  };
}

// ============================================================
// migration 019
// ============================================================

describe("migration 019", () => {
  it("media_assets: 로그인 사용자만 조회·추가·삭제, anon은 못 본다", async () => {
    await asRole(db, "authenticated", (tx) =>
      tx.query(
        `insert into public.media_assets (sha256, kind, name, storage_path, url, og_storage_path, og_url, mime, width, height, bytes, og_bytes)
         values ($1, 'photo', 'a.jpg', $2, $3, $4, $5, 'image/webp', 10, 10, 100, 100)`,
        [sha(1), `library/${sha(1)}.webp`, libUrl(1), `library/${sha(1)}-og.jpg`, ogUrl(1)]
      )
    );
    expect((await asRole(db, "anon", (tx) => tx.query("select * from public.media_assets"))).rows).toEqual([]);
    await expect(
      asRole(db, "anon", (tx) =>
        tx.query(
          `insert into public.media_assets (sha256, kind, name, storage_path, url, og_storage_path, og_url, mime, width, height, bytes, og_bytes)
           values ($1, 'photo', 'b.jpg', $2, $3, $4, $5, 'image/webp', 10, 10, 100, 100)`,
          [sha(2), `library/${sha(2)}.webp`, libUrl(2), `library/${sha(2)}-og.jpg`, ogUrl(2)]
        )
      )
    ).rejects.toThrow();
    await asRole(db, "anon", (tx) => tx.query("delete from public.media_assets"));
    expect(await count("select count(*)::int as n from public.media_assets")).toBe(1);
    await asRole(db, "authenticated", (tx) => tx.query("delete from public.media_assets"));
    expect(await count("select count(*)::int as n from public.media_assets")).toBe(0);
  });

  it("제약: 2MB 상한, 경로는 library/{sha256}, 이름은 대소문자 무시하고 겹치지 않음", async () => {
    await insertAsset(1, "현장.JPG");
    await expect(insertAsset(2, "현장.jpg")).rejects.toThrow(/media_assets_name_lower_key/);
    await expect(
      db.query(
        `insert into public.media_assets (sha256, kind, name, storage_path, url, og_storage_path, og_url, mime, width, height, bytes, og_bytes)
         values ($1, 'photo', 'big', $2, $3, $4, $5, 'image/webp', 10, 10, 2097153, 100)`,
        [sha(3), `library/${sha(3)}.webp`, libUrl(3), `library/${sha(3)}-og.jpg`, ogUrl(3)]
      )
    ).rejects.toThrow();
    await expect(
      db.query(
        `insert into public.media_assets (sha256, kind, name, storage_path, url, og_storage_path, og_url, mime, width, height, bytes, og_bytes)
         values ($1, 'photo', 'path', 'landing-pages/x.webp', $2, $3, $4, 'image/webp', 10, 10, 100, 100)`,
        [sha(4), libUrl(4), `library/${sha(4)}-og.jpg`, ogUrl(4)]
      )
    ).rejects.toThrow();
    await expect(insertAsset(1, "다른 이름")).rejects.toThrow(); // 같은 sha256
  });

  it("사진 2·3 칸(페이지·대기열), 대표 로고 칸, 설명 200자·주소 500자 제한", async () => {
    await insertPage("p", { image_2_url: libUrl(1), image_2_alt: "가".repeat(200), image_3_url: libUrl(2) });
    await expect(insertPage("q", { image_2_alt: "가".repeat(201) })).rejects.toThrow();
    await expect(insertQueue("q2", { image_3_url: `https://x.test/${"a".repeat(500)}` })).rejects.toThrow();
    await db.query("update public.site_profile set logo_url = $1", [libUrl(9)]);
    expect((await db.query("select logo_url from public.site_profile")).rows).toEqual([{ logo_url: libUrl(9) }]);
  });

  it("Storage: 버킷 상한 2MB, 업로드는 library/·landing-pages/ 경로만", async () => {
    // Supabase는 storage.objects에 역할 권한을 기본으로 준다(테스트 흉내에는 없어 여기서 준다). 막는 건 RLS 정책.
    await db.exec("grant select, insert on storage.objects to anon, authenticated");
    await db.exec(
      "insert into storage.buckets (id, name, public) values ('landing-page-assets', 'landing-page-assets', true) on conflict (id) do nothing"
    );
    await db.exec(readMigration("019_photo_library.sql"));
    expect((await db.query("select file_size_limit from storage.buckets where id = 'landing-page-assets'")).rows).toEqual([
      { file_size_limit: 2097152 },
    ]);
    const upload = (name: string) =>
      asRole(db, "authenticated", (tx) =>
        tx.query("insert into storage.objects (bucket_id, name) values ('landing-page-assets', $1)", [name])
      );
    await upload(`library/${sha(1)}.webp`);
    await upload("landing-pages/abc/main.png");
    await expect(upload("other/x.png")).rejects.toThrow();
    await expect(
      asRole(db, "anon", (tx) =>
        tx.query("insert into storage.objects (bucket_id, name) values ('landing-page-assets', 'library/y.webp')")
      )
    ).rejects.toThrow();
  });

  it("두 번 적용해도 되고, 019_down 후 다시 적용할 수 있다(다른 테이블 행은 그대로)", async () => {
    await insertPage("keep", { image_2_url: libUrl(1) });
    await db.exec(readMigration("019_photo_library.sql"));
    await db.exec(readRollback("019_down.sql"));
    expect((await db.query("select to_regclass('public.media_assets') as t")).rows).toEqual([{ t: null }]);
    expect(
      (await db.query("select count(*)::int as n from information_schema.columns where column_name like 'image_%_url'")).rows
    ).toEqual([{ n: 0 }]);
    expect(await count("select count(*)::int as n from public.landing_pages")).toBe(1);
    // 되돌린 뒤에도 016 공개 함수로 공개가 된다
    await insertQueue("after-down");
    const result = await asRole(db, "authenticated", (tx) =>
      tx.query<{ r: { published: number } }>("select public.publish_queued_landing_pages(10) as r")
    );
    expect(result.rows[0].r.published).toBe(1);
    await db.exec(readMigration("019_photo_library.sql"));
    expect((await db.query("select to_regclass('public.media_assets') as t")).rows).toEqual([{ t: "media_assets" }]);
  });

  it("공개 함수: 사진 2·3과 설명을 공개 페이지로 복사하고, 사진3만 있어도 얇은 페이지가 아니다", async () => {
    await db.query("update public.auto_publish_settings set noindex_thin_pages = true");
    await insertQueue("with-photo3", { image_3_url: libUrl(3), image_3_alt: "작업 후" });
    await insertQueue("with-photo2", { image_2_url: libUrl(2), image_2_alt: "작업 중" });
    await insertQueue("thin");
    const result = await asRole(db, "authenticated", (tx) =>
      tx.query<{ r: { published: number } }>("select public.publish_queued_landing_pages(10) as r")
    );
    expect(result.rows[0].r.published).toBe(3);
    const { rows } = await db.query(
      `select lp.slug, lp.image_2_url, lp.image_2_alt, lp.image_3_url, lp.image_3_alt, s.seo_noindex
         from public.landing_pages lp join public.landing_page_seo_settings s on s.landing_page_id = lp.id order by lp.slug`
    );
    expect(rows).toEqual([
      { slug: "thin", image_2_url: null, image_2_alt: null, image_3_url: null, image_3_alt: null, seo_noindex: true },
      { slug: "with-photo2", image_2_url: libUrl(2), image_2_alt: "작업 중", image_3_url: null, image_3_alt: null, seo_noindex: false },
      { slug: "with-photo3", image_2_url: null, image_2_alt: null, image_3_url: libUrl(3), image_3_alt: "작업 후", seo_noindex: false },
    ]);
  });
});

// ============================================================
// 보관함 규칙(순수 함수)
// ============================================================

describe("보관함 규칙·압축 계산", () => {
  it("경로·OG 주소: library/{sha256}.webp → library/{sha256}-og.jpg, 보관함 밖 주소는 null", () => {
    expect(buildLibraryPaths(sha(1), "image/webp")).toEqual({
      path: `library/${sha(1)}.webp`,
      ogPath: `library/${sha(1)}-og.jpg`,
    });
    expect(buildLibraryPaths(sha(1), "image/jpeg").path).toBe(`library/${sha(1)}.jpg`);
    expect(libraryOgUrlOf(libUrl(1))).toBe(ogUrl(1));
    expect(libraryOgUrlOf(`${libUrl(1)}?v=2`)).toBe(ogUrl(1));
    expect(libraryOgUrlOf(`${PUBLIC}/landing-pages/abc/main-1.png`)).toBeNull();
    expect(libraryOgUrlOf("https://img.example/a.jpg")).toBeNull();
    expect(libraryOgUrlOf(null)).toBeNull();
  });

  it("엑셀 사진 칸 해석: 주소는 그대로, 이름은 대소문자·확장자 없이도 찾고, 없거나 여럿이면 오류", () => {
    const library = [
      { name: "현장1.jpg", url: libUrl(1), description: "" },
      { name: "현장2.jpg", url: libUrl(2), description: "" },
      { name: "현장2.png", url: libUrl(3), description: "" },
    ];
    expect(resolvePhotoReference("", library)).toEqual({ kind: "empty" });
    expect(resolvePhotoReference(" https://img.example/a.jpg ", library)).toEqual({ kind: "url", url: "https://img.example/a.jpg" });
    expect(resolvePhotoReference("현장1.JPG", library)).toEqual({ kind: "library", url: libUrl(1), name: "현장1.jpg", description: "" });
    expect(resolvePhotoReference("현장1", library)).toEqual({ kind: "library", url: libUrl(1), name: "현장1.jpg", description: "" });
    expect(resolvePhotoReference("현장2", library)).toMatchObject({ kind: "ambiguous", names: ["현장2.jpg", "현장2.png"] });
    expect(resolvePhotoReference("현장2.png", library)).toMatchObject({ kind: "library", url: libUrl(3) });
    expect(resolvePhotoReference("없는사진.jpg", library)).toEqual({ kind: "not_found", value: "없는사진.jpg" });
    expect(resolvePhotoReference("ftp://x/a.jpg", library)).toMatchObject({ kind: "invalid_url" });
    expect(resolvePhotoReference("img.example/a.jpg", library)).toMatchObject({ kind: "invalid_url" });
    expect(photoNameCandidates(["현장1.JPG", "https://a.test/x.jpg", " ", "현장1.jpg"])).toEqual(["현장1.jpg"]);
  });

  it("이름 정리: 경로·제어 문자 제거, 200자, 겹치면 (2)(3)", () => {
    expect(sanitizeMediaName("C:\\photos\\현장 사진.jpg")).toBe("현장 사진.jpg");
    expect(sanitizeMediaName("a<b>\u0001.png")).toBe("ab.png");
    expect(sanitizeMediaName("")).toBe("사진");
    expect(sanitizeMediaName("가".repeat(300))).toHaveLength(200);
    expect(numberedMediaName("현장.jpg", 1)).toBe("현장.jpg");
    expect(numberedMediaName("현장.jpg", 2)).toBe("현장 (2).jpg");
    expect(numberedMediaName(`${"가".repeat(196)}.jpg`, 3)).toHaveLength(200);
  });

  it("압축 크기: 사진 긴 변 1600px·로고 512px(키우지 않음), og는 가운데를 1200×630 비율로 자름", () => {
    expect(MEDIA_PRESETS.photo).toMatchObject({ maxSide: 1600, quality: 0.8 });
    expect(MEDIA_PRESETS.logo.maxSide).toBe(512);
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(2000, 1000, 512)).toEqual({ width: 512, height: 256 });
    expect(coverCrop(1600, 1200, 1200, 630)).toEqual({ sx: 0, sy: 180, sw: 1600, sh: 840 });
    expect(coverCrop(4000, 1000, 1200, 630)).toEqual({ sx: 1048, sy: 0, sw: 1905, sh: 1000 });
  });

  it("HEIC는 형식이 비어 있어도 확장자로 알아보고 안내 문구로 거절", () => {
    expect(isHeicFile({ name: "IMG_0001.HEIC", type: "" })).toBe(true);
    expect(isHeicFile({ name: "a.jpg", type: "image/heif" })).toBe(true);
    expect(isHeicFile({ name: "a.jpg", type: "image/jpeg" })).toBe(false);
    expect(checkSourceFile({ name: "IMG_0001.heic", type: "image/heic", size: 100 })).toBe(HEIC_MESSAGE);
    expect(HEIC_MESSAGE).toContain("높은 호환성");
    expect(checkSourceFile({ name: "a.gif", type: "image/gif", size: 100 })).toBe("JPG, PNG, WEBP 사진만 올릴 수 있습니다.");
    expect(checkSourceFile({ name: "a.jpg", type: "image/jpeg", size: 31 * 1024 * 1024 })).toMatch(/30MB/);
    expect(checkSourceFile({ name: "a.jpg", type: "image/jpeg", size: 5 * 1024 * 1024 })).toBeNull();
  });
});

// ============================================================
// 보관함 등록·삭제
// ============================================================

describe("보관함 등록", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPA);
  });

  const input = (n: number, fileName = "현장.jpg") => ({
    sha256: sha(n),
    kind: "photo" as const,
    fileName,
    mime: "image/webp" as const,
    width: 1600,
    height: 1200,
  });
  const putFiles = (n: number, size = 300_000, ogSize = 150_000) => {
    storage.objects.set(`library/${sha(n)}.webp`, size);
    storage.objects.set(`library/${sha(n)}-og.jpg`, ogSize);
  };

  it("올라간 두 파일을 확인하고 서버가 만든 주소로 등록한다(크기는 Storage 기준)", async () => {
    putFiles(1, 321_000, 123_000);
    const result = await registerMediaAssetAction(input(1));
    expect(result.success).toBe(true);
    expect(result.reused).toBeUndefined();
    expect(result.asset).toMatchObject({
      name: "현장.jpg",
      url: libUrl(1),
      og_url: ogUrl(1),
      storage_path: `library/${sha(1)}.webp`,
      bytes: 321_000,
      og_bytes: 123_000,
    });
  });

  it("같은 사진(sha256)은 다시 저장하지 않고 기존 행을 돌려준다", async () => {
    putFiles(1);
    const first = await registerMediaAsset(input(1));
    const again = await registerMediaAsset(input(1, "다른이름.jpg"));
    expect(again).toMatchObject({ success: true, reused: true });
    expect(again.asset!.id).toBe(first.asset!.id);
    expect(await count("select count(*)::int as n from public.media_assets")).toBe(1);
    expect((await findMediaAssetByShaAction(sha(1))).asset?.id).toBe(first.asset!.id);
    expect((await findMediaAssetByShaAction("nope")).error).toBe("잘못된 요청입니다.");
  });

  it("이름이 겹치면 번호를 붙인다(대소문자 무시)", async () => {
    putFiles(1);
    putFiles(2);
    putFiles(3);
    await registerMediaAsset(input(1, "현장.jpg"));
    expect((await registerMediaAsset(input(2, "현장.JPG"))).asset!.name).toBe("현장 (2).JPG");
    expect((await registerMediaAsset(input(3, "현장.jpg"))).asset!.name).toBe("현장 (3).jpg");
  });

  it("파일이 없거나 2MB를 넘거나 목록 조회가 실패하면 등록하지 않는다", async () => {
    expect((await registerMediaAsset(input(1))).error).toBe("올린 파일을 찾지 못했습니다. 다시 올려주세요.");
    storage.objects.set(`library/${sha(2)}.webp`, 100);
    expect((await registerMediaAsset(input(2))).success).toBe(false); // OG 파일 없음
    putFiles(3, 2 * 1024 * 1024 + 1);
    expect((await registerMediaAsset(input(3))).error).toBe("파일 크기가 2MB를 넘거나 비어 있습니다.");
    putFiles(4);
    storage.failList = true;
    expect((await registerMediaAsset(input(4))).error).toBe("올린 파일을 확인하지 못했습니다.");
    expect(await count("select count(*)::int as n from public.media_assets")).toBe(0);
  });

  it("서버가 입력값을 다시 검사한다", async () => {
    putFiles(1);
    for (const bad of [
      { ...input(1), sha256: "x" },
      { ...input(1), kind: "video" },
      { ...input(1), mime: "image/gif" },
      { ...input(1), width: 0 },
      { ...input(1), height: 5000 },
      { ...input(1), fileName: 3 },
    ]) {
      expect(await registerMediaAssetAction(bad as never)).toEqual({ success: false, error: "잘못된 요청입니다." });
    }
  });
});

describe("삭제 안전장치(쓰는 사진은 지우지 않음)", () => {
  it("DB의 사진·로고 주소 칸이 모두 참조 확인 목록에 들어 있다(새 칸을 빠뜨리면 실패)", async () => {
    const { rows } = await db.query<{ t: string; c: string }>(
      `select table_name as t, column_name as c from information_schema.columns
        where table_schema = 'public' and (column_name like '%image%url' or column_name like '%logo%url')
        order by 1, 2`
    );
    const listed = IMAGE_REFERENCE_COLUMNS.map((ref) => `${ref.table}.${ref.column}`).sort();
    expect(rows.map((r) => `${r.t}.${r.c}`)).toEqual(listed);
    expect(listed).toEqual(
      expect.arrayContaining([
        "landing_pages.image_2_url",
        "landing_pages.image_3_url",
        "landing_page_queue.image_2_url",
        "landing_page_queue.image_3_url",
        "site_profile.logo_url",
      ])
    );
  });

  /** 칸마다 그 칸에서 url을 쓰게 만든다 */
  async function reference(ref: (typeof IMAGE_REFERENCE_COLUMNS)[number], url: string) {
    if (ref.table === "landing_pages") return insertPage(`ref-${ref.column}`, { [ref.column]: url });
    if (ref.table === "landing_page_seo_settings") {
      const id = await insertPage("ref-seo");
      return db.query("insert into public.landing_page_seo_settings (landing_page_id, og_image_url) values ($1, $2)", [id, url]);
    }
    if (ref.table === "landing_page_queue") return insertQueue(`ref-${ref.column.replace(/_/g, "-")}`, { [ref.column]: url });
    return db.query("update public.site_profile set logo_url = $1", [url]);
  }

  it.each(IMAGE_REFERENCE_COLUMNS.map((ref) => [ref.label, ref] as const))(
    "%s에서 쓰는 사진은 지우지 않는다(파일·목록 모두 그대로)",
    async (label, ref) => {
      const id = await insertAsset(1, "현장.jpg");
      await reference(ref, libUrl(1));
      const result = await deleteMediaAssetAction(id);
      expect(result.success).toBe(false);
      expect(result.error).toContain(`${label} 1곳`);
      expect(await count("select count(*)::int as n from public.media_assets")).toBe(1);
      expect(storage.removed).toEqual([]);
    }
  );

  it("OG 파일 주소를 쓰고 있어도 지우지 않는다", async () => {
    const id = await insertAsset(1, "현장.jpg");
    const pageId = await insertPage("og");
    await db.query("insert into public.landing_page_seo_settings (landing_page_id, og_image_url) values ($1, $2)", [pageId, ogUrl(1)]);
    expect((await deleteMediaAssetAction(id)).error).toContain("OG 이미지 1곳");
  });

  it("공개된 대기열 항목만 쓰는 사진은 지울 수 있다(페이지가 주소를 따로 가짐)", async () => {
    const id = await insertAsset(1, "현장.jpg");
    await insertQueue("done", { state: "published", image_2_url: libUrl(1) });
    expect(await deleteMediaAssetAction(id)).toEqual({ success: true });
    expect(await count("select count(*)::int as n from public.media_assets")).toBe(0);
    expect(storage.removed).toEqual([[`library/${sha(1)}.webp`, `library/${sha(1)}-og.jpg`]]);
  });

  it("쓰는 곳 확인이 실패하면 지우지 않는다", async () => {
    const id = await insertAsset(1, "현장.jpg");
    await db.exec("alter table public.landing_pages rename column image_3_url to image_3_url_x");
    const result = await deleteMediaAssetAction(id);
    expect(result).toEqual({ success: false, error: "사진을 쓰는 곳을 확인하지 못했습니다. 지우지 않았습니다." });
    expect(await count("select count(*)::int as n from public.media_assets")).toBe(1);
  });

  it("잘못된 id·없는 사진", async () => {
    expect(await deleteMediaAssetAction("x")).toEqual({ success: false, error: "잘못된 요청입니다." });
    expect((await deleteMediaAssetAction("99999999-9999-4999-8999-999999999999")).error).toMatch(/찾을 수 없습니다/);
  });

  it("예전 페이지별 파일 정리(removeLandingPageImageByUrl): 사진2·3·대표 로고가 쓰면 남기고, 보관함 파일은 건드리지 않는다", async () => {
    const legacy = `${PUBLIC}/landing-pages/abc/main-1.png`;
    await insertPage("uses-photo2", { image_2_url: legacy });
    await removeLandingPageImageByUrl(useClient() as never, legacy);
    expect(storage.removed).toEqual([]);

    await db.query("update public.landing_pages set image_2_url = null");
    await db.query("update public.site_profile set logo_url = $1", [legacy]);
    await removeLandingPageImageByUrl(useClient() as never, legacy);
    expect(storage.removed).toEqual([]);

    await db.query("update public.site_profile set logo_url = null");
    await removeLandingPageImageByUrl(useClient() as never, legacy);
    expect(storage.removed).toEqual([["landing-pages/abc/main-1.png"]]);

    await removeLandingPageImageByUrl(useClient() as never, libUrl(1));
    expect(storage.removed).toHaveLength(1);
  });

  it("countImageReferences는 여러 주소를 한 번에 센다", async () => {
    await insertPage("a", { main_image_url: libUrl(1), image_3_url: ogUrl(1) });
    await insertQueue("b", { image_2_url: libUrl(1) });
    const result = await countImageReferences(useClient() as never, [libUrl(1), ogUrl(1)]);
    expect(result).toEqual({
      total: 3,
      places: [
        { label: "페이지 사진1", count: 1 },
        { label: "페이지 사진3", count: 1 },
        { label: "대기열 사진2", count: 1 },
      ],
      error: null,
    });
  });

  it("보관함 화면 사용 수: 칸마다 센 합", async () => {
    await insertPage("a", { main_image_url: libUrl(1), logo_url: libUrl(2) });
    await insertPage("b", { image_2_url: libUrl(1) });
    const { data, error } = await getUsedImageUrlCounts();
    expect(error).toBeNull();
    expect(Object.fromEntries(data)).toEqual({ [libUrl(1)]: 2, [libUrl(2)]: 1 });
  });
});

// ============================================================
// 페이지 사진·로고 저장
// ============================================================

describe("페이지 사진 3장 + 로고 저장", () => {
  const photos = (patch: Partial<typeof EMPTY_PHOTOS> = {}) => ({ ...EMPTY_PHOTOS, ...patch });

  it("수정 화면 저장: 칸 7개를 한 번에 바꾸고 빈 칸은 null", async () => {
    const id = await insertPage("a", { main_image_url: libUrl(9), image_3_url: libUrl(8) });
    const result = await updateLandingPagePhotosAction(
      id,
      photos({ logoUrl: libUrl(1), mainImageUrl: libUrl(2), mainImageAlt: " 대표 ", image2Url: libUrl(3), image2Alt: "작업 중" })
    );
    expect(result).toEqual({ success: true });
    const { rows } = await db.query(
      "select logo_url, main_image_url, main_image_alt, image_2_url, image_2_alt, image_3_url, image_3_alt from public.landing_pages"
    );
    expect(rows).toEqual([
      {
        logo_url: libUrl(1),
        main_image_url: libUrl(2),
        main_image_alt: "대표",
        image_2_url: libUrl(3),
        image_2_alt: "작업 중",
        image_3_url: null,
        image_3_alt: null,
      },
    ]);
    // 보관함 파일은 페이지에서 빠져도 지우지 않는다
    expect(storage.removed).toEqual([]);
  });

  it("서버 재검사: 주소 형식·길이, 설명 200자, 잘못된 id", async () => {
    const id = await insertPage("a");
    expect(await updateLandingPagePhotosAction("x", photos())).toEqual({ success: false, error: "잘못된 요청입니다." });
    expect((await updateLandingPagePhotosAction(id, photos({ image2Url: "javascript:alert(1)" }))).error).toBe(
      "사진2 주소는 http:// 또는 https://로 시작해야 합니다."
    );
    expect((await updateLandingPagePhotosAction(id, photos({ image3Alt: "가".repeat(201) }))).error).toBe(
      "사진3 설명은 200자 이내로 입력해주세요."
    );
    expect((await updateLandingPagePhotosAction(id, photos({ logoUrl: `https://a.test/${"a".repeat(500)}` }))).error).toMatch(
      /500자/
    );
    expect(validateLandingPagePhotosInput({ ...photos(), mainImageUrl: 3 }).error).toBe("잘못된 요청입니다.");
    expect(validateLandingPagePhotosInput(null).error).toBe("잘못된 요청입니다.");
    expect((await db.query("select image_2_url from public.landing_pages")).rows).toEqual([{ image_2_url: null }]);
  });

  it("만들기 화면: 고른 사진·로고를 페이지와 함께 저장, 사진 검사 실패면 만들지 않는다", async () => {
    const values = {
      businessName: "원케어",
      title: "제목",
      slug: "new-page",
      heroText: "",
      description: "",
      phone: "",
      kakaoUrl: "",
      address: "",
      template: "template-a",
      status: "public" as const,
    };
    const bad = await createLandingPageAction({ ...values, slug: "bad-page" }, photos({ image2Url: "ftp://x" }));
    expect(bad.success).toBe(false);
    const created = await createLandingPageAction(values, photos({ mainImageUrl: libUrl(1), image3Url: libUrl(2), image3Alt: "후" }));
    expect(created.success).toBe(true);
    const { rows } = await db.query("select slug, main_image_url, image_3_url, image_3_alt, logo_url from public.landing_pages");
    expect(rows).toEqual([{ slug: "new-page", main_image_url: libUrl(1), image_3_url: libUrl(2), image_3_alt: "후", logo_url: null }]);
  });

  it("복제는 사진 2·3과 설명을 같은 주소로 가져가고, 페이지를 지워도 보관함 파일은 남는다", async () => {
    const id = await insertPage("src", {
      main_image_url: libUrl(1),
      main_image_alt: "대표",
      image_2_url: libUrl(2),
      image_2_alt: "중",
      image_3_url: libUrl(3),
      image_3_alt: "후",
    });
    await db.query("insert into public.landing_page_seo_settings (landing_page_id) values ($1)", [id]).catch(() => undefined);
    const copy = await duplicateLandingPageAction(id, { businessName: "업체", title: "제목", slug: "src-copy", status: "private" });
    expect(copy.success).toBe(true);
    const { rows } = await db.query(
      "select main_image_alt, image_2_url, image_2_alt, image_3_url, image_3_alt from public.landing_pages where slug = 'src-copy'"
    );
    expect(rows).toEqual([{ main_image_alt: "대표", image_2_url: libUrl(2), image_2_alt: "중", image_3_url: libUrl(3), image_3_alt: "후" }]);
    expect((await deleteLandingPageAction(id)).success).toBe(true);
    expect(storage.removed).toEqual([]);
  });

  it("대표 업체 로고: 저장·지우기, 형식이 틀리면 거절", async () => {
    expect(await updateSiteProfileLogoAction(libUrl(5))).toEqual({ success: true });
    expect((await getSiteProfile()).logoUrl).toBe(libUrl(5));
    expect((await updateSiteProfileLogoAction("data:image/png;base64,xx")).success).toBe(false);
    expect(await updateSiteProfileLogoAction(3)).toEqual({ success: false, error: "잘못된 요청입니다." });
    expect(await updateSiteProfileLogoAction("")).toEqual({ success: true });
    expect((await db.query("select logo_url from public.site_profile")).rows).toEqual([{ logo_url: null }]);
  });

  it("019 적용 전(logo_url 칸 없음)에도 대표 업체 정보는 읽힌다", async () => {
    await db.query("update public.site_profile set business_name = '원케어배관'");
    await db.exec("alter table public.site_profile drop column logo_url");
    expect(await getSiteProfile()).toMatchObject({ businessName: "원케어배관", logoUrl: null });
  });
});

// ============================================================
// 공개 화면·SEO
// ============================================================

describe("랜딩 화면 사진 갤러리·로고·og:image·구조화 데이터", () => {
  const site = { businessName: "원케어배관", description: null, phone: null, kakaoUrl: null, logoUrl: libUrl(7) };
  const withPhotos = page({
    main_image_url: libUrl(1),
    image_2_url: libUrl(2),
    image_2_alt: "배관 교체 중",
    image_3_url: libUrl(3),
  });

  it("사진 목록·설명 자동값: 사진1 '지역 키워드 현장', 사진2·3은 뒤에 번호", () => {
    expect(getLandingPhotos(withPhotos)).toEqual([
      { url: libUrl(1), alt: "산본동 배관 수리 현장", position: 1 },
      { url: libUrl(2), alt: "배관 교체 중", position: 2 },
      { url: libUrl(3), alt: "산본동 배관 수리 현장 3", position: 3 },
    ]);
    expect(getGalleryPhotos(withPhotos).map((p) => p.position)).toEqual([2, 3]);
    expect(getLandingPhotos(page({ image_3_url: " " }))).toEqual([]);
  });

  it.each(["template-a", "template-b"])("%s: 갤러리에 사진2·3이 <img alt>로 나온다(없으면 섹션 없음)", (template) => {
    const html = renderToStaticMarkup(<LandingPageRenderer landingPage={{ ...withPhotos, template }} faqs={[]} mode="preview" />);
    expect(html).toContain("현장 사진");
    expect(html).toMatch(new RegExp(`<img[^>]*alt="배관 교체 중"[^>]*src="${libUrl(2).replace(/[.?]/g, "\\$&")}"`));
    expect(html).toContain('alt="산본동 배관 수리 현장 3"');
    const plain = renderToStaticMarkup(<LandingPageRenderer landingPage={page({ template })} faqs={[]} mode="preview" />);
    expect(plain).not.toContain("현장 사진");
  });

  it("로고: 페이지 로고 → 업체명이 대표 업체와 같을 때만 대표 로고", () => {
    expect(resolvePageLogoUrl(page({ logo_url: libUrl(1) }), site)).toBe(libUrl(1));
    expect(resolvePageLogoUrl(page(), site)).toBe(libUrl(7));
    expect(resolvePageLogoUrl(page({ business_name: "원케어배관 산본점" }), site)).toBeNull();
    expect(resolvePageLogoUrl(page(), { businessName: null, logoUrl: libUrl(7) })).toBeNull();

    const same = renderToStaticMarkup(<LandingPageRenderer landingPage={page()} faqs={[]} siteBusiness={site} mode="preview" />);
    expect(same).toContain('alt="원케어배관 로고"');
    const other = renderToStaticMarkup(
      <LandingPageRenderer landingPage={page({ business_name: "다른업체" })} faqs={[]} siteBusiness={site} mode="preview" />
    );
    expect(other).not.toContain("로고");
  });

  it("og:image: 전용 OG → 사진1의 1200×630 JPEG → 사진1(외부 주소) → 로고(대표 로고 포함)", () => {
    expect(resolveAutoOgImage(withPhotos, site)).toEqual({ url: ogUrl(1), width: 1200, height: 630 });
    expect(resolveAutoOgImage(page({ main_image_url: "https://img.example/a.jpg" }), site)).toEqual({ url: "https://img.example/a.jpg" });
    expect(resolveAutoOgImage(page(), site)).toEqual({ url: libUrl(7) });
    expect(resolveAutoOgImage(page(), null)).toBeNull();

    const meta = buildLandingPageMetadata(withPhotos, null, site);
    expect(meta.openGraph?.images).toEqual([{ url: ogUrl(1), width: 1200, height: 630 }]);
    const manual = resolveLandingPageSeo(withPhotos, { og_image_url: "https://img.example/og.jpg" } as never, site);
    expect(manual.ogImage).toBe("https://img.example/og.jpg");
    expect(manual.ogImageSize).toBeUndefined();
  });

  it("구조화 데이터: image는 사진 배열, logo는 같은 업체면 대표 로고, 홈 업체에도 로고", () => {
    const seo = resolveLandingPageSeo(withPhotos, null, site);
    const ld = buildOrganizationJsonLd(withPhotos, seo, site) as Record<string, unknown>;
    expect(ld.image).toEqual([libUrl(1), libUrl(2), libUrl(3)]);
    expect(ld.logo).toBe(libUrl(7));
    const none = buildOrganizationJsonLd(page({ business_name: "다른업체" }), resolveLandingPageSeo(page(), null), site) as Record<
      string,
      unknown
    >;
    expect(none).not.toHaveProperty("image");
    expect(none).not.toHaveProperty("logo");
    expect(buildSiteBusinessJsonLd(site, [])).toMatchObject({ logo: libUrl(7) });
    expect(buildSiteBusinessJsonLd({ ...site, logoUrl: null }, [])).not.toHaveProperty("logo");
  });
});

// ============================================================
// 엑셀 대량 등록
// ============================================================

describe("엑셀 사진2·3 칸", () => {
  const HEADERS = BULK_UPLOAD_COLUMNS.map((c) => c.header);
  const ctx = (library = [] as { name: string; url: string; description?: string }[]) => ({
    existingSlugs: [],
    existingPairs: [],
    corpus: [],
    thresholds: DEFAULT_SIMILARITY_THRESHOLDS,
    mediaLibrary: library.map((entry) => ({ description: "", ...entry })),
  });
  const base = (patch: Record<string, string> = {}) => ({
    region: "산본동",
    keyword: "배관 수리",
    regionSlug: "sanbon",
    keywordSlug: "pipe",
    businessName: "원케어",
    title: "산본동 배관 수리",
    description: "가".repeat(220),
    ...patch,
  });
  const check = (values: Record<string, string>, library?: { name: string; url: string; description?: string }[]) =>
    checkBulkUploadRows([{ rowNumber: 2, values, warnings: [] }], ctx(library)).rows[0];

  it("양식 맨 뒤 4칸 = 사진2, 사진2 설명, 사진3, 사진3 설명(AI가 비워 두는 칸)", () => {
    expect(HEADERS.slice(-4)).toEqual(["사진2", "사진2 설명", "사진3", "사진3 설명"]);
    expect(HEADERS).toHaveLength(29);
    expect(CUSTOMER_ONLY_FIELDS).toEqual(expect.arrayContaining(["image2Url", "image2Alt", "image3Url", "image3Alt"]));
    expect(buildTemplateSheet()[0].slice(-4).map((cell) => (cell as { value: string }).value)).toEqual(HEADERS.slice(-4));
  });

  it("이전 양식(25칸·20칸)과 머리글 없는 순서도 그대로 읽힌다", () => {
    for (const old of [HEADERS.slice(0, 25), HEADERS.slice(0, 20)]) {
      const row = old.map((_, i) => (i < 6 ? ["산본동", "배관", "sanbon", "pipe", "원케어", "제목"][i] : ""));
      const parsed = sheetToUploadRows([old, row]);
      expect(parsed.fileErrors).toEqual([]);
      expect(parsed.ignoredHeaders).toEqual([]);
      expect(parsed.rows[0].values).toMatchObject({ region: "산본동", businessName: "원케어" });
      expect(parsed.rows[0].values).not.toHaveProperty("image2Url");
    }
    const full = HEADERS.map((_, i) => (i < 6 ? ["산본동", "배관", "sanbon", "pipe", "원케어", "제목"][i] : ""));
    full[25] = "현장1.jpg";
    full[26] = "작업 중";
    expect(sheetToUploadRows([HEADERS, full]).rows[0].values).toMatchObject({ image2Url: "현장1.jpg", image2Alt: "작업 중" });
  });

  it("보관함 이름은 주소로 바꿔 저장하고, 주소는 그대로", () => {
    const row = check(
      base({ mainImageUrl: "대표.jpg", image2Url: "현장1", image2Alt: "작업 중", image3Url: "https://img.example/3.jpg" }),
      [
        { name: "대표.jpg", url: libUrl(1) },
        { name: "현장1.jpg", url: libUrl(2), description: "" },
      ]
    );
    expect(row.errors).toEqual([]);
    expect(row.queueRow).toMatchObject({
      main_image_url: libUrl(1),
      image_2_url: libUrl(2),
      image_2_alt: "작업 중",
      image_3_url: "https://img.example/3.jpg",
      image_3_alt: null,
    });
  });

  it("보관함에 없는 이름·여러 장과 맞는 이름·틀린 주소는 검사에서 오류", () => {
    const missing = check(base({ image2Url: "없는사진.jpg" }));
    expect(missing.status).toBe("error");
    expect(missing.errors).toEqual([
      {
        code: "photo_not_found",
        fields: ["image2Url"],
        message: '사진2: 사진 보관함에 "없는사진.jpg" 사진이 없습니다. 보관함에 먼저 올리거나 http(s) 주소를 써주세요.',
      },
    ]);
    const ambiguous = check(base({ image3Url: "현장" }), [
      { name: "현장.jpg", url: libUrl(1), description: "" },
      { name: "현장.png", url: libUrl(2), description: "" },
    ]);
    expect(ambiguous.errors.map((e) => e.code)).toEqual(["photo_ambiguous"]);
    expect(check(base({ mainImageUrl: "img.example/a.jpg" })).errors.map((e) => e.message)).toEqual([
      "대표 사진 URL은 http:// 또는 https://로 시작하는 주소만 입력할 수 있습니다.",
    ]);
    expect(check(base({ image3Url: "ftp://x/a.jpg" })).errors.map((e) => e.message)).toEqual([
      "사진3 주소는 http:// 또는 https://로 시작하는 주소만 입력할 수 있습니다.",
    ]);
    expect(check(base({ image2Alt: "가".repeat(201) })).errors.map((e) => e.message)).toEqual(["사진2 설명은 200자 이내로 입력해주세요."]);
  });

  it("얇은 페이지 경고는 사진2·3만 있어도 사라진다", () => {
    const thin = (patch: Record<string, string>) =>
      check({ ...base({ description: "짧음" }), ...patch }, [{ name: "a.jpg", url: libUrl(1) }]).warnings.map((w) => w.code);
    expect(thin({})).toContain("thin_page");
    expect(thin({ image2Url: "a.jpg" })).not.toContain("thin_page");
    expect(thin({ image3Url: "https://img.example/a.jpg" })).not.toContain("thin_page");
  });

  it("대기열 저장(서버 재검사): 보관함 이름을 DB에서 찾아 주소로 저장, 없는 이름 행은 건너뜀", async () => {
    await insertAsset(1, "현장1.jpg");
    const rows = [
      { rowNumber: 2, values: base({ image2Url: "현장1.JPG", image2Alt: "작업 중" }), warnings: [] },
      { rowNumber: 3, values: base({ region: "금정동", regionSlug: "geumjeong", image3Url: "없음.jpg" }), warnings: [] },
    ];
    expect(collectPhotoValues(rows)).toEqual(["현장1.JPG", "없음.jpg"]);
    const result = await enqueueUploadRows({ rows, holdSimilar: false, batchId: "11111111-1111-4111-8111-111111111111" });
    expect(result.error).toBeNull();
    expect(result.results.map((r) => r.outcome)).toEqual(["ready", "skipped"]);
    expect(result.results[1].reason).toMatch(/없음\.jpg/);
    expect((await db.query("select slug, image_2_url, image_2_alt from public.landing_page_queue")).rows).toEqual([
      { slug: "sanbon-pipe", image_2_url: libUrl(1), image_2_alt: "작업 중" },
    ]);
  });

  it("대기열 수정 화면도 보관함 이름을 받는다", async () => {
    await insertAsset(2, "현장2.jpg");
    const id = await insertQueue("edit-me", { state: "draft" });
    const result = await updateQueueItem(id, { ...base({ regionSlug: "edit", keywordSlug: "me", slug: "edit-me" }), image3Url: "현장2" }, "ready");
    expect(result.success).toBe(true);
    expect((await db.query("select image_3_url from public.landing_page_queue where id = $1", [id])).rows).toEqual([
      { image_3_url: libUrl(2) },
    ]);
    const bad = await updateQueueItem(id, { ...base({ slug: "edit-me" }), image2Url: "없음" }, "ready");
    expect(bad.success).toBe(false);
    expect(bad.errors?.[0]).toMatch(/사진 보관함에 "없음"/);
  });

  it("보관함 이름 찾기: 확장자 없이 쓴 이름도 후보에 넣는다", async () => {
    await insertAsset(1, "현장1.jpg");
    await insertAsset(2, "다른.jpg");
    const { data } = await getMediaLibraryEntries(["현장1"]);
    expect(data).toEqual([{ name: "현장1.jpg", url: libUrl(1), description: "" }]);
    expect((await getMediaLibraryEntries([])).data).toEqual([]);
  });
});

// ============================================================
// 백업 version 4
// ============================================================

describe("백업 version 4", () => {
  it("내보내기: 사진 2·3 칸, 대표 업체(로고 포함), 보관함 목록, 사진2·3 파일 목록", async () => {
    await insertAsset(1, "현장1.jpg");
    await insertPage("a", { image_2_url: libUrl(1), image_2_alt: "중", image_3_url: `${PUBLIC}/landing-pages/x/main.png` });
    await insertQueue("q", { image_3_url: libUrl(1) });
    await db.query("update public.site_profile set business_name = '원케어배관', logo_url = $1", [libUrl(1)]);

    const { success, backup } = await buildBackupFile();
    expect(success).toBe(true);
    expect(backup!.version).toBe(4);
    expect(BACKUP_VERSION).toBe(4);
    expect(backup!.data.landingPages[0]).toMatchObject({ image_2_url: libUrl(1), image_2_alt: "중" });
    expect(backup!.data.publishQueue[0]).toMatchObject({ image_3_url: libUrl(1), image_2_url: null });
    expect(backup!.data.siteProfile).toEqual({
      business_name: "원케어배관",
      description: null,
      phone: null,
      kakao_url: null,
      logo_url: libUrl(1),
    });
    expect(backup!.data.mediaAssets.map((a) => a.name)).toEqual(["현장1.jpg"]);
    expect(backup!.data.storageManifest.map((m) => [m.kind, m.path])).toEqual([
      ["image2", null],
      ["image3", "landing-pages/x/main.png"],
    ]);
  });

  function v4File(data: Record<string, unknown>) {
    return JSON.stringify({
      format: BACKUP_FORMAT,
      version: 4,
      exportedAt: "2026-10-26T00:00:00.000Z",
      site: "https://example.test",
      data: {
        landingPages: [],
        seoSettings: [],
        faqs: [],
        consultations: [],
        events: [],
        siteVerificationSettings: null,
        storageManifest: [],
        publishQueue: [],
        siteProfile: null,
        mediaAssets: [],
        ...data,
      },
    });
  }

  const backupPage = (id: string, slug: string, extra: Record<string, unknown> = {}) => ({
    id,
    business_name: "업체",
    title: "제목",
    slug,
    hero_text: null,
    description: null,
    phone: null,
    kakao_url: null,
    address: null,
    logo_url: null,
    main_image_url: null,
    template: "template-a",
    status: "public",
    published_at: null,
    region: null,
    keyword: null,
    city: null,
    city_slug: null,
    main_image_alt: null,
    case_study: null,
    image_2_url: libUrl(2),
    image_2_alt: "중",
    image_3_url: null,
    image_3_alt: null,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-02T00:00:00.000Z",
    ...extra,
  });
  const asset = (n: number, name: string, id = `0000000${n}-0000-4000-8000-000000000000`) => ({
    id,
    sha256: sha(n),
    kind: "photo",
    name,
    description: "",
    storage_path: `library/${sha(n)}.webp`,
    url: libUrl(n),
    og_storage_path: `library/${sha(n)}-og.jpg`,
    og_url: ogUrl(n),
    mime: "image/webp",
    width: 1600,
    height: 1200,
    bytes: 300000,
    og_bytes: 150000,
    created_at: "2026-10-01T00:00:00.000Z",
  });

  it("읽기: 사진 칸이 없거나 틀린 행·보관함 행은 빼고 센다", () => {
    const pageId = "00000000-0000-4000-8000-000000000001";
    const missingPhotoKeys = backupPage("00000000-0000-4000-8000-000000000002", "b");
    delete (missingPhotoKeys as Record<string, unknown>).image_3_alt;
    const parsed = parseAndValidateBackupFile(
      v4File({
        landingPages: [backupPage(pageId, "a"), missingPhotoKeys],
        mediaAssets: [asset(1, "a.jpg"), { ...asset(2, "b.jpg"), bytes: 3_000_000 }, { ...asset(3, "c.jpg"), storage_path: "landing-pages/x.webp" }],
        siteProfile: { business_name: "원케어배관", description: null, phone: null, kakao_url: null, logo_url: libUrl(1), __proto__: { x: 1 } },
      })
    );
    expect(parsed.success).toBe(true);
    expect(parsed.invalidCounts).toEqual({ landingPages: 1, mediaAssets: 2 });
    expect(parsed.backup!.data.landingPages[0]).toMatchObject({ image_2_url: libUrl(2), image_2_alt: "중" });
    expect(parsed.backup!.data.siteProfile).toEqual({
      business_name: "원케어배관",
      description: null,
      phone: null,
      kakao_url: null,
      logo_url: libUrl(1),
    });
    expect(parsed.backup!.data.mediaAssets.map((a) => a.name)).toEqual(["a.jpg"]);
  });

  it("복구: 사진 칸·대표 업체 로고를 되돌리고, 보관함 목록은 없는 것만 추가", async () => {
    const pageId = "00000000-0000-4000-8000-000000000001";
    const fake = setFakeSupabase(
      new FakeSupabase({
        tables: {
          landing_pages: [],
          landing_page_seo_settings: [],
          landing_page_faqs: [],
          consultation_requests: [],
          landing_page_events: [],
          landing_page_queue: [],
          site_verification_settings: [{ id: "default", google_site_verification: null, naver_site_verification: null }],
          site_profile: [{ id: "default", business_name: null, description: null, phone: null, kakao_url: null, logo_url: null }],
          media_assets: [{ ...asset(1, "이미있음.jpg"), id: "00000009-0000-4000-8000-000000000000" }],
        },
      })
    );
    const parsed = parseAndValidateBackupFile(
      v4File({
        landingPages: [backupPage(pageId, "a")],
        siteProfile: { business_name: "원케어배관", description: null, phone: null, kakao_url: null, logo_url: libUrl(1) },
        mediaAssets: [asset(1, "같은사진.jpg"), asset(2, "새사진.jpg"), asset(3, "이미있음.JPG")],
      })
    );
    const result = await executeMergeRestore(parsed.backup!);
    expect(result.status).toBe("success");
    expect(result.mediaAssets).toEqual({ inserted: 1, skipped: 2 });
    expect(result.siteProfile).toEqual({ updated: true });
    expect(fake.tables.landing_pages[0]).toMatchObject({ image_2_url: libUrl(2), image_2_alt: "중", image_3_url: null });
    expect(fake.tables.site_profile[0]).toMatchObject({ business_name: "원케어배관", logo_url: libUrl(1) });
    expect(fake.tables.media_assets.map((row) => row.name)).toEqual(["이미있음.jpg", "새사진.jpg"]);
  });

  it("version 3 파일을 복구하면 사진 2·3 칸과 대표 업체는 지금 값 그대로", async () => {
    const pageId = "00000000-0000-4000-8000-000000000001";
    const fake = setFakeSupabase(
      new FakeSupabase({
        tables: {
          landing_pages: [{ ...backupPage(pageId, "a"), image_2_url: "https://keep.test/2.jpg" }],
          landing_page_seo_settings: [],
          landing_page_faqs: [],
          consultation_requests: [],
          landing_page_events: [],
          landing_page_queue: [],
          site_verification_settings: [{ id: "default", google_site_verification: null, naver_site_verification: null }],
          site_profile: [{ id: "default", business_name: "지금", description: null, phone: null, kakao_url: null, logo_url: "https://keep.test/logo.png" }],
          media_assets: [],
        },
      })
    );
    const v3Page = backupPage(pageId, "a", { title: "백업 제목" }) as Record<string, unknown>;
    for (const key of ["image_2_url", "image_2_alt", "image_3_url", "image_3_alt"]) delete v3Page[key];
    const parsed = parseAndValidateBackupFile(
      JSON.stringify({ ...JSON.parse(v4File({ landingPages: [v3Page] })), version: 3 })
    );
    expect(parsed.backup!.data.siteProfile).toBeNull();
    const result = await executeMergeRestore(parsed.backup!);
    expect(result.status).toBe("success");
    expect(fake.tables.landing_pages[0]).toMatchObject({ title: "백업 제목", image_2_url: "https://keep.test/2.jpg" });
    expect(fake.tables.site_profile[0]).toMatchObject({ business_name: "지금", logo_url: "https://keep.test/logo.png" });
  });
});

// ============================================================
// 화면(정적 렌더링)
// ============================================================

describe("관리자 화면(정적 렌더링)", () => {
  const assetRow = (n: number, name: string) => ({
    id: `0000000${n}-0000-4000-8000-000000000000`,
    sha256: sha(n),
    kind: "photo" as const,
    name,
    description: "",
    storage_path: `library/${sha(n)}.webp`,
    url: libUrl(n),
    og_storage_path: `library/${sha(n)}-og.jpg`,
    og_url: ogUrl(n),
    mime: "image/webp" as const,
    width: 1600,
    height: 1200,
    bytes: 300_000,
    og_bytes: 150_000,
    created_at: "2026-10-26T00:00:00.000Z",
  });

  it("사진 보관함: 여러 장 올리기, 이름·크기, 쓰는 사진은 삭제 버튼이 꺼져 있다", () => {
    const html = renderToStaticMarkup(
      <MediaLibraryPanel
        items={[assetRow(1, "쓰는사진.jpg"), assetRow(2, "안쓰는사진.jpg")]}
        usedCounts={{ [libUrl(1)]: 2, [ogUrl(1)]: 1 }}
        usageError={null}
        search=""
        kind="all"
      />
    );
    expect(html).toContain('multiple=""');
    expect(html).toContain(".heic");
    expect(text(html)).toContain("쓰는사진.jpg 사진 · 1600×1200 · 439KB 사용 중 3곳");
    expect(text(html)).toContain("안쓰는사진.jpg 사진 · 1600×1200 · 439KB 쓰는 곳 없음");
    const buttons = Array.from(html.matchAll(/<button[^>]*>삭제<\/button>/g)).map((m) => m[0]);
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toContain('disabled=""');
    expect(buttons[1]).not.toContain('disabled=""');
    const failed = renderToStaticMarkup(
      <MediaLibraryPanel items={[assetRow(2, "a.jpg")]} usedCounts={{}} usageError="확인 실패." search="" kind="all" />
    );
    expect(failed).toMatch(/<button[^>]*disabled[^>]*>삭제<\/button>/);
  });

  it("페이지 사진 칸: 로고 + 사진 1~3과 설명, 수정 화면은 '사진 저장' 버튼", () => {
    const html = renderToStaticMarkup(
      <LandingPagePhotosCard photos={{ ...EMPTY_PHOTOS, image2Url: libUrl(2) }} onChange={() => undefined} landingPageId="x" />
    );
    for (const label of ["로고", "사진1(대표)", "사진2", "사진3", "사진2 설명(alt)", "사진3 설명(alt)", "사진 저장"]) {
      expect(text(html)).toContain(label);
    }
    expect(html).toContain(`src="${libUrl(2)}"`);
    const create = renderToStaticMarkup(<LandingPagePhotosCard photos={EMPTY_PHOTOS} onChange={() => undefined} />);
    expect(create).not.toContain("사진 저장");
  });

  it("대기열 수정 화면: 사진2·3과 설명 칸·로고 칸, 사진 칸마다 '보관함에서 고르기'", () => {
    const html = renderToStaticMarkup(<QueueItemForm id="x" initialValues={{ image2Url: libUrl(2) }} currentState="ready" />);
    expect(html).toContain('id="queue-image2Url"');
    expect(html).toContain('id="queue-image3Alt"');
    expect(html).toContain(`value="${libUrl(2)}"`);
    expect(html).toContain('id="queue-logoUrl"');
    // 사진1~3 + 로고
    expect(Array.from(html.matchAll(/보관함에서 고르기/g))).toHaveLength(4);
  });

  it("관리자 메뉴에 '사진 보관함'", () => {
    const html = renderToStaticMarkup(<AdminSidebar />);
    expect(html).toContain('href="/admin/media"');
    expect(text(html)).toContain("사진 보관함");
  });
});
