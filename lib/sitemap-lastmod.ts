/**
 * sitemap의 lastmod: 공개 시각(published_at)과 수정 시각(updated_at) 중 더 늦은 값.
 * 둘 다 없거나 날짜가 아니면 created_at을 쓴다.
 *
 * 대기열에서 공개된 페이지는 공개 순간에 만들어져 updated_at ≈ published_at이지만,
 * 백업 복구 등으로 updated_at이 공개보다 이른 값이 될 수 있어 둘 중 최신을 쓴다.
 */
export function getSitemapLastModified(page: {
  updated_at: string | null;
  created_at: string;
  published_at?: string | null;
}): Date {
  const times = [page.published_at, page.updated_at]
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter((time) => Number.isFinite(time));
  if (times.length > 0) return new Date(Math.max(...times));
  return new Date(page.created_at);
}
