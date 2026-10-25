/**
 * migration 017(사이트 대표 업체): 단일 행, 글자 수 제약, 권한(anon은 읽기만, 로그인 사용자는 수정),
 * 되돌리기 후 다시 적용, 앱 코드(lib/site-profile)로 읽기·저장.
 * 컴퓨터 안 Postgres(PGlite, migration 001~017)만 쓴다 — 운영 DB에는 연결하지 않는다.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite, PGliteInterface } from "@electric-sql/pglite";
import { asRole, createMigratedDb, readMigration, readRollback } from "./helpers/pglite-db";
import { PgliteSupabase } from "./helpers/pglite-supabase";
import { setFakeSupabase } from "./helpers/current-supabase";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { getSiteProfile, updateSiteProfile, EMPTY_SITE_PROFILE } = await import("@/lib/site-profile");
const { updateSiteProfileAction } = await import("@/app/admin/settings/actions");

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
});

describe("migration 017 site_profile", () => {
  it("'default' 한 행이 비어 있는 값으로 만들어진다", async () => {
    const { rows } = await db.query("select id, business_name, description, phone, kakao_url from public.site_profile");
    expect(rows).toEqual([{ id: "default", business_name: null, description: null, phone: null, kakao_url: null }]);
  });

  it("다른 id 행·글자 수 초과는 DB가 막는다", async () => {
    await expect(db.query("insert into public.site_profile (id) values ('other')")).rejects.toThrow(/check/);
    await expect(
      db.query("update public.site_profile set business_name = repeat('가', 101) where id = 'default'")
    ).rejects.toThrow(/check/);
    await expect(
      db.query("update public.site_profile set description = repeat('가', 321) where id = 'default'")
    ).rejects.toThrow(/check/);
  });

  it("anon(비로그인 방문자)은 읽기만 하고 쓰기는 못 한다", async () => {
    await db.query("update public.site_profile set business_name = '원케어배관' where id = 'default'");
    const read = await asRole(db, "anon", (tx) => tx.query("select business_name from public.site_profile"));
    expect(read.rows).toEqual([{ business_name: "원케어배관" }]);

    // RLS에 update 정책이 없으므로 0행 변경(오류 없이 무시) → 값 그대로
    await asRole(db, "anon", (tx) => tx.query("update public.site_profile set business_name = '해킹' where id = 'default'"));
    await expect(
      asRole(db, "anon", (tx) => tx.query("insert into public.site_profile (id) values ('default')"))
    ).rejects.toThrow();
    await asRole(db, "anon", (tx) => tx.query("delete from public.site_profile"));
    const after = await db.query("select business_name from public.site_profile");
    expect(after.rows).toEqual([{ business_name: "원케어배관" }]);
  });

  it("로그인 사용자(authenticated)는 수정할 수 있고 삭제는 못 한다", async () => {
    await asRole(db, "authenticated", (tx) =>
      tx.query("update public.site_profile set phone = '010-0000-0000' where id = 'default'")
    );
    await asRole(db, "authenticated", (tx) => tx.query("delete from public.site_profile"));
    const { rows } = await db.query("select phone from public.site_profile");
    expect(rows).toEqual([{ phone: "010-0000-0000" }]);
  });

  it("017을 두 번 적용해도 되고, 017_down 후 다시 적용할 수 있다(다른 테이블은 그대로)", async () => {
    const before = await db.query<{ n: number }>("select count(*)::int as n from public.landing_pages");
    await db.exec(readMigration("017_site_profile.sql"));
    await db.exec(readRollback("017_down.sql"));
    const gone = await db.query("select to_regclass('public.site_profile') as t");
    expect(gone.rows).toEqual([{ t: null }]);
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.landing_pages")).rows).toEqual(before.rows);
    await db.exec(readMigration("017_site_profile.sql"));
    expect((await db.query("select id from public.site_profile")).rows).toEqual([{ id: "default" }]);
  });
});

describe("lib/site-profile + 관리자 저장 action", () => {
  it("관리자가 저장한 값을 공개(anon) 조회로 그대로 읽는다", async () => {
    setFakeSupabase(new PgliteSupabase(db, "authenticated"));
    const saved = await updateSiteProfileAction({
      businessName: " 원케어배관 ",
      description: "누수탐지·배관청소\n점검",
      phone: "010-0000-0000",
      kakaoUrl: "https://open.kakao.com/o/site",
    });
    expect(saved).toEqual({ success: true });

    setFakeSupabase(new PgliteSupabase(db, "anon"));
    const profile = await getSiteProfile();
    expect(profile).toMatchObject({
      businessName: "원케어배관",
      description: "누수탐지·배관청소 점검",
      phone: "010-0000-0000",
      kakaoUrl: "https://open.kakao.com/o/site",
    });
    expect(profile.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("잘못된 입력은 DB에 쓰지 않는다", async () => {
    setFakeSupabase(new PgliteSupabase(db, "authenticated"));
    const result = await updateSiteProfileAction({ businessName: "x", description: "", phone: "", kakaoUrl: "ftp://x" });
    expect(result.success).toBe(false);
    expect((await db.query("select business_name from public.site_profile")).rows).toEqual([{ business_name: null }]);
  });

  it("anon으로 저장을 시도해도 값이 바뀌지 않는다(RLS)", async () => {
    setFakeSupabase(new PgliteSupabase(db, "anon"));
    await updateSiteProfile({ businessName: "해킹", description: null, phone: null, kakaoUrl: null });
    expect((await db.query("select business_name from public.site_profile")).rows).toEqual([{ business_name: null }]);
  });

  it("테이블이 없으면(017 적용 전) 빈 값으로 동작한다", async () => {
    await db.exec(readRollback("017_down.sql"));
    setFakeSupabase(new PgliteSupabase(db, "anon"));
    expect(await getSiteProfile()).toEqual(EMPTY_SITE_PROFILE);
  });
});
