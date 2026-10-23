/**
 * 문장 유사도: 대표 문구 + 소개 문구를 정규화한 뒤 글자 3-gram 집합의 Jaccard 계수.
 * 0(전혀 다름) ~ 1(같음). 지역명만 바꾼 복붙 문구를 찾는 용도다.
 */

export interface SimilarityThresholds {
  /** 이 값 이상이면 경고 */
  warning: number;
  /** 이 값 이상이면 오류(관리자가 선택하면 hold로 저장) */
  error: number;
}

export const DEFAULT_SIMILARITY_THRESHOLDS: SimilarityThresholds = {
  warning: 0.6,
  error: 0.8,
};

/** 0 < warning < error ≤ 1 */
export function isValidSimilarityThresholds(t: SimilarityThresholds): boolean {
  return (
    Number.isFinite(t.warning) &&
    Number.isFinite(t.error) &&
    t.warning > 0 &&
    t.warning < t.error &&
    t.error <= 1
  );
}

/**
 * 비교용 정규화: 유니코드 NFKC, 소문자, 글자·숫자가 아닌 문자(공백·문장부호·이모지 등)
 * 제거. 띄어쓰기나 문장부호만 바꾼 문구도 같은 문구로 본다.
 */
export function normalizeForSimilarity(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** 대표 문구와 소개 문구를 합친 비교 대상 문자열 */
export function similarityText(heroText: string | null | undefined, description: string | null | undefined): string {
  return normalizeForSimilarity(`${heroText ?? ""}${description ?? ""}`);
}

/** 글자 3-gram 집합. 3글자보다 짧으면 문자열 자체를 하나의 원소로 본다(빈 문자열은 빈 집합). */
export function trigrams(normalized: string): Set<string> {
  const chars = Array.from(normalized);
  const grams = new Set<string>();
  if (chars.length === 0) return grams;
  if (chars.length < 3) {
    grams.add(chars.join(""));
    return grams;
  }
  for (let i = 0; i + 3 <= chars.length; i += 1) {
    grams.add(chars[i] + chars[i + 1] + chars[i + 2]);
  }
  return grams;
}

/** 두 집합의 Jaccard 계수. 둘 중 하나라도 비어 있으면 0(비교할 문구가 없음) */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const gram of small) {
    if (large.has(gram)) shared += 1;
  }
  return shared / (a.size + b.size - shared);
}

/** 원문 두 개의 유사도(테스트·단건 계산용) */
export function textSimilarity(a: string, b: string): number {
  return jaccard(trigrams(normalizeForSimilarity(a)), trigrams(normalizeForSimilarity(b)));
}

export interface SimilarityTarget {
  /** 화면에 보여줄 이름. 예: "5행", "기존 페이지 /gangnam-gym", "대기열 /seocho-gym" */
  label: string;
}

export interface SimilarityMatch {
  score: number;
  target: SimilarityTarget;
}

/**
 * 같은 키워드끼리만 비교하는 유사도 색인. 3-gram → 문서 번호 역색인을 써서
 * 공통 3-gram이 있는 문서만 센다(모든 쌍을 직접 비교하는 것보다 훨씬 빠름).
 */
export class SimilarityIndex {
  private readonly targets: SimilarityTarget[] = [];
  private readonly sizes: number[] = [];
  private readonly postings = new Map<string, number[]>();
  private counts = new Int32Array(64);

  get size(): number {
    return this.targets.length;
  }

  add(normalizedText: string, target: SimilarityTarget): void {
    const grams = trigrams(normalizedText);
    if (grams.size === 0) return;
    const id = this.targets.length;
    this.targets.push(target);
    this.sizes.push(grams.size);
    for (const gram of grams) {
      const list = this.postings.get(gram);
      if (list) list.push(id);
      else this.postings.set(gram, [id]);
    }
    if (this.counts.length < this.targets.length) {
      const next = new Int32Array(this.counts.length * 2);
      next.set(this.counts);
      this.counts = next;
    }
  }

  /** 가장 비슷한 문서(동점이면 먼저 넣은 것). 비교할 문서가 없거나 공통 3-gram이 없으면 null */
  findMostSimilar(normalizedText: string): SimilarityMatch | null {
    const grams = trigrams(normalizedText);
    if (grams.size === 0 || this.targets.length === 0) return null;

    const touched: number[] = [];
    for (const gram of grams) {
      const list = this.postings.get(gram);
      if (!list) continue;
      for (const id of list) {
        if (this.counts[id] === 0) touched.push(id);
        this.counts[id] += 1;
      }
    }

    let best: SimilarityMatch | null = null;
    let bestId = -1;
    for (const id of touched) {
      const shared = this.counts[id];
      const score = shared / (grams.size + this.sizes[id] - shared);
      if (!best || score > best.score || (score === best.score && id < bestId)) {
        best = { score, target: this.targets[id] };
        bestId = id;
      }
      this.counts[id] = 0;
    }
    return best;
  }
}

/** 화면 표시·저장용으로 소수 넷째 자리까지 내림(numeric(5,4) 컬럼과 맞춤) */
export function roundSimilarity(score: number): number {
  return Math.floor(score * 10000) / 10000;
}
