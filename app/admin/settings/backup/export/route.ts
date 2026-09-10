import { requireUser } from "@/lib/auth";
import { buildBackupFile, buildBackupFilename } from "@/lib/backup/export";

export const dynamic = "force-dynamic";

/**
 * 백업 파일 다운로드. /admin 하위 페이지 렌더링 보호(proxy.ts, admin/layout.tsx)와
 *별개로, 이 다운로드 endpoint 자체에도 반드시 인증을 확인한다 — 세션이
 * 없으면 requireUser()가 /login으로 redirect한다(anon 다운로드 차단).
 *
 * export는 read-only다: 여러 테이블을 조회만 하고 어떤 row도 바꾸지 않는다.
 * 조회 중 하나라도 실패하면(페이지네이션 중간 실패 포함) 불완전한 JSON을
 * 정상 백업처럼 내려주지 않고 오류로 처리한다.
 */
export async function GET() {
  await requireUser();

  const result = await buildBackupFile();

  if (!result.success || !result.backup) {
    return new Response(result.error ?? "백업 파일을 생성하지 못했습니다.", {
      status: 500,
    });
  }

  const json = JSON.stringify(result.backup, null, 2);
  const filename = buildBackupFilename(result.backup.exportedAt);

  return new Response(json, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
