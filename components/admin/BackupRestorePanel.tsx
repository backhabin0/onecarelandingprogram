"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import Card from "@/components/admin/Card";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const CONFIRM_TEXT = "RESTORE";
const EXPORT_URL = "/admin/settings/backup/export";

interface LandingPageConflict {
  id: string;
  slug: string;
  reason: "slug_taken_by_other_id" | "reserved_slug" | "duplicate_slug_in_backup";
}

interface DryRunPlan {
  canRestore: boolean;
  blockReason?: string;
  landingPages: {
    toInsertCount: number;
    toUpdateCount: number;
    currentOnlyCount: number;
    conflicts: LandingPageConflict[];
  };
  seoSettings: { toInsertCount: number; toUpdateCount: number; orphanCount: number };
  faqs: { toInsertCount: number; toUpdateCount: number; orphanCount: number };
  consultations: {
    toInsertCount: number;
    skipExistingCount: number;
    submissionConflictCount: number;
    orphanCount: number;
  };
  events: { toInsertCount: number; skipExistingCount: number; orphanCount: number };
  siteVerification: { willUpdate: boolean };
}

interface BackupMeta {
  exportedAt: string;
  site: string;
  counts: {
    landingPages: number;
    seoSettings: number;
    faqs: number;
    consultations: number;
    events: number;
  };
}

interface DryRunResponse {
  success: boolean;
  error?: string;
  backupMeta?: BackupMeta;
  invalidCounts?: Partial<Record<string, number>>;
  plan?: DryRunPlan;
}

interface RestoreResult {
  status: "success" | "blocked" | "partial_failure";
  error?: string;
  failedPhase?: string;
  landingPages: { inserted: number; updated: number; conflicts: number };
  seoSettings: { inserted: number; updated: number; orphan: number };
  faqs: { inserted: number; updated: number; orphan: number };
  consultations: { inserted: number; skipped: number; submissionConflicts: number; orphan: number };
  events: { inserted: number; skipped: number; orphan: number };
  siteVerification: { updated: boolean };
}

interface RestoreResponse {
  success: boolean;
  error?: string;
  result?: RestoreResult;
}

const CONFLICT_REASON_LABEL: Record<LandingPageConflict["reason"], string> = {
  slug_taken_by_other_id: "다른 페이지가 이미 이 URL을 사용 중",
  reserved_slug: "시스템 예약 URL",
  duplicate_slug_in_backup: "백업 파일 안에서 URL 중복",
};

const INVALID_COUNT_LABEL: Record<string, string> = {
  landingPages: "랜딩페이지",
  seoSettings: "SEO 설정",
  faqs: "FAQ",
  consultations: "상담",
  events: "통계 이벤트",
};

const PHASE_LABEL: Record<string, string> = {
  landing_pages: "랜딩페이지",
  seo_settings: "SEO 설정",
  faqs: "FAQ",
  consultations: "상담",
  events: "통계 이벤트",
  site_verification: "검색엔진 인증 설정",
};

function formatKst(iso: string): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} (KST)`;
}

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

export default function BackupRestorePanel() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [backupText, setBackupText] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDryRunning, startDryRun] = useTransition();
  const [dryRun, setDryRun] = useState<DryRunResponse | null>(null);

  const [confirmText, setConfirmText] = useState("");
  const [isRestoring, startRestore] = useTransition();
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);

  const resetAfterNewFile = () => {
    setDryRun(null);
    setRestoreError(null);
    setRestoreResult(null);
    setConfirmText("");
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setFileError(null);
    resetAfterNewFile();
    setFileName(null);
    setBackupText(null);

    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".json")) {
      setFileError("JSON 파일만 업로드할 수 있습니다.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFileError("파일 크기가 50MB를 초과합니다.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const text = await file.text();
    setFileName(file.name);
    setBackupText(text);
  };

  const handleDryRun = () => {
    if (!backupText || isDryRunning) return;
    setFileError(null);
    startDryRun(async () => {
      try {
        const res = await fetch("/admin/settings/backup/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ backupText }),
        });
        const json = (await res.json()) as DryRunResponse;
        setDryRun(json);
        setRestoreResult(null);
        setRestoreError(null);
      } catch {
        setDryRun({ success: false, error: "검증 요청에 실패했습니다." });
      }
    });
  };

  const canRestore = Boolean(
    backupText &&
      dryRun?.success &&
      dryRun.plan?.canRestore &&
      confirmText === CONFIRM_TEXT &&
      !isRestoring
  );

  const handleRestore = () => {
    if (!canRestore || !backupText) return;
    setRestoreError(null);
    startRestore(async () => {
      try {
        const res = await fetch("/admin/settings/backup/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ backupText, confirm: confirmText }),
        });
        const json = (await res.json()) as RestoreResponse;
        if (json.result) {
          setRestoreResult(json.result);
        } else {
          setRestoreError(json.error ?? "복구에 실패했습니다.");
        }
      } catch {
        setRestoreError("복구 요청에 실패했습니다.");
      }
    });
  };

  const plan = dryRun?.plan;
  const invalidCounts = dryRun?.invalidCounts ?? {};
  const hasInvalidRows = Object.values(invalidCounts).some((n) => (n ?? 0) > 0);

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900">데이터 백업</h2>
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          백업 파일에는 상담 고객의 이름 · 연락처 · 문의내용 등 개인정보가
          포함될 수 있습니다. GitHub, 공개 Drive, Slack 공개 채널 등 외부
          공유나 공개 저장소 업로드에 주의하세요.
        </p>
        <p className="mt-3 text-sm text-slate-500">
          랜딩페이지, SEO 설정, FAQ, 상담 신청, 통계 이벤트, 검색엔진 인증
          설정을 JSON 파일 하나로 내려받습니다. 이미지 파일 자체(Storage
          binary)는 포함되지 않고, 참조 중인 이미지 URL 목록만 함께
          기록됩니다.
        </p>
        <a
          href={EXPORT_URL}
          className="mt-4 inline-flex items-center justify-center rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          백업 파일 다운로드
        </a>
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900">백업 복구</h2>
        <p className="mt-1 text-sm text-slate-500">
          이미 존재하는 데이터를 자동으로 삭제하지 않는 안전한 병합(merge)
          방식입니다 — 백업에 없는 현재 데이터는 그대로 유지되고, 이미 존재하는
          상담/통계 row는 덮어쓰지 않습니다.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <label htmlFor="backupFile" className="text-sm font-medium text-slate-700">
            JSON 파일 선택
          </label>
          <input
            id="backupFile"
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileChange}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
          />
          {fileError ? <p className="text-xs text-red-600">{fileError}</p> : null}
          {fileName ? (
            <p className="text-xs text-slate-500">
              선택한 파일: <span className="font-medium text-slate-700">{fileName}</span>
            </p>
          ) : null}
        </div>

        {backupText ? (
          <div className="mt-4">
            <button
              type="button"
              onClick={handleDryRun}
              disabled={isDryRunning}
              className={`rounded-md px-5 py-2.5 text-sm font-medium text-white ${
                isDryRunning ? "cursor-not-allowed bg-slate-400" : "bg-slate-800 hover:bg-slate-900"
              }`}
            >
              {isDryRunning ? "검증 중..." : "Dry Run (미리보기)"}
            </button>
          </div>
        ) : null}

        {dryRun && !dryRun.success ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {dryRun.error ?? "지원하지 않는 백업 파일입니다."}
          </div>
        ) : null}

        {dryRun?.success && dryRun.backupMeta && plan ? (
          <div className="mt-4 flex flex-col gap-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
            <div>
              <p className="text-xs text-slate-500">
                생성일: {formatKst(dryRun.backupMeta.exportedAt)} · 대상 사이트:{" "}
                {dryRun.backupMeta.site || "-"}
              </p>
            </div>

            {hasInvalidRows ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                형식이 올바르지 않아 제외된 항목이 있습니다:{" "}
                {Object.entries(invalidCounts)
                  .filter(([, n]) => (n ?? 0) > 0)
                  .map(([key, n]) => `${INVALID_COUNT_LABEL[key] ?? key} ${n}건`)
                  .join(", ")}
              </div>
            ) : null}

            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <dt className="font-medium text-slate-700">랜딩페이지</dt>
                <dd className="text-slate-600">
                  추가 {plan.landingPages.toInsertCount} · 업데이트{" "}
                  {plan.landingPages.toUpdateCount} · 현재 DB에만 존재{" "}
                  {plan.landingPages.currentOnlyCount} · 충돌{" "}
                  {plan.landingPages.conflicts.length}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">SEO 설정</dt>
                <dd className="text-slate-600">
                  추가 {plan.seoSettings.toInsertCount} · 업데이트{" "}
                  {plan.seoSettings.toUpdateCount} · 부모 없음{" "}
                  {plan.seoSettings.orphanCount}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">FAQ</dt>
                <dd className="text-slate-600">
                  추가 {plan.faqs.toInsertCount} · 업데이트 {plan.faqs.toUpdateCount} · 부모
                  없음 {plan.faqs.orphanCount}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">상담</dt>
                <dd className="text-slate-600">
                  추가 {plan.consultations.toInsertCount} · 이미 존재(유지){" "}
                  {plan.consultations.skipExistingCount} · 제출 ID 충돌{" "}
                  {plan.consultations.submissionConflictCount} · 부모 없음{" "}
                  {plan.consultations.orphanCount}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">통계 이벤트</dt>
                <dd className="text-slate-600">
                  추가 {plan.events.toInsertCount} · 이미 존재(유지){" "}
                  {plan.events.skipExistingCount} · 부모 없음 {plan.events.orphanCount}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">검색엔진 인증 설정</dt>
                <dd className="text-slate-600">
                  {plan.siteVerification.willUpdate ? "업데이트 예정" : "변경 없음"}
                </dd>
              </div>
            </dl>

            {plan.landingPages.conflicts.length > 0 ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <p className="font-medium">
                  URL(slug) 충돌이 {plan.landingPages.conflicts.length}건 있어 복구를
                  실행할 수 없습니다. 자동으로 URL을 바꾸지 않습니다 — 현재 DB나
                  백업 파일을 확인한 뒤 다시 시도해주세요.
                </p>
                <ul className="mt-2 list-disc pl-4">
                  {plan.landingPages.conflicts.map((c) => (
                    <li key={c.id}>
                      {c.slug} — {CONFLICT_REASON_LABEL[c.reason]}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {backupText ? (
          <div className="mt-6 flex flex-col gap-3 rounded-md border border-blue-200 bg-blue-50 p-4">
            <p className="text-sm font-medium text-blue-900">
              복구 전에 반드시 현재 상태를 먼저 백업하세요.
            </p>
            <a
              href={EXPORT_URL}
              className="inline-flex w-fit items-center justify-center rounded-md border border-blue-600 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
            >
              현재 상태 백업 다운로드
            </a>
          </div>
        ) : null}

        {dryRun?.success && plan?.canRestore ? (
          <div className="mt-4 flex flex-col gap-3">
            <label htmlFor="restoreConfirm" className="text-sm font-medium text-slate-700">
              복구를 실행하려면 <span className="font-mono">{CONFIRM_TEXT}</span>를
              입력하세요.
            </label>
            <input
              id="restoreConfirm"
              className={inputClassName}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={CONFIRM_TEXT}
              disabled={isRestoring}
            />
            {restoreError ? <p className="text-xs text-red-600">{restoreError}</p> : null}
            <button
              type="button"
              onClick={handleRestore}
              disabled={!canRestore}
              className={`w-fit rounded-md px-5 py-2.5 text-sm font-medium text-white ${
                canRestore ? "bg-red-600 hover:bg-red-700" : "cursor-not-allowed bg-red-300"
              }`}
            >
              {isRestoring ? "복구 실행 중..." : "복구 실행"}
            </button>
          </div>
        ) : null}

        {restoreResult ? (
          <div
            className={`mt-6 rounded-md border p-4 text-sm ${
              restoreResult.status === "success"
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            <p className="font-semibold">
              {restoreResult.status === "success"
                ? "복구 완료"
                : restoreResult.status === "blocked"
                  ? "복구 차단됨 (URL 충돌)"
                  : `복구 일부 실패${
                      restoreResult.failedPhase
                        ? ` (${PHASE_LABEL[restoreResult.failedPhase] ?? restoreResult.failedPhase} 단계에서 중단)`
                        : ""
                    }`}
            </p>
            {restoreResult.error ? <p className="mt-1">{restoreResult.error}</p> : null}
            {restoreResult.status !== "blocked" ? (
              <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <dt className="font-medium">랜딩페이지</dt>
                  <dd>
                    추가 {restoreResult.landingPages.inserted} · 업데이트{" "}
                    {restoreResult.landingPages.updated}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">SEO 설정</dt>
                  <dd>
                    추가 {restoreResult.seoSettings.inserted} · 업데이트{" "}
                    {restoreResult.seoSettings.updated} · 부모 없음{" "}
                    {restoreResult.seoSettings.orphan}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">FAQ</dt>
                  <dd>
                    추가 {restoreResult.faqs.inserted} · 업데이트{" "}
                    {restoreResult.faqs.updated} · 부모 없음 {restoreResult.faqs.orphan}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">상담</dt>
                  <dd>
                    추가 {restoreResult.consultations.inserted} · 건너뜀{" "}
                    {restoreResult.consultations.skipped} · 제출 ID 충돌{" "}
                    {restoreResult.consultations.submissionConflicts} · 부모 없음{" "}
                    {restoreResult.consultations.orphan}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">통계 이벤트</dt>
                  <dd>
                    추가 {restoreResult.events.inserted} · 건너뜀{" "}
                    {restoreResult.events.skipped} · 부모 없음 {restoreResult.events.orphan}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">검색엔진 인증 설정</dt>
                  <dd>{restoreResult.siteVerification.updated ? "업데이트됨" : "변경 없음"}</dd>
                </div>
              </dl>
            ) : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
