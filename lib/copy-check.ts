/**
 * 랜딩페이지 목록의 URL 복사완료 체크(search_submission_checks) 화면 계산.
 * 서버에서 받은 체크 상태 위에 방금 바꾼(저장 중인) 값을 덮어 보여 준다.
 */

/** 서버 기준 체크 수에 방금 바꾼 체크만큼 더하고 뺀다 */
export function checkedCountWithOverrides(
  serverCount: number,
  serverChecked: ReadonlySet<string>,
  overrides: Readonly<Record<string, boolean>>
): number {
  let count = serverCount;
  for (const [id, checked] of Object.entries(overrides)) {
    if (checked === serverChecked.has(id)) continue;
    count += checked ? 1 : -1;
  }
  return count;
}

/**
 * URL을 복사하고, 복사에 성공했고 아직 체크 전이면 체크한다.
 * 복사에 실패하면 체크하지 않고 false.
 */
export async function copyThenCheck(options: {
  copy: () => Promise<void>;
  onCopied: () => void;
  needsCheck: boolean;
  check: () => Promise<void>;
}): Promise<boolean> {
  try {
    await options.copy();
  } catch (err) {
    console.error("[admin] URL 복사 실패:", err);
    return false;
  }
  options.onCopied();
  if (options.needsCheck) await options.check();
  return true;
}
