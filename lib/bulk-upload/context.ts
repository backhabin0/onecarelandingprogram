import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";
import type { CorpusEntry } from "./check";
import { similarityText } from "./similarity";

/**
 * 대량 등록 검사에 필요한 DB 정보(이미 쓰는 slug, 대기열의 지역·키워드,
 * 같은 키워드의 기존 문구)를 모은다. 모든 조회는 1,000행씩 끝까지 읽는다.
 */

/** `.in()` 한 번에 넣는 값 개수. URL 길이 제한(대략 8~16KB)을 넘지 않게 작게 둔다. */
const IN_CHUNK_SIZE = 100;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

/** ilike 패턴 안에서 %, _, \ 를 글자 그대로 찾도록 이스케이프 */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export interface LoadBulkCheckContextInput {
  slugs: readonly string[];
  keywords: readonly string[];
  /** 대기열 항목을 수정할 때 자기 자신은 비교 대상에서 뺀다 */
  excludeQueueId?: string;
}

export interface LoadedBulkCheckContext {
  existingSlugs: string[];
  existingPairs: { region: string; keyword: string }[];
  corpus: CorpusEntry[];
}

interface QueueCorpusRow {
  id: string;
  region: string;
  keyword: string;
  slug: string;
  state: string;
  hero_text: string | null;
  description: string | null;
  landing_page_id: string | null;
}

interface PageTextRow {
  id: string;
  slug: string;
  hero_text: string | null;
  description: string | null;
}

/**
 * 같은 키워드의 비교 대상:
 * - 대기열 항목(공개 전): 대기열에 저장된 문구 — 이름 "대기열 /slug"
 * - 대기열에서 공개된 항목: 연결된 랜딩페이지의 현재 문구 — 이름 "기존 페이지 /slug"
 *   (공개 후 관리자가 고쳤을 수 있으므로 대기열 사본이 아니라 실제 페이지를 본다)
 * - 대기열을 거치지 않은 기존 랜딩페이지: 키워드 칸이 없으므로 페이지 제목에
 *   키워드가 들어 있는 페이지를 같은 키워드로 본다 — 이름 "기존 페이지 /slug"
 */
export async function loadBulkCheckContext(
  input: LoadBulkCheckContextInput
): Promise<{ context: LoadedBulkCheckContext; error: string | null }> {
  const empty: LoadedBulkCheckContext = { existingSlugs: [], existingPairs: [], corpus: [] };
  const supabase = await getSupabaseServerClient();
  const exclude = input.excludeQueueId;

  const slugs = Array.from(new Set(input.slugs.map((s) => s.trim().toLowerCase()).filter(Boolean)));
  const keywords = Array.from(new Set(input.keywords.map((k) => k.trim()).filter(Boolean)));

  // 1) 이미 쓰는 slug(랜딩페이지 + 대기열)
  const existingSlugs = new Set<string>();
  for (const part of chunk(slugs, IN_CHUNK_SIZE)) {
    const [pages, queue] = await Promise.all([
      supabase.from("landing_pages").select("slug").in("slug", part),
      supabase.from("landing_page_queue").select("id, slug").in("slug", part),
    ]);
    if (pages.error || queue.error) {
      console.error("[bulk-upload] slug lookup error:", (pages.error ?? queue.error)?.message);
      return { context: empty, error: "이미 사용 중인 URL을 확인하지 못했습니다." };
    }
    for (const row of pages.data ?? []) existingSlugs.add(row.slug);
    for (const row of queue.data ?? []) if (row.id !== exclude) existingSlugs.add(row.slug);
  }

  // 2) 같은 키워드의 대기열 항목(지역·키워드 중복 + 유사도 비교 대상)
  const queueRows: QueueCorpusRow[] = [];
  for (const part of chunk(keywords, IN_CHUNK_SIZE)) {
    const { data, error } = await fetchAllRows<QueueCorpusRow>((from, to) =>
      supabase
        .from("landing_page_queue")
        .select("id, region, keyword, slug, state, hero_text, description, landing_page_id")
        .in("keyword", part)
        .order("id", { ascending: true })
        .range(from, to)
    );
    if (error) {
      console.error("[bulk-upload] queue lookup error:", error);
      return { context: empty, error: "대기열을 확인하지 못했습니다." };
    }
    queueRows.push(...data.filter((row) => row.id !== exclude));
  }

  const existingPairs = queueRows.map((row) => ({ region: row.region, keyword: row.keyword }));
  const corpus: CorpusEntry[] = [];

  // 공개된 대기열 항목은 연결된 랜딩페이지의 현재 문구로 비교한다.
  const linkedIds = Array.from(
    new Set(
      queueRows
        .filter((row) => row.state === "published" && row.landing_page_id)
        .map((row) => row.landing_page_id as string)
    )
  );
  const linkedPages = new Map<string, PageTextRow>();
  for (const part of chunk(linkedIds, IN_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("landing_pages")
      .select("id, slug, hero_text, description")
      .in("id", part);
    if (error) {
      console.error("[bulk-upload] linked page lookup error:", error.message);
      return { context: empty, error: "기존 페이지 문구를 확인하지 못했습니다." };
    }
    for (const row of (data ?? []) as PageTextRow[]) linkedPages.set(row.id, row);
  }

  for (const row of queueRows) {
    if (row.state === "published") {
      const page = row.landing_page_id ? linkedPages.get(row.landing_page_id) : undefined;
      // 공개 후 페이지가 삭제됐으면 더 이상 비교하지 않는다.
      if (!page) continue;
      corpus.push({
        keyword: row.keyword,
        text: similarityText(page.hero_text, page.description),
        label: `기존 페이지 /${page.slug}`,
      });
    } else {
      corpus.push({
        keyword: row.keyword,
        text: similarityText(row.hero_text, row.description),
        label: `대기열 /${row.slug}`,
      });
    }
  }

  // 3) 대기열을 거치지 않은 기존 페이지: 제목에 키워드가 들어 있으면 같은 키워드로 본다.
  const linkedIdSet = new Set(queueRows.map((row) => row.landing_page_id).filter(Boolean));
  for (const keyword of keywords) {
    const { data, error } = await fetchAllRows<PageTextRow>((from, to) =>
      supabase
        .from("landing_pages")
        .select("id, slug, hero_text, description")
        .ilike("title", `%${escapeLike(keyword)}%`)
        .order("id", { ascending: true })
        .range(from, to)
    );
    if (error) {
      console.error("[bulk-upload] page lookup error:", error);
      return { context: empty, error: "기존 페이지 문구를 확인하지 못했습니다." };
    }
    for (const page of data) {
      if (linkedIdSet.has(page.id)) continue;
      corpus.push({
        keyword,
        text: similarityText(page.hero_text, page.description),
        label: `기존 페이지 /${page.slug}`,
      });
    }
  }

  return {
    context: { existingSlugs: Array.from(existingSlugs), existingPairs, corpus },
    error: null,
  };
}
