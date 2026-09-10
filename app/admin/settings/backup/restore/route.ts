import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { parseAndValidateBackupFile } from "@/lib/backup/sanitize";
import { executeMergeRestore } from "@/lib/backup/restore";

export const dynamic = "force-dynamic";

const MAX_BACKUP_TEXT_LENGTH = 50 * 1024 * 1024;
const CONFIRM_TEXT = "RESTORE";

/**
 * 실제 병합(merge) 복구를 실행한다.
 *
 * - requireUser()로 관리자 인증을 다시 확인한다(admin layout 보호만 믿지 않는다).
 * - confirm 필드가 정확히 "RESTORE"가 아니면 거부한다(관리자 화면의 확인
 *   문구 입력과 별개로, 서버에서도 다시 강제한다).
 * - 클라이언트가 이전에 받은 dry-run 결과를 보내오더라도 신뢰하지 않고,
 *   이 요청 안에서 executeMergeRestore()가 다시 계획을 계산한 뒤 그 계획으로만
 *   실행한다(그 사이 DB가 바뀌었을 수 있으므로).
 */
export async function POST(request: NextRequest) {
  await requireUser();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "요청 본문을 읽지 못했습니다." },
      { status: 400 }
    );
  }

  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const backupText = record.backupText;
  const confirm = record.confirm;

  if (typeof backupText !== "string" || backupText.length === 0) {
    return NextResponse.json(
      { success: false, error: "백업 파일 내용이 없습니다." },
      { status: 400 }
    );
  }

  if (backupText.length > MAX_BACKUP_TEXT_LENGTH) {
    return NextResponse.json(
      { success: false, error: "파일 크기가 50MB를 초과합니다." },
      { status: 400 }
    );
  }

  if (confirm !== CONFIRM_TEXT) {
    return NextResponse.json(
      { success: false, error: `확인 문구(${CONFIRM_TEXT})를 정확히 입력해주세요.` },
      { status: 400 }
    );
  }

  const parsed = parseAndValidateBackupFile(backupText);
  if (!parsed.success || !parsed.backup) {
    return NextResponse.json(
      { success: false, error: parsed.error ?? "지원하지 않는 백업 파일입니다." },
      { status: 400 }
    );
  }

  console.log("[backup-restore] restore started");
  const result = await executeMergeRestore(parsed.backup);
  console.log(`[backup-restore] restore finished: status=${result.status}`);

  if (result.status !== "blocked") {
    // landing_pages/consultations 등 여러 화면이 이 데이터를 보여주므로
    // 다음 요청부터 최신 상태가 보이도록 관련 경로를 갱신한다.
    revalidatePath("/admin");
    revalidatePath("/admin/pages");
    revalidatePath("/admin/consultations");
    revalidatePath("/admin/analytics");
    revalidatePath("/admin/settings");
    revalidatePath("/admin/settings/backup");
    revalidatePath("/");
  }

  return NextResponse.json({ success: result.status === "success", result });
}
