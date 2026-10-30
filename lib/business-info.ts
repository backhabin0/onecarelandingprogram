/**
 * 랜딩페이지의 업체 칸(업체명·주소)을 검색엔진·AI에 내보내기 전에 거르는 순수 함수.
 *
 * 기존 페이지 상당수는 business_name·address 칸에 제목형 문구("…하수구뚫는곳 해결하는 방법",
 * slug 문자열 등)가 들어 있다. DB 값은 바꾸지 않고, 구조화 데이터·자동 FAQ에 쓸 때만
 * "주소처럼 보이는 값"인지, "업체명이 이름으로 보이는지"를 확인해 아니면 쓰지 않는다
 * (추측해서 고치지 않고, 빼기만 한다).
 */

const clean = (value: string | null | undefined) => (value ?? "").trim();

/** 공백 차이를 무시하고 같은 글인지 */
export function isSameText(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (v: string | null | undefined) => clean(v).replace(/\s+/g, "");
  return norm(a) !== "" && norm(a) === norm(b);
}

/** 한국 행정 구역·도로명 단위(뒤에 공백·숫자·쉼표가 오거나 끝나는 경우만) */
const ADDRESS_UNIT_PATTERN = /[가-힣]+(?:특별시|광역시|특별자치시|특별자치도|도|시|군|구|읍|면|동|리|로|길)(?=[\s\d,]|$)/;

/**
 * 주소로 보이는 값인지(구조화 데이터 PostalAddress·"위치는 어디인가요?" FAQ에만 쓴다).
 * - 숫자(번지·건물번호)와 행정 구역·도로명 단위가 함께 있어야 한다
 * - 100자 이하, 해시태그·구분 기호(| / #)·줄바꿈·문장 마침표가 없어야 한다
 * - 업체명·제목과 같은 글이면 주소가 아니다
 * 예) "경기 군포시 산본로 1" → true / "siheung-eunhaeng-drain-unclogging" → false /
 *     "당진시 송악읍하수구뚫는곳" → false(번지 없음)
 */
export function looksLikePostalAddress(
  address: string | null | undefined,
  notEqualTo: readonly (string | null | undefined)[] = []
): boolean {
  const value = clean(address);
  if (!value || value.length > 100) return false;
  if (/[#|/\r\n]/.test(value)) return false;
  if (/[.!?。](?:\s|$)/.test(value)) return false;
  if (!/\d/.test(value)) return false;
  if (!ADDRESS_UNIT_PATTERN.test(value)) return false;
  return !notEqualTo.some((other) => isSameText(value, other));
}

export const BUSINESS_NAME_MAX_LENGTH = 30;

/**
 * 업체명이 "이름"으로 보이는지: 제목과 같은 글이거나, 30자를 넘거나, 키워드를 구분 기호로
 * 이어 붙인 문구("…뚫음 전문 | 원케어배관", "막힘·역류·고압세척")면 제목형 문구가 업체명 칸에
 * 들어간 것으로 본다.
 */
export function isDistinctBusinessName(businessName: string | null | undefined, title: string | null | undefined): boolean {
  const name = clean(businessName);
  if (!name || name.length > BUSINESS_NAME_MAX_LENGTH) return false;
  if (/[|·,/#]/.test(name)) return false;
  return !isSameText(name, title);
}

/** 주제 조사 은/는: 마지막 글자 받침 유무로 고른다. 한글이 아니면 "은(는)" */
export function withTopicParticle(word: string): string {
  const text = word.trim();
  const last = text.charCodeAt(text.length - 1);
  if (last >= 0xac00 && last <= 0xd7a3) {
    return `${text}${(last - 0xac00) % 28 === 0 ? "는" : "은"}`;
  }
  return `${text}은(는)`;
}

/** 방향 조사 로/으로: 받침이 없거나 ㄹ 받침이면 "로", 그 밖의 받침은 "으로". 한글이 아니면 "(으)로" */
export function withDirectionParticle(word: string): string {
  const text = word.trim();
  const last = text.charCodeAt(text.length - 1);
  if (last >= 0xac00 && last <= 0xd7a3) {
    const final = (last - 0xac00) % 28;
    return `${text}${final === 0 || final === 8 ? "로" : "으로"}`;
  }
  return `${text}(으)로`;
}

/**
 * meta description·llms.txt용 한 줄 글: 해시태그(#키워드)를 빼고 줄바꿈·연속 공백을 한 칸으로.
 * 화면 본문은 바꾸지 않는다(입력한 그대로 보여 줌).
 */
export function toPlainSummary(text: string | null | undefined): string {
  return stripHashMarks(clean(text).replace(/(^|\s)#[^\s#]+/g, " "));
}

/**
 * 남은 "#"(마크다운 제목 "### 제목", 낱개 "#")와 그 앞뒤 공백을 빈칸 하나로 바꾼다.
 * meta description·구조화 데이터용(직접 입력한 SEO 설명에도 쓴다). 화면 본문은 그대로.
 */
export function stripHashMarks(text: string | null | undefined): string {
  return clean(text)
    .replace(/\s*#+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 서비스 지역 이름: "시/군 + 지역". 지역에 시/군이 이미 들어 있으면 지역만 쓴다
 * (예: 시/군 "군포시" + 지역 "군포시 산본동" → "군포시 산본동").
 */
export function areaName(city: string | null | undefined, region: string | null | undefined): string {
  const c = clean(city);
  const r = clean(region);
  if (c && r && (r === c || r.startsWith(`${c} `))) return r;
  return [c, r].filter(Boolean).join(" ");
}
