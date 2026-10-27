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
// 사진 설명·대기열 로고·AI 프롬프트·공통 사진 설정
const { altAfterPick, sanitizeMediaDescription } = await import("@/lib/media/library");
const { getLibraryPhotosForPrompt, listMediaAssets } = await import("@/lib/media-assets");
const { updateMediaAssetDescriptionAction } = await import("@/app/admin/media/actions");
const { buildBulkPrompts, maxUsesPerPhoto } = await import("@/lib/bulk-upload/prompt");
const { COMMON_PHOTO_SLOTS, applyCommonPhotos, parseCommonPhotoSettings } = await import(
  "@/lib/bulk-upload/common-photos"
);
const { default: CommonPhotoSettingsCard } = await import("@/components/admin/CommonPhotoSettingsCard");
const { default: PromptBuilderPanel } = await import("@/components/admin/PromptBuilderPanel");
const { default: MediaUploadInput } = await import("@/components/admin/MediaUploadInput");

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

async function insertAsset(n: number, name: string, kind: "photo" | "logo" = "photo", description = "") {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.media_assets
       (sha256, kind, name, description, storage_path, url, og_storage_path, og_url, mime, width, height, bytes, og_bytes)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'image/webp', 1600, 1200, 300000, 150000) returning id`,
    [sha(n), kind, name, description, `library/${sha(n)}.webp`, libUrl(n), `library/${sha(n)}-og.jpg`, ogUrl(n)]
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

  it("대기열 로고·보관함 설명도 내보내고 다시 읽는다", async () => {
    await insertAsset(1, "현장1.jpg", "photo", "정화조 작업 현장");
    await insertQueue("q", { logo_url: libUrl(1) });
    const { backup } = await buildBackupFile();
    expect(backup!.data.publishQueue[0]).toMatchObject({ logo_url: libUrl(1) });
    expect(backup!.data.mediaAssets[0]).toMatchObject({ name: "현장1.jpg", description: "정화조 작업 현장" });

    const parsed = parseAndValidateBackupFile(JSON.stringify(backup));
    expect(parsed.success).toBe(true);
    expect(parsed.backup!.data.publishQueue[0]).toMatchObject({ logo_url: libUrl(1) });
    expect(parsed.backup!.data.mediaAssets[0].description).toBe("정화조 작업 현장");

    // version 4 대기열 행에 로고 칸이 없으면 그 행만 뺀다
    const raw = JSON.parse(JSON.stringify(backup));
    delete raw.data.publishQueue[0].logo_url;
    expect(parseAndValidateBackupFile(JSON.stringify(raw)).invalidCounts).toMatchObject({ publishQueue: 1 });
  });

  it("보관함 설명: 없으면 빈 값, 200자를 넘거나 문자열이 아니면 그 행만 뺀다", () => {
    const { description: _omit, ...withoutDescription } = asset(1, "a.jpg");
    void _omit;
    const parsed = parseAndValidateBackupFile(
      v4File({
        mediaAssets: [
          withoutDescription,
          { ...asset(2, "b.jpg"), description: "가".repeat(201) },
          { ...asset(3, "c.jpg"), description: 3 },
          { ...asset(4, "d.jpg"), description: "배관 내시경" },
        ],
      })
    );
    expect(parsed.invalidCounts).toEqual({ mediaAssets: 2 });
    expect(parsed.backup!.data.mediaAssets.map((a) => [a.name, a.description])).toEqual([
      ["a.jpg", ""],
      ["d.jpg", "배관 내시경"],
    ]);
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

// ============================================================
// 사진 설명(보관함) · 대기열 로고 · AI 프롬프트 · 공통 사진 설정
// ============================================================

const SAMPLE_VALUES = {
  region: "산본동",
  keyword: "배관 수리",
  regionSlug: "sanbon",
  keywordSlug: "pipe",
  businessName: "원케어",
  title: "산본동 배관 수리",
  description: "가".repeat(220),
};
const checkCtx = (library: { name: string; url: string; description?: string }[] = []) => ({
  existingSlugs: [],
  existingPairs: [],
  corpus: [],
  thresholds: DEFAULT_SIMILARITY_THRESHOLDS,
  mediaLibrary: library.map((entry) => ({ description: "", ...entry })),
});
const checkOne = (values: Record<string, string>, library?: { name: string; url: string; description?: string }[]) =>
  checkBulkUploadRows([{ rowNumber: 2, values, warnings: [] }], checkCtx(library)).rows[0];

describe("019 보강: 보관함 설명·대기열 로고", () => {
  it("설명 칸: 기본값 빈 값, 200자 제한. 로그인 사용자만 고칠 수 있다(anon은 0행)", async () => {
    const id = await insertAsset(1, "a.jpg");
    expect((await db.query("select description from public.media_assets where id = $1", [id])).rows).toEqual([
      { description: "" },
    ]);
    await expect(db.query("update public.media_assets set description = $1", ["가".repeat(201)])).rejects.toThrow();

    await asRole(db, "anon", (tx) => tx.query("update public.media_assets set description = 'anon'"));
    await asRole(db, "authenticated", (tx) => tx.query("update public.media_assets set description = '정화조'"));
    expect((await db.query("select description from public.media_assets")).rows).toEqual([{ description: "정화조" }]);
  });

  it("대기열 logo_url 칸(500자): 공개할 때 페이지 로고로 복사하고, 019_down이 지운다", async () => {
    await insertQueue("with-logo", { logo_url: libUrl(9) });
    await insertQueue("no-logo");
    await expect(insertQueue("too-long", { logo_url: `https://x/${"a".repeat(500)}` })).rejects.toThrow();
    await asRole(db, "authenticated", (tx) => tx.query("select public.publish_queued_landing_pages(10)"));
    expect((await db.query("select slug, logo_url from public.landing_pages order by slug")).rows).toEqual([
      { slug: "no-logo", logo_url: null },
      { slug: "with-logo", logo_url: libUrl(9) },
    ]);

    await db.exec(readRollback("019_down.sql"));
    const columns = await db.query(
      "select 1 from information_schema.columns where table_name = 'landing_page_queue' and column_name = 'logo_url'"
    );
    expect(columns.rows).toEqual([]);
  });

  it("대기열 로고로 쓰는 보관함 사진은 지우지 않는다", async () => {
    const id = await insertAsset(9, "로고.png", "logo");
    await insertQueue("q", { logo_url: libUrl(9) });
    const result = await deleteMediaAssetAction(id);
    expect(result.success).toBe(false);
    expect(result.error).toContain("대기열 로고 1곳");
    expect(IMAGE_REFERENCE_COLUMNS).toContainEqual(
      expect.objectContaining({ table: "landing_page_queue", column: "logo_url", unpublishedOnly: true })
    );
  });
});

describe("보관함 사진 설명", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPA);
  });
  const putFiles = (n: number) => {
    storage.objects.set(`library/${sha(n)}.webp`, 300_000);
    storage.objects.set(`library/${sha(n)}-og.jpg`, 150_000);
  };
  const input = (n: number, description?: unknown) => ({
    sha256: sha(n),
    kind: "photo" as const,
    fileName: `현장${n}.jpg`,
    description,
    mime: "image/webp" as const,
    width: 1600,
    height: 1200,
  });

  it("정리: 줄바꿈·제어 문자·연속 공백을 정리하고 200자까지", () => {
    expect(sanitizeMediaDescription("  정화조\n작업\t\t현장  ")).toBe("정화조 작업 현장");
    expect(sanitizeMediaDescription("<b>배관</b>")).toBe("b 배관 /b");
    expect(sanitizeMediaDescription("가".repeat(250))).toHaveLength(200);
  });

  it("올릴 때 적은 설명을 저장하고, 같은 사진을 다시 올리면 비어 있을 때만 채운다", async () => {
    putFiles(1);
    const first = await registerMediaAssetAction(input(1, " 배관 내시경 "));
    expect(first.asset?.description).toBe("배관 내시경");
    const again = await registerMediaAssetAction(input(1, "다른 설명"));
    expect(again.reused).toBe(true);
    expect(again.asset?.description).toBe("배관 내시경");

    putFiles(2);
    await registerMediaAssetAction(input(2));
    const filled = await registerMediaAssetAction(input(2, "정화조 작업 현장"));
    expect(filled.asset?.description).toBe("정화조 작업 현장");
    expect((await registerMediaAssetAction(input(3, 3))).error).toBe("잘못된 요청입니다.");
  });

  it("보관함에서 설명 고치기: 정리해서 저장, 잘못된 요청·없는 사진은 거절", async () => {
    const id = await insertAsset(1, "a.jpg");
    const result = await updateMediaAssetDescriptionAction(id, "  정화조\n작업 현장 ");
    expect(result).toMatchObject({ success: true, asset: { id, description: "정화조 작업 현장" } });
    expect((await updateMediaAssetDescriptionAction(id, "")).asset?.description).toBe("");
    expect(await updateMediaAssetDescriptionAction("not-uuid", "x")).toEqual({ success: false, error: "잘못된 요청입니다." });
    expect(await updateMediaAssetDescriptionAction(id, 3)).toEqual({ success: false, error: "잘못된 요청입니다." });
    expect((await updateMediaAssetDescriptionAction("99999999-9999-4999-8999-999999999999", "x")).error).toMatch(
      /찾을 수 없습니다/
    );
  });

  it("검색은 이름과 설명 모두에서 찾는다", async () => {
    await insertAsset(1, "a.jpg", "photo", "정화조 작업 현장");
    await insertAsset(2, "정화조.jpg", "photo");
    await insertAsset(3, "c.jpg", "photo", "배관 내시경");
    const { data } = await listMediaAssets({ search: "정화조" });
    expect(data.map((a) => a.name).sort()).toEqual(["a.jpg", "정화조.jpg"]);
  });

  it("고른 사진의 설명: 지금 설명이 비어 있을 때만 보관함 설명을 쓴다", () => {
    expect(altAfterPick("", { description: "배관 내시경" })).toBe("배관 내시경");
    expect(altAfterPick("   ", { description: " 배관 " })).toBe("배관");
    expect(altAfterPick(null, { description: "" })).toBe("");
    expect(altAfterPick("직접 쓴 설명", { description: "배관 내시경" })).toBe("직접 쓴 설명");
  });
});

describe("엑셀 사진 칸: 보관함 설명을 alt로, 로고 칸", () => {
  const library = [
    { name: "현장1.jpg", url: libUrl(1), description: "정화조 작업 현장" },
    { name: "현장2.jpg", url: libUrl(2), description: "" },
    { name: "로고.png", url: libUrl(9), description: "" },
  ];

  it("보관함 사진이고 설명 칸이 비면 보관함 설명, 적은 설명은 그대로, 주소·설명 없는 사진은 비움", () => {
    const row = checkOne(
      {
        ...SAMPLE_VALUES,
        mainImageUrl: "현장1",
        image2Url: "현장1.jpg",
        image2Alt: "직접 쓴 설명",
        image3Url: "현장2.jpg",
      },
      library
    );
    expect(row.errors).toEqual([]);
    expect(row.queueRow).toMatchObject({
      main_image_url: libUrl(1),
      main_image_alt: "정화조 작업 현장",
      image_2_alt: "직접 쓴 설명",
      image_3_url: libUrl(2),
      image_3_alt: null,
    });
    const byUrl = checkOne({ ...SAMPLE_VALUES, mainImageUrl: "https://img.example/1.jpg" }, library);
    expect(byUrl.queueRow).toMatchObject({ main_image_url: "https://img.example/1.jpg", main_image_alt: null });
  });

  it("로고 칸: 보관함 이름·주소를 받고, 없는 이름·틀린 주소는 오류", () => {
    expect(checkOne({ ...SAMPLE_VALUES, logoUrl: "로고" }, library).queueRow.logo_url).toBe(libUrl(9));
    expect(checkOne({ ...SAMPLE_VALUES, logoUrl: "https://img.example/logo.png" }, library).queueRow.logo_url).toBe(
      "https://img.example/logo.png"
    );
    expect(checkOne(SAMPLE_VALUES, library).queueRow.logo_url).toBeNull();

    const missing = checkOne({ ...SAMPLE_VALUES, logoUrl: "없는로고.png" }, library);
    expect(missing.errors.map((e) => [e.code, e.fields, e.message])).toEqual([
      ["photo_not_found", ["logoUrl"], expect.stringContaining('로고: 사진 보관함에 "없는로고.png" 사진이 없습니다')],
    ]);
    const invalid = checkOne({ ...SAMPLE_VALUES, logoUrl: "ftp://x/logo.png" }, library);
    expect(invalid.errors[0]).toMatchObject({ code: "invalid_url", message: expect.stringContaining("로고 주소는") });
    expect(collectPhotoValues([{ values: { mainImageUrl: "a", logoUrl: "로고.png" } }])).toEqual(["a", "로고.png"]);
  });

  it("엑셀에 '로고' 머리글을 넣으면 인식한다(양식에는 없는 선택 칸)", () => {
    const headers = [...BULK_UPLOAD_COLUMNS.map((c) => c.header), "로고"];
    const row = headers.map((_, i) => (i < 6 ? ["산본동", "배관", "sanbon", "pipe", "원케어", "제목"][i] : ""));
    row[headers.length - 1] = "로고.png";
    const parsed = sheetToUploadRows([headers, row]);
    expect(parsed.ignoredHeaders).toEqual([]);
    expect(parsed.rows[0].values).toMatchObject({ logoUrl: "로고.png" });
    expect(BULK_UPLOAD_COLUMNS.map((c) => c.header)).not.toContain("로고");
  });

  it("대기열 저장 → 공개: 보관함 설명 alt와 로고가 페이지까지 간다", async () => {
    await insertAsset(1, "현장1.jpg", "photo", "정화조 작업 현장");
    await insertAsset(9, "로고.png", "logo");
    const rows = [{ rowNumber: 2, values: { ...SAMPLE_VALUES, mainImageUrl: "현장1.jpg", logoUrl: "로고.png" }, warnings: [] }];
    const result = await enqueueUploadRows({ rows, holdSimilar: false, batchId: "11111111-1111-4111-8111-111111111111" });
    expect(result.results.map((r) => r.outcome)).toEqual(["ready"]);
    expect((await db.query("select main_image_url, main_image_alt, logo_url from public.landing_page_queue")).rows).toEqual([
      { main_image_url: libUrl(1), main_image_alt: "정화조 작업 현장", logo_url: libUrl(9) },
    ]);
    await asRole(db, "authenticated", (tx) => tx.query("select public.publish_queued_landing_pages(10)"));
    expect((await db.query("select main_image_alt, logo_url from public.landing_pages")).rows).toEqual([
      { main_image_alt: "정화조 작업 현장", logo_url: libUrl(9) },
    ]);
  });

  it("대기열 수정: 로고 칸에 보관함 이름을 쓰면 주소로 저장", async () => {
    await insertAsset(9, "로고.png", "logo");
    const id = await insertQueue("edit-logo", { state: "draft" });
    const result = await updateQueueItem(
      id,
      { ...SAMPLE_VALUES, regionSlug: "edit", keywordSlug: "logo", slug: "edit-logo", logoUrl: "로고.png" },
      "ready"
    );
    expect(result.success).toBe(true);
    expect((await db.query("select logo_url from public.landing_page_queue where id = $1", [id])).rows).toEqual([
      { logo_url: libUrl(9) },
    ]);
  });
});

describe("AI 프롬프트: 보관함 사진 목록", () => {
  const region = { name: "산본동", slug: "sanbon" };
  const keyword = { name: "배관 수리", slug: "pipe" };
  const business = {
    businessName: "원케어",
    phone: "",
    kakaoUrl: "",
    address: "",
    template: "template-a",
    industry: "",
  };
  const photos = [
    { name: "배관내시경.jpg", description: "배관 내시경으로 막힌 곳 확인" },
    { name: "하수구\t뚫음.jpg", description: "하수구\n작업" },
    { name: "배관교체후.jpg", description: "" },
  ];
  const section = (prompt: string, title: string) => prompt.split(`[${title}`)[1]?.split("\n\n")[0] ?? "";

  it("보관함 목록(로고 제외, 이름 순)을 1,000장 넘어도 전부 읽는다", async () => {
    await db.query(
      `insert into public.media_assets
         (sha256, kind, name, description, storage_path, url, og_storage_path, og_url, mime, width, height, bytes, og_bytes)
       select lpad(to_hex(i), 64, '0'), case when i = 1 then 'logo' else 'photo' end, 'p' || lpad(i::text, 4, '0') || '.jpg',
              '설명 ' || i, 'library/' || lpad(to_hex(i), 64, '0') || '.webp', 'https://x.test/' || i || '.webp',
              'library/' || lpad(to_hex(i), 64, '0') || '-og.jpg', 'https://x.test/' || i || '-og.jpg', 'image/webp', 10, 10, 1, 1
         from generate_series(1, 1201) as i`
    );
    const { data, error } = await getLibraryPhotosForPrompt();
    expect(error).toBeNull();
    expect(data).toHaveLength(1200);
    expect(data[0]).toEqual({ name: "p0002.jpg", description: "설명 2" });
    expect(data.at(-1)).toEqual({ name: "p1201.jpg", description: "설명 1201" });
  });

  it("사진이 없으면 예전 프롬프트 그대로(사진 칸은 비워 둠)", () => {
    const { prompts } = buildBulkPrompts({ regions: [region], keywords: [keyword], business });
    expect(prompts[0].text).not.toContain("[사진 보관함");
    expect(prompts[0].text).not.toMatch(/^9\./m);
    expect(section(prompts[0].text, "비워 둘 칸")).toContain("대표 사진 URL");
    expect(buildBulkPrompts({ regions: [region], keywords: [keyword], business, photos: [] }).prompts[0].text).toBe(
      prompts[0].text
    );
  });

  it("사진이 있으면: 목록(파일 이름: 설명), 사진 칸은 AI가 파일 이름으로, 설명 칸은 비워 두기, 고르게 나누기 규칙", () => {
    const { prompts } = buildBulkPrompts({ regions: [region], keywords: [keyword], business, photos });
    const prompt = prompts[0].text;
    expect(section(prompt, "사진 보관함")).toBe(
      [
        " — 사진 칸에 쓸 수 있는 사진 3장(파일 이름: 설명)]",
        "- 배관내시경.jpg: 배관 내시경으로 막힌 곳 확인",
        "- 하수구 뚫음.jpg: 하수구 작업",
        "- 배관교체후.jpg",
      ].join("\n")
    );
    const empty = section(prompt, "비워 둘 칸");
    expect(empty).not.toContain("대표 사진 URL");
    expect(empty).toContain("- 시/군, city_slug, 현장 사례\n");
    expect(empty.match(/사진2 설명/g)).toHaveLength(1);
    expect(empty).toContain("고른 사진의 보관함 설명이 자동으로 들어갑니다");
    expect(prompt).toContain(
      "9. 행마다 페이지 내용(지역·키워드·문구)에 맞는 사진을 [사진 보관함]에서 골라 대표 사진 URL·사진2·사진3 칸에 파일 이름을"
    );
    expect(prompt).toContain("목록에 없는 파일 이름이나 인터넷 주소는 쓰지 마세요");
    expect(prompt).toContain("같은 사진이 여러 행에 몰리지 않게 고르게 나눠 쓰세요(이 요청에서 한 사진은 1번까지)");
    // 입력 표 머리글·행 수는 그대로
    expect(prompt).toContain(`[입력 표] (1행)\n${BULK_UPLOAD_COLUMNS.map((c) => c.header).join("\t")}`);
  });

  it("한 사진 최대 사용 횟수 = 칸 수(행 × 3) ÷ 사진 수(올림), 나눈 프롬프트마다 따로 센다", () => {
    expect(maxUsesPerPhoto(6, 4)).toBe(5);
    expect(maxUsesPerPhoto(50, 200)).toBe(1);
    expect(maxUsesPerPhoto(10, 3)).toBe(10);
    expect(maxUsesPerPhoto(3, 0)).toBe(0);
    const regions = Array.from({ length: 12 }, (_, i) => ({ name: `지역${i}`, slug: `r${i}` }));
    const keywords = Array.from({ length: 5 }, (_, i) => ({ name: `키워드${i}`, slug: `k${i}` }));
    const tenPhotos = Array.from({ length: 10 }, (_, i) => ({ name: `p${i}.jpg`, description: "" }));
    const { prompts } = buildBulkPrompts({ regions, keywords, business, photos: tenPhotos });
    expect(prompts.map((p) => p.count)).toEqual([50, 10]);
    expect(prompts[0].text).toContain("한 사진은 15번까지");
    expect(prompts[1].text).toContain("한 사진은 3번까지");
  });

  it("프롬프트 화면: 보관함 사진 수 안내, 비었을 때·못 불러왔을 때 안내", () => {
    const withPhotos = text(renderToStaticMarkup(<PromptBuilderPanel libraryPhotos={photos} />));
    expect(withPhotos).toContain("사진 보관함의 사진 3장(파일 이름·설명)이 프롬프트에 들어갑니다");
    const none = text(
      renderToStaticMarkup(<PromptBuilderPanel libraryPhotosError="사진 보관함 목록을 불러오지 못했습니다." />)
    );
    expect(none).toContain("사진 보관함에 사진이 없어 사진 칸은 비워 둡니다");
    expect(none).toContain("사진 보관함 목록을 불러오지 못했습니다.");
  });
});

describe("올리기 화면 공통 사진 설정", () => {
  const settings = {
    logoUrl: { name: "로고.png", url: libUrl(9) },
    mainImageUrl: { name: "현장1.jpg", url: libUrl(1) },
    image2Url: { name: "현장2.jpg", url: libUrl(2) },
    image3Url: { name: "현장3.jpg", url: libUrl(3) },
  };
  const row = (rowNumber: number, values: Record<string, string> = {}) => ({
    rowNumber,
    values: { ...SAMPLE_VALUES, ...values },
    warnings: [],
  });

  it("칸: 로고(로고 보관함)·대표 사진·현장 사진2·3", () => {
    expect(COMMON_PHOTO_SLOTS.map((s) => [s.field, s.kind])).toEqual([
      ["logoUrl", "logo"],
      ["mainImageUrl", "photo"],
      ["image2Url", "photo"],
      ["image3Url", "photo"],
    ]);
  });

  it("빈 칸에만 넣고(행 우선), 같은 행에 이미 있는 사진은 다시 넣지 않는다. 원래 행은 그대로", () => {
    const rows = [
      row(2),
      row(3, { mainImageUrl: "다른.jpg", logoUrl: "https://img.example/logo.png" }),
      row(4, { image2Url: "현장1.JPG" }),
      row(5, { image3Url: libUrl(2) }),
      row(6, { mainImageUrl: "a.jpg", image2Url: "b.jpg", image3Url: "c.jpg", logoUrl: "d.png" }),
    ];
    const snapshot = JSON.stringify(rows);
    const { rows: applied, filledRows } = applyCommonPhotos(rows, settings);
    expect(JSON.stringify(rows)).toBe(snapshot);
    expect(filledRows).toBe(4);
    const pick = (i: number) => {
      const v = applied[i].values;
      return [v.logoUrl, v.mainImageUrl, v.image2Url, v.image3Url];
    };
    expect(pick(0)).toEqual(["로고.png", "현장1.jpg", "현장2.jpg", "현장3.jpg"]);
    expect(pick(1)).toEqual(["https://img.example/logo.png", "다른.jpg", "현장2.jpg", "현장3.jpg"]);
    // 사진2에 이미 현장1(대소문자 달라도 같은 이름) → 사진1에는 넣지 않음
    expect(pick(2)).toEqual(["로고.png", undefined, "현장1.JPG", "현장3.jpg"]);
    // 사진3에 현장2 주소 → 사진2에는 넣지 않음
    expect(pick(3)).toEqual(["로고.png", "현장1.jpg", undefined, libUrl(2)]);
    expect(applied[4]).toBe(rows[4]);
    expect(applyCommonPhotos(rows, {})).toEqual({ rows, filledRows: 0 });
  });

  it("넣은 뒤 검사: 이름이 주소로, 설명 칸은 보관함 설명, 로고까지", () => {
    const library = [
      { name: "로고.png", url: libUrl(9) },
      { name: "현장1.jpg", url: libUrl(1), description: "정화조 작업 현장" },
      { name: "현장2.jpg", url: libUrl(2), description: "배관 내시경" },
      { name: "현장3.jpg", url: libUrl(3) },
    ];
    const { rows } = applyCommonPhotos([row(2, { image2Alt: "직접 쓴 설명" })], settings);
    const checked = checkBulkUploadRows(rows, checkCtx(library)).rows[0];
    expect(checked.errors).toEqual([]);
    expect(checked.queueRow).toMatchObject({
      logo_url: libUrl(9),
      main_image_url: libUrl(1),
      main_image_alt: "정화조 작업 현장",
      image_2_url: libUrl(2),
      image_2_alt: "직접 쓴 설명",
      image_3_url: libUrl(3),
      image_3_alt: null,
    });
    // 그 사이 보관함에서 지운 사진이면 검사 오류로 알린다
    const gone = checkBulkUploadRows(rows, checkCtx(library.slice(0, 1))).rows[0];
    expect(gone.errors.map((e) => e.code)).toEqual(["photo_not_found", "photo_not_found", "photo_not_found"]);
  });

  it("기억한 값 읽기: 형식이 틀리거나 모르는 칸은 버린다", () => {
    expect(parseCommonPhotoSettings(null)).toEqual({});
    expect(parseCommonPhotoSettings("{not json")).toEqual({});
    expect(parseCommonPhotoSettings("[1,2]")).toEqual({});
    expect(
      parseCommonPhotoSettings(
        JSON.stringify({
          logoUrl: { name: "로고.png", url: libUrl(9), extra: 1 },
          mainImageUrl: { name: "", url: libUrl(1) },
          image2Url: { name: "a.jpg" },
          image3Url: "현장3.jpg",
          caseStudy: { name: "x", url: "y" },
        })
      )
    ).toEqual({ logoUrl: { name: "로고.png", url: libUrl(9) } });
  });

  it("화면: 칸 4개, 고른 칸은 이름·바꾸기·비우기", () => {
    const html = renderToStaticMarkup(
      <CommonPhotoSettingsCard settings={{ mainImageUrl: settings.mainImageUrl }} onChange={() => undefined} />
    );
    const plain = text(html);
    for (const label of ["로고", "대표 사진(사진1)", "현장 사진(사진2)", "현장 사진(사진3)"]) expect(plain).toContain(label);
    expect(plain).toContain("현장1.jpg");
    expect(html.match(/보관함에서 고르기/g)).toHaveLength(3);
    expect(html.match(/>바꾸기</g)).toHaveLength(1);
    expect(html.match(/>비우기</g)).toHaveLength(1);
    expect(plain).toContain("사진 칸이 빈 행에만");
  });
});

describe("보관함 화면: 설명 칸", () => {
  it("사진마다 설명 입력칸(현재 값), 썸네일 alt는 설명, 올리기에도 설명 칸", () => {
    const asset = {
      id: "00000001-0000-4000-8000-000000000000",
      sha256: sha(1),
      kind: "photo" as const,
      name: "a.jpg",
      description: "배관 내시경",
      storage_path: `library/${sha(1)}.webp`,
      url: libUrl(1),
      og_storage_path: `library/${sha(1)}-og.jpg`,
      og_url: ogUrl(1),
      mime: "image/webp" as const,
      width: 1600,
      height: 1200,
      bytes: 300_000,
      og_bytes: 150_000,
      created_at: "2026-10-26T00:00:00.000Z",
    };
    const html = renderToStaticMarkup(
      <MediaLibraryPanel items={[asset]} usedCounts={{}} usageError={null} search="" kind="all" />
    );
    expect(html).toMatch(/aria-label="a\.jpg 설명"[^>]*value="배관 내시경"|value="배관 내시경"[^>]*aria-label="a\.jpg 설명"/);
    expect(html).toContain('alt="배관 내시경"');
    const upload = renderToStaticMarkup(<MediaUploadInput kind="photo" multiple onUploaded={() => undefined} />);
    expect(upload).toContain('id="media-upload-description"');
    expect(text(upload)).toContain("사진 설명(alt)으로도 쓰임");
  });
});
