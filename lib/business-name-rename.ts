import { withDirectionParticle } from "@/lib/business-info";

/**
 * 업체명 일괄 변경 화면(components/admin/BusinessNameRenameBar.tsx)이 쓰는 순수 함수.
 * 브라우저·서버·테스트 어디서든 쓸 수 있게 DB·React 의존이 없다.
 */

/** 선택한 항목 하나(id와 지금 업체명) */
export interface RenameTarget {
  id: string;
  businessName: string;
}

/** 배열을 size개씩 나눈다(마지막 묶음은 더 적을 수 있음) */
export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** 지금 업체명들(많이 쓰인 순, 같으면 가나다순). 앞뒤 공백만 다른 이름은 하나로 본다 */
export function distinctBusinessNames(targets: readonly RenameTarget[]): string[] {
  const counts = new Map<string, number>();
  for (const { businessName } of targets) {
    const name = businessName.trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
    .map(([name]) => name);
}

/** 확인 창에 보여 줄 지금 업체명: 3개까지 나열하고 나머지는 "외 n개" */
export function describeCurrentNames(names: readonly string[], limit = 3): string {
  const shown = names.slice(0, limit).map((name) => `"${name}"`);
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} 외 ${rest}개` : shown.join(", ");
}

/**
 * "n개 페이지를 "A" → "B"로 바꿉니다." 확인 문구.
 * objectLabel은 목적격 조사까지 붙인 이름(예: "페이지를", "대기열 항목을").
 */
export function buildRenameConfirmMessage(
  targets: readonly RenameTarget[],
  newName: string,
  objectLabel: string
): string {
  const name = newName.trim();
  const current = describeCurrentNames(distinctBusinessNames(targets));
  const particle = withDirectionParticle(name).slice(name.length);
  return `${targets.length}개 ${objectLabel} ${current} → "${name}"${particle} 바꿉니다.`;
}
