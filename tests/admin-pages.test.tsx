import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdminPagesPage from "@/app/admin/pages/page";
import PageTable from "@/components/admin/PageTable";
import Pagination from "@/components/admin/Pagination";
import { getLandingPagesPage, LANDING_PAGES_PAGE_SIZE } from "@/lib/landing-pages";
import { buildFixture, createFakeSupabase, SIZES } from "./helpers/fixtures";
import { setFakeSupabase } from "./helpers/current-supabase";

/** 서버 컴포넌트가 반환한 React 엘리먼트 트리에서 특정 컴포넌트를 찾는다(렌더링 없이). */
function findElements(node: ReactNode, type: unknown): ReactElement[] {
  const found: ReactElement[] = [];
  const visit = (current: ReactNode) => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!isValidElement(current)) return;
    if (current.type === type) found.push(current);
    const props = current.props as { children?: ReactNode; action?: ReactNode };
    visit(props.children);
    visit(props.action);
  };
  visit(node);
  return found;
}

function expectedOrder(n: number) {
  // created_at desc, id desc
  return buildFixture(n)
    .landingPages.slice()
    .sort((a, b) =>
      a.created_at === b.created_at
        ? String(b.id).localeCompare(String(a.id))
        : String(b.created_at).localeCompare(String(a.created_at))
    )
    .map((lp) => lp.id as string);
}

describe("관리자 랜딩 목록 — getLandingPagesPage", () => {
  it.each(SIZES)("랜딩 %i개를 50개씩 나눠 빠짐없이, 순서대로 보여준다", async (n) => {
    setFakeSupabase(createFakeSupabase(buildFixture(n)));
    const totalPages = Math.max(1, Math.ceil(n / LANDING_PAGES_PAGE_SIZE));

    const seen: string[] = [];
    for (let page = 1; page <= totalPages; page += 1) {
      const { data, count, error } = await getLandingPagesPage(page);
      expect(error).toBeNull();
      expect(count).toBe(n);

      const expectedSize =
        page < totalPages ? LANDING_PAGES_PAGE_SIZE : n - LANDING_PAGES_PAGE_SIZE * (totalPages - 1);
      expect(data).toHaveLength(expectedSize);
      seen.push(...data.map((lp) => lp.id));
    }

    expect(seen).toEqual(expectedOrder(n));
  });

  it("1,200개면 24페이지이고 마지막 페이지는 50개", async () => {
    setFakeSupabase(createFakeSupabase(buildFixture(1200)));
    const { data, count } = await getLandingPagesPage(24);
    expect(Math.ceil(count / LANDING_PAGES_PAGE_SIZE)).toBe(24);
    expect(data).toHaveLength(50);
  });

  it("2,500개면 50페이지, 1,000개(경계값)면 20페이지", async () => {
    setFakeSupabase(createFakeSupabase(buildFixture(2500)));
    expect(Math.ceil((await getLandingPagesPage(1)).count / LANDING_PAGES_PAGE_SIZE)).toBe(50);
    setFakeSupabase(createFakeSupabase(buildFixture(1000)));
    expect(Math.ceil((await getLandingPagesPage(1)).count / LANDING_PAGES_PAGE_SIZE)).toBe(20);
  });

  it.each([1000, 1200, 2500])(
    "랜딩 %i개에서 범위 밖 페이지는 오류 없이 빈 목록 + 전체 건수를 돌려준다",
    async (n) => {
      setFakeSupabase(createFakeSupabase(buildFixture(n)));
      const outOfRange = Math.ceil(n / LANDING_PAGES_PAGE_SIZE) + 1;
      const result = await getLandingPagesPage(outOfRange);
      expect(result).toEqual({ data: [], count: n, error: null });

      const farAway = await getLandingPagesPage(9999);
      expect(farAway).toEqual({ data: [], count: n, error: null });
    }
  );

  it("0개일 때 1페이지는 빈 목록, 오류 없음", async () => {
    setFakeSupabase(createFakeSupabase(buildFixture(0)));
    expect(await getLandingPagesPage(1)).toEqual({ data: [], count: 0, error: null });
  });

  it("0 이하·잘못된 page 값은 1페이지로 취급한다", async () => {
    setFakeSupabase(createFakeSupabase(buildFixture(1200)));
    const first = await getLandingPagesPage(1);
    expect((await getLandingPagesPage(0)).data).toEqual(first.data);
    expect((await getLandingPagesPage(-3)).data).toEqual(first.data);
  });
});

describe("관리자 랜딩 목록 — 페이지 컴포넌트(/admin/pages)", () => {
  async function renderPage(n: number, pageParam?: string) {
    setFakeSupabase(createFakeSupabase(buildFixture(n)));
    return AdminPagesPage({
      searchParams: Promise.resolve(pageParam === undefined ? {} : { page: pageParam }),
    });
  }

  it("1,200개: ?page=2 → 50개 표시, Pagination 2/24, basePath=/admin/pages", async () => {
    const tree = await renderPage(1200, "2");
    const [table] = findElements(tree, PageTable);
    const [pagination] = findElements(tree, Pagination);

    expect((table.props as { pages: unknown[] }).pages).toHaveLength(50);
    expect(pagination.props).toMatchObject({
      page: 2,
      totalPages: 24,
      basePath: "/admin/pages",
    });
  });

  it("1,200개: ?page=24(마지막) → 50개, 다음 버튼 비활성", async () => {
    const tree = await renderPage(1200, "24");
    const [table] = findElements(tree, PageTable);
    const [pagination] = findElements(tree, Pagination);
    expect((table.props as { pages: unknown[] }).pages).toHaveLength(50);

    const html = renderToStaticMarkup(pagination);
    expect(html).toContain("24 / 24 페이지");
    expect(html).toContain('href="/admin/pages?page=23"');
    expect(html).not.toContain("page=25");
  });

  it("1,200개: ?page=99(범위 밖) → 빈 목록이지만 Pagination으로 돌아갈 수 있다", async () => {
    const tree = await renderPage(1200, "99");
    const [table] = findElements(tree, PageTable);
    const [pagination] = findElements(tree, Pagination);
    expect((table.props as { pages: unknown[] }).pages).toHaveLength(0);
    expect(pagination.props).toMatchObject({ page: 99, totalPages: 24 });
    expect(renderToStaticMarkup(pagination)).toContain('href="/admin/pages?page=98"');
  });

  it("?page 없음/잘못된 값 → 1페이지, 1페이지 링크에는 page 파라미터가 없다", async () => {
    for (const param of [undefined, "abc", "0"]) {
      const tree = await renderPage(1200, param);
      const [pagination] = findElements(tree, Pagination);
      expect(pagination.props).toMatchObject({ page: 1, totalPages: 24 });
    }
    const tree = await renderPage(1200, "2");
    const [pagination] = findElements(tree, Pagination);
    expect(renderToStaticMarkup(pagination)).toContain('href="/admin/pages"');
  });

  it("0개 → Pagination을 표시하지 않는다", async () => {
    const tree = await renderPage(0);
    expect(findElements(tree, Pagination)).toHaveLength(0);
  });

  it("Pagination 기본 basePath는 기존 상담 목록 그대로", () => {
    const html = renderToStaticMarkup(
      <Pagination page={1} totalPages={3} baseParams={{ status: "new" }} />
    );
    expect(html).toContain('href="/admin/consultations?status=new&amp;page=2"');
  });
});
