import { FAQ_MAX_LENGTH, LANDING_PAGE_MAX_LENGTH, SEO_MAX_LENGTH, SLUG_PATTERN } from "@/lib/landing-page-validation";
import { BLOCKED_SLUG_PREFIX_MESSAGE, hasBlockedSlugPrefix } from "@/lib/slug";
import { BULK_UPLOAD_COLUMNS, CUSTOMER_ONLY_FIELDS, type BulkUploadField } from "./columns";
import { MAX_UPLOAD_ROWS } from "./parse";

/**
 * 손님이 ChatGPT·Claude 같은 AI에 직접 붙여넣을 프롬프트를 만든다(AI API 연결 없음).
 * AI가 돌려준 탭 구분 표는 "올리기" 탭의 붙여넣기 칸이나 엑셀로 올려 4단계 검사를 거친다.
 */

/** 프롬프트 하나에 넣는 최대 조합 수. 넘으면 여러 개로 나눈다. */
export const PROMPT_CHUNK_SIZE = 50;

export interface SlugItem {
  name: string;
  slug: string;
}

export interface LineError {
  line: number;
  message: string;
}

export interface ParsedSlugList {
  items: SlugItem[];
  errors: LineError[];
}

/**
 * "이름, slug" 목록을 읽는다(한 줄에 하나). 구분은 쉼표, 탭, 또는 마지막 공백.
 * 예: "강남, gangnam" / "강남\tgangnam" / "서울 강남 gangnam"
 * slug는 소문자로 바꾸고 영문 소문자·숫자·하이픈 규칙을 검사한다. 빈 줄은 건너뛴다.
 */
export function parseSlugList(text: string, label: { name: string; slug: string }): ParsedSlugList {
  const items: SlugItem[] = [];
  const errors: LineError[] = [];
  const seenNames = new Map<string, number>();
  const seenSlugs = new Map<string, number>();

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (!trimmed) return;

    let name: string;
    let slug: string;
    const separator = trimmed.includes("\t") ? "\t" : trimmed.includes(",") ? "," : null;
    if (separator) {
      const parts = trimmed.split(separator).map((p) => p.trim());
      if (parts.length !== 2) {
        errors.push({ line, message: `${line}번째 줄: "${label.name}, ${label.slug}" 두 칸으로 입력해주세요.` });
        return;
      }
      [name, slug] = parts;
    } else {
      const lastSpace = trimmed.lastIndexOf(" ");
      if (lastSpace < 0) {
        errors.push({ line, message: `${line}번째 줄: ${label.slug}가 없습니다. 예: 강남, gangnam` });
        return;
      }
      name = trimmed.slice(0, lastSpace).trim();
      slug = trimmed.slice(lastSpace + 1).trim();
    }

    slug = slug.toLowerCase();
    if (!name || !slug) {
      errors.push({ line, message: `${line}번째 줄: ${label.name}과 ${label.slug}를 모두 입력해주세요.` });
      return;
    }
    if (!SLUG_PATTERN.test(slug)) {
      errors.push({
        line,
        message: `${line}번째 줄: ${label.slug} "${slug}"는 영문 소문자, 숫자, 하이픈(-)만 쓸 수 있습니다.`,
      });
      return;
    }
    if (seenNames.has(name)) {
      errors.push({ line, message: `${line}번째 줄: ${label.name} "${name}"이(가) ${seenNames.get(name)}번째 줄과 겹칩니다.` });
      return;
    }
    if (seenSlugs.has(slug)) {
      errors.push({ line, message: `${line}번째 줄: ${label.slug} "${slug}"이(가) ${seenSlugs.get(slug)}번째 줄과 겹칩니다.` });
      return;
    }
    seenNames.set(name, line);
    seenSlugs.set(slug, line);
    items.push({ name, slug });
  });

  return { items, errors };
}

export interface PromptBusinessInfo {
  businessName: string;
  phone: string;
  kakaoUrl: string;
  address: string;
  template: string;
  /** 업종 설명 한두 줄(선택) */
  industry: string;
}

export interface Combination {
  region: SlugItem;
  keyword: SlugItem;
}

/** 지역 × 키워드 조합(지역 순서 → 키워드 순서) */
export function buildCombinations(regions: readonly SlugItem[], keywords: readonly SlugItem[]): Combination[] {
  return regions.flatMap((region) => keywords.map((keyword) => ({ region, keyword })));
}

/** AI가 그대로 복사해야 하는 칸(입력값) */
const COPY_FIELDS: readonly BulkUploadField[] = [
  "region",
  "keyword",
  "regionSlug",
  "keywordSlug",
  "businessName",
  "phone",
  "kakaoUrl",
  "address",
  "template",
];

/** AI가 직접 쓰는 칸과 글자 수 제한(공용 상수) */
export const AI_WRITTEN_FIELDS: readonly { field: BulkUploadField; max: number }[] = [
  { field: "title", max: LANDING_PAGE_MAX_LENGTH.title },
  { field: "heroText", max: LANDING_PAGE_MAX_LENGTH.heroText },
  { field: "description", max: LANDING_PAGE_MAX_LENGTH.description },
  { field: "seoTitle", max: SEO_MAX_LENGTH.title },
  { field: "seoDescription", max: SEO_MAX_LENGTH.description },
  { field: "faqQuestion1", max: FAQ_MAX_LENGTH.question },
  { field: "faqAnswer1", max: FAQ_MAX_LENGTH.answer },
  { field: "faqQuestion2", max: FAQ_MAX_LENGTH.question },
  { field: "faqAnswer2", max: FAQ_MAX_LENGTH.answer },
  { field: "faqQuestion3", max: FAQ_MAX_LENGTH.question },
  { field: "faqAnswer3", max: FAQ_MAX_LENGTH.answer },
];

const HEADER_OF = new Map(BULK_UPLOAD_COLUMNS.map((c) => [c.field, c.header]));
const header = (field: BulkUploadField) => HEADER_OF.get(field) ?? field;

/** 표 칸에 넣을 값: 탭·줄바꿈은 표를 깨뜨리므로 공백으로 바꾼다 */
const cell = (value: string) => value.replace(/[\t\r\n]+/g, " ").trim();

function inputRow(combination: Combination, business: PromptBusinessInfo): string {
  const fixed: Partial<Record<BulkUploadField, string>> = {
    region: combination.region.name,
    keyword: combination.keyword.name,
    regionSlug: combination.region.slug,
    keywordSlug: combination.keyword.slug,
    businessName: business.businessName,
    phone: business.phone,
    kakaoUrl: business.kakaoUrl,
    address: business.address,
    template: business.template,
  };
  return BULK_UPLOAD_COLUMNS.map((column) => cell(fixed[column.field] ?? "")).join("\t");
}

/** 프롬프트 1개(조합 일부)의 본문 */
function buildPromptText(
  combinations: readonly Combination[],
  business: PromptBusinessInfo,
  part: { index: number; total: number; from: number; to: number; all: number }
): string {
  const lines: string[] = [];
  lines.push("당신은 지역 업체 랜딩페이지 문구를 쓰는 카피라이터입니다.");
  lines.push("아래 [입력 표]의 빈 칸을 채워서, [출력 형식]에 맞는 표 하나만 출력하세요.");
  if (part.total > 1) {
    lines.push(
      `이 요청은 전체 ${part.all}행 중 ${part.from}~${part.to}행입니다(${part.index}/${part.total}). 이 요청의 표만 출력하세요.`
    );
  }

  lines.push("", "[업체 정보]");
  lines.push(`- 업체명: ${cell(business.businessName)}`);
  if (cell(business.industry)) lines.push(`- 업종 설명: ${cell(business.industry)}`);

  lines.push("", "[출력 형식]");
  lines.push("- 탭으로 구분한 표 하나만 출력합니다. 첫 줄은 머리글이며, 머리글과 열 순서는 [입력 표]와 똑같아야 합니다.");
  lines.push("- 표 앞뒤에 설명·인사말을 쓰지 말고, 코드 블록 표시(```)나 마크다운 표 기호(|)도 넣지 마세요.");
  lines.push("- 한 행은 한 줄입니다. 칸 안에 탭이나 줄바꿈을 넣지 마세요.");
  lines.push(`- 행을 더하거나 빼거나 순서를 바꾸지 마세요. [입력 표]의 ${combinations.length}행을 그대로 ${combinations.length}행으로 출력합니다.`);

  lines.push("", "[그대로 복사할 칸 — 절대 바꾸지 마세요]");
  lines.push(`- ${COPY_FIELDS.map(header).join(", ")}`);
  lines.push("- 입력 표의 값을 한 글자도 바꾸지 말고 그대로 쓰세요. 빈 칸은 빈 칸으로 둡니다.");

  lines.push("", "[비워 둘 칸 — 채우지 마세요]");
  lines.push(`- ${CUSTOMER_ONLY_FIELDS.map(header).join(", ")}`);
  lines.push("- 손님이 나중에 직접 채우는 칸입니다. 내용을 지어내지 말고 빈 칸 그대로 출력하세요.");

  lines.push("", "[직접 쓸 칸과 글자 수 제한(공백 포함, 이 숫자를 넘지 마세요)]");
  for (const { field, max } of AI_WRITTEN_FIELDS) {
    lines.push(`- ${header(field)}: ${max}자 이내`);
  }

  lines.push("", "[작성 규칙]");
  lines.push(
    "1. 행마다 그 지역의 생활 환경(아파트 단지, 상가·오피스, 주택가, 음식점·카페 거리, 학교·학원가 등)과 고객의 상황(출퇴근, 아이 돌봄, 주말 여가 등)을 서로 다르게 잡아서 쓰세요."
  );
  lines.push(
    "   단, 특정 건물·역·도로 이름, 걸리는 시간이나 거리, 통계처럼 확인되지 않은 지역 정보는 쓰지 마세요."
  );
  lines.push("2. 같은 문장이나 같은 문장 구조를 여러 행에서 반복하지 마세요. 지역 이름만 바꾼 문구는 안 됩니다.");
  lines.push("3. 키워드는 자연스럽게 필요한 만큼만 쓰세요. 한 칸에 같은 키워드를 억지로 여러 번 넣지 마세요.");
  lines.push(
    "4. 가격, 할인, 이벤트, 수상, 경력·연차, 자격·인증, 회원 수, 순위, 전화번호, 주소, 카카오톡·웹사이트 주소 같은 사실 정보는 지어내지 마세요. [업체 정보]와 입력 표에 없는 사실은 쓰지 않습니다."
  );
  lines.push("5. 전화·카카오 URL·주소는 해당 칸에만 두고, 제목·문구·FAQ에는 넣지 마세요.");
  lines.push("6. FAQ 질문/답변 1~3을 모두 채우세요. 답변은 규칙 4를 지키는 일반적인 안내로 쓰고, 자세한 내용은 상담으로 안내해도 됩니다.");
  lines.push(
    "7. FAQ 질문은 손님이 전화나 카카오톡으로 실제로 물어볼 말투의 질문 한 문장으로 쓰고, 물음표(?)로 끝내세요. 예: \"처음 문의할 때 무엇을 알려 드리면 되나요?\""
  );
  lines.push(
    "   업체 소개형 질문(\"OO은 어떤 곳인가요?\")이나 \"자료가 필요해요\" 같은 평서문은 쓰지 말고, 한 행 안에서 같은 뜻의 질문을 반복하지 마세요."
  );
  lines.push("8. 위의 글자 수 제한을 반드시 지키세요.");

  lines.push("", `[입력 표] (${combinations.length}행)`);
  lines.push(BULK_UPLOAD_COLUMNS.map((c) => c.header).join("\t"));
  for (const combination of combinations) lines.push(inputRow(combination, business));

  return lines.join("\n");
}

export interface BuildPromptsResult {
  prompts: { text: string; from: number; to: number; count: number }[];
  combinationCount: number;
  errors: string[];
}

/**
 * 지역 × 키워드 조합으로 프롬프트를 만든다. 조합이 chunkSize(기본 50)를 넘으면
 * chunkSize개씩 나눠 여러 개를 만든다.
 */
export function buildBulkPrompts(input: {
  regions: readonly SlugItem[];
  keywords: readonly SlugItem[];
  business: PromptBusinessInfo;
  chunkSize?: number;
}): BuildPromptsResult {
  const chunkSize = input.chunkSize ?? PROMPT_CHUNK_SIZE;
  const combinations = buildCombinations(input.regions, input.keywords);
  const errors: string[] = [];

  if (input.regions.length === 0) errors.push("지역을 한 개 이상 입력해주세요.");
  if (input.keywords.length === 0) errors.push("키워드를 한 개 이상 입력해주세요.");
  if (!input.business.businessName.trim()) errors.push("업체명을 입력해주세요.");
  // 만들어질 URL(지역slug-키워드slug)이 admin·login·api로 시작하면 등록 검사에서 막히므로 미리 알린다.
  const blockedRegions = Array.from(
    new Set(combinations.filter((c) => hasBlockedSlugPrefix(`${c.region.slug}-${c.keyword.slug}`)).map((c) => c.region))
  );
  if (blockedRegions.length > 0) {
    errors.push(
      `${blockedRegions.map((r) => `${r.name}(${r.slug})`).join(", ")}: ${BLOCKED_SLUG_PREFIX_MESSAGE} 지역 slug를 바꿔주세요.`
    );
  }
  if (combinations.length > MAX_UPLOAD_ROWS) {
    errors.push(
      `조합이 ${combinations.length.toLocaleString()}개입니다. 한 번에 올릴 수 있는 ${MAX_UPLOAD_ROWS.toLocaleString()}개 이하로 줄여주세요.`
    );
  }
  if (errors.length > 0) return { prompts: [], combinationCount: combinations.length, errors };

  const total = Math.ceil(combinations.length / chunkSize);
  const prompts = Array.from({ length: total }, (_, i) => {
    const part = combinations.slice(i * chunkSize, (i + 1) * chunkSize);
    const from = i * chunkSize + 1;
    const to = from + part.length - 1;
    return {
      text: buildPromptText(part, input.business, { index: i + 1, total, from, to, all: combinations.length }),
      from,
      to,
      count: part.length,
    };
  });

  return { prompts, combinationCount: combinations.length, errors };
}
