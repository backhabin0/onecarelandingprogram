"use client";

import Link from "next/link";
import { useRef, useState, type ChangeEvent } from "react";
import Card from "@/components/admin/Card";
import BulkCheckResultTable from "@/components/admin/BulkCheckResultTable";
import { enqueueBulkRowsAction, getBulkCheckContextAction } from "@/app/admin/bulk/actions";
import {
  buildUploadSlug,
  checkBulkUploadRows,
  decideQueueState,
  type BulkCheckResult,
  type CheckedRowStatus,
} from "@/lib/bulk-upload/check";
import { parseUploadFile, type ParsedUpload, type UploadRow } from "@/lib/bulk-upload/parse";
import { chunkRowsBySize, toPayload } from "@/lib/bulk-upload/payload";
import type { EnqueueRowResult } from "@/lib/bulk-upload/enqueue";

/** 양식 다운로드는 페이지가 아니라 파일을 돌려주는 Route Handler라서 <a>로 연결한다. */
const TEMPLATE_URL = "/admin/bulk/template";

type Filter = "all" | CheckedRowStatus;

const FILTER_LABELS: Record<Filter, string> = {
  all: "전체",
  error: "오류",
  warning: "경고",
  pass: "통과",
};

interface EnqueueSummary {
  ready: number;
  hold: number;
  skipped: EnqueueRowResult[];
  error: string | null;
}

export default function BulkUploadPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState<"parsing" | "checking" | "saving" | null>(null);
  const [parsed, setParsed] = useState<ParsedUpload | null>(null);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [check, setCheck] = useState<BulkCheckResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [holdSimilar, setHoldSimilar] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<EnqueueSummary | null>(null);

  const reset = () => {
    setParsed(null);
    setRows([]);
    setCheck(null);
    setNotice(null);
    setError(null);
    setFilter("all");
    setHoldSimilar(false);
    setProgress(null);
    setSummary(null);
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    reset();
    setFileName(file?.name ?? null);
    if (!file) return;

    setBusy("parsing");
    const result = await parseUploadFile(file.name, await file.arrayBuffer());
    setParsed(result);
    if (result.fileErrors.length > 0) {
      setBusy(null);
      return;
    }

    setBusy("checking");
    try {
      const context = await getBulkCheckContextAction({
        slugs: result.rows.map((row) => buildUploadSlug(row.values)),
        keywords: result.rows.map((row) => row.values.keyword ?? ""),
      });
      if (!context.success || !context.thresholds) {
        setError(context.error ?? "검사에 필요한 정보를 불러오지 못했습니다.");
        return;
      }
      setNotice(context.thresholdsNotice ?? null);
      setRows(result.rows);
      setCheck(
        checkBulkUploadRows(result.rows, {
          existingSlugs: context.existingSlugs ?? [],
          existingPairs: context.existingPairs ?? [],
          corpus: context.corpus ?? [],
          thresholds: context.thresholds,
        })
      );
    } catch {
      setError("검사 요청에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setBusy(null);
    }
  };

  const savableRows = check
    ? rows.filter((_, i) => decideQueueState(check.rows[i], holdSimilar) !== null)
    : [];

  const handleEnqueue = async () => {
    if (!check || savableRows.length === 0 || busy) return;

    const batchId = crypto.randomUUID();
    const chunks = chunkRowsBySize(toPayload(savableRows));
    const result: EnqueueSummary = { ready: 0, hold: 0, skipped: [], error: null };

    setBusy("saving");
    setSummary(null);
    setProgress({ done: 0, total: chunks.length });
    try {
      for (const [i, part] of chunks.entries()) {
        const response = await enqueueBulkRowsAction({ rows: part, holdSimilar, batchId });
        for (const r of response.results ?? []) {
          if (r.outcome === "ready") result.ready += 1;
          else if (r.outcome === "hold") result.hold += 1;
          else result.skipped.push(r);
        }
        if (!response.success) {
          result.error = `${i + 1}번째 묶음에서 멈췄습니다: ${response.error ?? "저장 실패"} (앞 묶음은 저장됨)`;
          break;
        }
        setProgress({ done: i + 1, total: chunks.length });
      }
    } catch {
      result.error = "저장 요청에 실패했습니다. 대기열 화면에서 저장된 항목을 확인한 뒤 다시 시도해주세요.";
    } finally {
      setSummary(result);
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const visibleRows =
    check && filter !== "all" ? check.rows.filter((row) => row.status === filter) : (check?.rows ?? []);

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900">1. 파일 올리기</h2>
        <p className="mt-1 text-sm text-slate-500">
          양식의 첫 줄(머리글)은 그대로 두고 둘째 줄부터 입력하세요. xlsx와 csv(UTF-8 또는
          엑셀 기본 저장 형식)를 읽을 수 있고, 한 번에 최대 2,000행까지 올릴 수 있습니다.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <a
            href={TEMPLATE_URL}
            className="inline-flex w-fit items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            엑셀 양식 다운로드
          </a>
          <input
            ref={fileInputRef}
            id="bulkUploadFile"
            type="file"
            accept=".xlsx,.csv"
            onChange={handleFileChange}
            disabled={busy !== null}
            aria-label="대량 등록 파일 선택"
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
          />
        </div>
        {fileName ? (
          <p className="mt-2 text-xs text-slate-500">
            선택한 파일: <span className="font-medium text-slate-700">{fileName}</span>
          </p>
        ) : null}
        {busy === "parsing" || busy === "checking" ? (
          <p className="mt-3 text-sm text-slate-500">
            {busy === "parsing" ? "파일을 읽는 중..." : "검사하는 중..."}
          </p>
        ) : null}
        {parsed && parsed.fileErrors.length > 0 ? (
          <ul className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {parsed.fileErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </Card>

      {check && parsed ? (
        <Card>
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">2. 검사 결과</h2>
              <p className="mt-1 text-sm text-slate-600">
                전체 {check.rows.length.toLocaleString()}행 · 통과 {check.passCount} · 경고{" "}
                {check.warningCount} · 오류 {check.errorCount}
                {parsed.blankRowCount > 0 ? ` · 빈 줄 ${parsed.blankRowCount}개 건너뜀` : ""}
              </p>
              {parsed.ignoredHeaders.length > 0 ? (
                <p className="mt-1 text-xs text-slate-500">
                  양식에 없는 열은 무시했습니다: {parsed.ignoredHeaders.join(", ")}
                </p>
              ) : null}
              {notice ? <p className="mt-1 text-xs text-amber-700">{notice}</p> : null}
            </div>
            <div className="flex gap-1" role="tablist" aria-label="결과 필터">
              {(Object.keys(FILTER_LABELS) as Filter[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    filter === key ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {FILTER_LABELS[key]}
                </button>
              ))}
            </div>
          </div>
          <BulkCheckResultTable rows={visibleRows} />
        </Card>
      ) : null}

      {check ? (
        <Card className="p-6">
          <h2 className="text-base font-semibold text-slate-900">3. 대기열에 넣기</h2>
          <p className="mt-1 text-sm text-slate-500">
            오류가 없는 행만 공개 대기(ready) 상태로 저장합니다. 저장 직전에 서버에서 같은 규칙으로
            한 번 더 검사합니다.
          </p>
          {check.holdableCount > 0 ? (
            <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={holdSimilar}
                onChange={(e) => setHoldSimilar(e.target.checked)}
                disabled={busy !== null}
              />
              <span>
                문구 유사도 오류만 있는 {check.holdableCount}행은 보류(hold) 상태로 저장
                <span className="block text-xs text-slate-500">
                  보류 항목은 자동 공개되지 않습니다. 공개 대기열 화면에서 확인 후 공개 대기로 바꿀 수 있습니다.
                </span>
              </span>
            </label>
          ) : null}
          <button
            type="button"
            onClick={handleEnqueue}
            disabled={busy !== null || savableRows.length === 0}
            className={`mt-4 rounded-md px-5 py-2.5 text-sm font-medium text-white ${
              busy !== null || savableRows.length === 0
                ? "cursor-not-allowed bg-slate-400"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {busy === "saving"
              ? `저장 중... (${progress?.done ?? 0}/${progress?.total ?? 0})`
              : `대기열에 넣기 (${savableRows.length.toLocaleString()}행)`}
          </button>

          {summary ? (
            <div
              className={`mt-4 rounded-md border px-4 py-3 text-sm ${
                summary.error ? "border-red-200 bg-red-50 text-red-800" : "border-green-200 bg-green-50 text-green-800"
              }`}
            >
              <p className="font-medium">
                공개 대기 {summary.ready}행 · 보류 {summary.hold}행 저장
                {summary.skipped.length > 0 ? ` · 건너뜀 ${summary.skipped.length}행` : ""}
              </p>
              {summary.error ? <p className="mt-1">{summary.error}</p> : null}
              {summary.skipped.length > 0 ? (
                <ul className="mt-2 list-disc pl-5 text-xs">
                  {summary.skipped.map((r) => (
                    <li key={r.rowNumber}>
                      {r.rowNumber}행: {r.reason ?? "저장하지 않음"}
                    </li>
                  ))}
                </ul>
              ) : null}
              <Link href="/admin/queue" className="mt-2 inline-block font-medium underline">
                공개 대기열 화면으로 이동
              </Link>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
