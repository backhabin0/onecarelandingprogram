/**
 * 문장 유사도(글자 3-gram Jaccard) 계산.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIMILARITY_THRESHOLDS,
  SimilarityIndex,
  isValidSimilarityThresholds,
  jaccard,
  normalizeForSimilarity,
  roundSimilarity,
  similarityText,
  textSimilarity,
  trigrams,
} from "@/lib/bulk-upload/similarity";

describe("정규화", () => {
  it("공백·문장부호·이모지를 지우고 소문자·NFKC로 맞춘다", () => {
    expect(normalizeForSimilarity(" 강남 헬스장, PT 최고!! ✨ ")).toBe("강남헬스장pt최고");
    expect(normalizeForSimilarity("ＡＢＣ１２３")).toBe("abc123"); // 전각 → 반각
  });

  it("대표 문구 + 소개 문구를 합친다(빈 값 허용)", () => {
    expect(similarityText("강남 헬스장", null)).toBe("강남헬스장");
    expect(similarityText(undefined, "소개")).toBe("소개");
  });
});

describe("3-gram과 Jaccard", () => {
  it("글자 3개씩 겹쳐 자른다(중복 제거), 3글자 미만은 통째로, 빈 문자열은 빈 집합", () => {
    expect([...trigrams("강남헬스")]).toEqual(["강남헬", "남헬스"]);
    expect([...trigrams("aaaa")]).toEqual(["aaa"]);
    expect([...trigrams("ab")]).toEqual(["ab"]);
    expect(trigrams("").size).toBe(0);
  });

  it("값을 직접 계산한 결과와 같다", () => {
    // {abc, bcd} vs {bcd, cde} → 교집합 1 / 합집합 3
    expect(jaccard(trigrams("abcd"), trigrams("bcde"))).toBeCloseTo(1 / 3, 10);
    expect(jaccard(trigrams("abc"), trigrams("abc"))).toBe(1);
    expect(jaccard(trigrams("abc"), trigrams("xyz"))).toBe(0);
    expect(jaccard(trigrams(""), trigrams("abc"))).toBe(0);
  });

  it("띄어쓰기·문장부호만 다른 문구는 1, 지역명만 바꾼 긴 문구는 높게 나온다", () => {
    expect(textSimilarity("강남 헬스장, 1:1 PT!", "강남헬스장 1 1 pt")).toBe(1);
    const base = "역에서 3분 거리, 10년째 운영 중인 헬스장입니다. 체형 분석 후 개인별 운동 계획을 세워 드립니다.";
    const score = textSimilarity(`강남${base}`, `서초${base}`);
    expect(score).toBeGreaterThan(0.9);
    expect(score).toBeLessThan(1);
    expect(textSimilarity("강남역 헬스장 PT 할인", "제주 바다가 보이는 카페")).toBe(0);
  });
});

describe("유사도 색인", () => {
  const docs = [
    "강남역 3분 헬스장 1:1 PT 체형 분석",
    "서초역 3분 헬스장 1:1 PT 체형 분석",
    "제주 바다 카페 브런치",
    "강남 필라테스 소수 정예 수업",
    "강남역 5분 헬스장 그룹 PT",
  ].map(normalizeForSimilarity);

  it("가장 비슷한 문서와 점수가 모든 쌍을 직접 계산한 결과와 같다", () => {
    const index = new SimilarityIndex();
    docs.forEach((doc, i) => index.add(doc, { label: `문서${i}` }));

    const query = normalizeForSimilarity("강남역 3분 헬스장 1:1 PT 상담");
    const brute = docs
      .map((doc, i) => ({ i, score: jaccard(trigrams(query), trigrams(doc)) }))
      .sort((a, b) => b.score - a.score || a.i - b.i)[0];

    const match = index.findMostSimilar(query);
    expect(match?.target.label).toBe(`문서${brute.i}`);
    expect(match?.score).toBeCloseTo(brute.score, 12);
  });

  it("여러 번 찾아도 결과가 같다(내부 카운터 초기화)", () => {
    const index = new SimilarityIndex();
    docs.forEach((doc, i) => index.add(doc, { label: `문서${i}` }));
    const first = index.findMostSimilar(docs[0]);
    const second = index.findMostSimilar(docs[0]);
    expect(first).toEqual(second);
    expect(first).toEqual({ score: 1, target: { label: "문서0" } });
  });

  it("문서가 64개를 넘어도(카운터 확장) 정확하다, 동점이면 먼저 넣은 문서", () => {
    const index = new SimilarityIndex();
    for (let i = 0; i < 200; i += 1) index.add(normalizeForSimilarity(`문서 번호 ${i} 내용`), { label: `d${i}` });
    index.add(normalizeForSimilarity("특별한 문장 하나"), { label: "special" });
    index.add(normalizeForSimilarity("특별한 문장 하나"), { label: "special-2" });
    expect(index.size).toBe(202);
    expect(index.findMostSimilar(normalizeForSimilarity("특별한 문장 하나"))).toEqual({
      score: 1,
      target: { label: "special" },
    });
  });

  it("비어 있는 색인이나 빈 문구, 공통 3-gram이 없으면 null", () => {
    const index = new SimilarityIndex();
    expect(index.findMostSimilar("abc")).toBeNull();
    index.add("", { label: "빈 문구는 넣지 않음" });
    expect(index.size).toBe(0);
    index.add("abcdef", { label: "a" });
    expect(index.findMostSimilar("")).toBeNull();
    expect(index.findMostSimilar("xyz")).toBeNull();
  });
});

describe("기준값", () => {
  it("기본값 0.6 / 0.8, 0 < 경고 < 오류 ≤ 1만 허용", () => {
    expect(DEFAULT_SIMILARITY_THRESHOLDS).toEqual({ warning: 0.6, error: 0.8 });
    expect(isValidSimilarityThresholds({ warning: 0.5, error: 1 })).toBe(true);
    expect(isValidSimilarityThresholds({ warning: 0, error: 0.8 })).toBe(false);
    expect(isValidSimilarityThresholds({ warning: 0.8, error: 0.8 })).toBe(false);
    expect(isValidSimilarityThresholds({ warning: 0.6, error: 1.01 })).toBe(false);
    expect(isValidSimilarityThresholds({ warning: Number.NaN, error: 0.8 })).toBe(false);
  });

  it("저장용 값은 넷째 자리까지 내림(기준값을 넘지 않게)", () => {
    expect(roundSimilarity(0.79999)).toBe(0.7999);
    expect(roundSimilarity(1)).toBe(1);
  });
});
