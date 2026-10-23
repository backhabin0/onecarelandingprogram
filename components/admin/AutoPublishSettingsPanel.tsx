"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/admin/Card";
import FormField from "@/components/admin/FormField";
import {
  runAutoPublishNowAction,
  sendIndexNowAction,
  updateAutoPublishSettingsAction,
} from "@/app/admin/settings/actions";

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

export interface PublishRunView {
  id: string;
  run_date: string;
  published_count: number;
  failed_count: number;
  finished_at: string | null;
  trigger: "cron" | "manual" | null;
}

export interface IndexNowView {
  configured: boolean;
  /** 설정이 안 된 이유 또는 키 파일 주소 */
  detail: string;
  pendingCount: number;
  recent: { created_at: string; trigger: string; url_count: number; success: boolean; status_code: number | null; error: string | null }[];
}

interface AutoPublishSettingsPanelProps {
  enabled: boolean;
  dailyLimit: number;
  noindexThinPages: boolean;
  limitRange: { min: number; max: number };
  runs: PublishRunView[];
  indexNow: IndexNowView;
  loadError: string | null;
}

const TRIGGER_LABEL: Record<string, string> = {
  cron: "자동",
  manual: "지금 실행",
  admin: "관리자 화면 접속",
};

const formatKst = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

/** 6단계: 매일 자동 공개 설정 + 최근 실행 기록 + 검색엔진 알림(IndexNow) */
export default function AutoPublishSettingsPanel({
  enabled: initialEnabled,
  dailyLimit: initialLimit,
  noindexThinPages: initialNoindexThin,
  limitRange,
  runs,
  indexNow,
  loadError,
}: AutoPublishSettingsPanelProps) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [dailyLimit, setDailyLimit] = useState(String(initialLimit));
  const [noindexThinPages, setNoindexThinPages] = useState(initialNoindexThin);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const run = (action: () => Promise<{ success: boolean; error?: string; message?: string }>, done: string) => {
    if (isPending) return;
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage(
        result.success
          ? { type: "success", text: result.message ?? done }
          : { type: "error", text: result.error ?? "처리하지 못했습니다." }
      );
      if (result.success) router.refresh();
    });
  };

  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const limit = Number(dailyLimit);
    if (!Number.isInteger(limit) || limit < limitRange.min || limit > limitRange.max) {
      setMessage({ type: "error", text: `하루 개수는 ${limitRange.min}~${limitRange.max} 사이의 정수여야 합니다.` });
      return;
    }
    run(() => updateAutoPublishSettingsAction({ enabled, dailyLimit: limit, noindexThinPages }), "저장했습니다.");
  };

  const handleRunNow = () => {
    const confirmed = window.confirm(
      `공개 대기(ready) 항목을 오래된 순으로 최대 ${initialLimit}개 지금 공개합니다.\n오늘(한국 날짜) 이미 실행했다면 아무것도 하지 않습니다. 계속할까요?`
    );
    if (!confirmed) return;
    run(runAutoPublishNowAction, "실행했습니다.");
  };

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900">매일 자동 공개</h2>
      <p className="mt-1 text-sm text-slate-500">
        켜 두면 매일 오전 9시(한국 시간)에 공개 대기(ready) 항목을 오래된 순으로 하루 개수만큼 공개합니다.
        하루에 한 번만 실행되며, &apos;지금 1회 실행&apos;도 그날의 1회로 셉니다.
      </p>
      {loadError ? <p className="mt-2 text-xs text-amber-700">{loadError}</p> : null}

      <form onSubmit={handleSave} className="mt-4 flex flex-col gap-4">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            id="autoPublishEnabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          자동 공개 켜기
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            id="noindexThinPages"
            type="checkbox"
            className="mt-0.5"
            checked={noindexThinPages}
            onChange={(e) => setNoindexThinPages(e.target.checked)}
          />
          <span>
            내용이 적은 페이지는 검색 제외(noindex)로 공개
            <span className="block text-xs text-slate-500">
              소개 문구 200자 미만이면서 대표 사진·현장 사례가 모두 없는 페이지. 기본은 꺼짐(업로드 때 경고만).
              켜면 이후 공개되는 페이지부터 적용되고, 관리자 화면의 SEO 설정에서 페이지별로 다시 바꿀 수 있습니다.
            </span>
          </span>
        </label>
        <div className="max-w-xs">
          <FormField label="하루 공개 개수" htmlFor="autoPublishDailyLimit" hint={`${limitRange.min}~${limitRange.max}, 기본 50`}>
            <input
              id="autoPublishDailyLimit"
              type="number"
              min={limitRange.min}
              max={limitRange.max}
              step={1}
              className={inputClassName}
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
            />
          </FormField>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            저장
          </button>
          <button
            type="button"
            onClick={handleRunNow}
            disabled={isPending}
            className="rounded-md border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            지금 1회 실행
          </button>
        </div>
        {message ? (
          <p className={`text-sm ${message.type === "error" ? "text-red-600" : "text-green-700"}`}>{message.text}</p>
        ) : null}
      </form>

      <h3 className="mt-6 text-sm font-semibold text-slate-800">최근 실행 기록</h3>
      {runs.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">아직 실행 기록이 없습니다.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-3 py-2 font-medium">날짜(한국)</th>
                <th className="px-3 py-2 font-medium">방식</th>
                <th className="px-3 py-2 font-medium">공개</th>
                <th className="px-3 py-2 font-medium">실패</th>
                <th className="px-3 py-2 font-medium">끝난 시각</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 text-slate-700 last:border-0">
                  <td className="px-3 py-2">{r.run_date}</td>
                  <td className="px-3 py-2">{r.trigger ? TRIGGER_LABEL[r.trigger] : "-"}</td>
                  <td className="px-3 py-2">{r.published_count}</td>
                  <td className={`px-3 py-2 ${r.failed_count > 0 ? "text-red-600" : ""}`}>{r.failed_count}</td>
                  <td className="px-3 py-2 text-slate-500">{r.finished_at ? formatKst(r.finished_at) : "진행 중/중단"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="mt-6 text-sm font-semibold text-slate-800">검색엔진 알림(IndexNow)</h3>
      <p className="mt-1 text-sm text-slate-500">
        새로 공개된 페이지 주소를 네이버(IndexNow)에 바로 알립니다. Bing 등 다른 IndexNow 검색엔진에도
        함께 공유됩니다. 관리자 대시보드를 열 때와 &apos;지금 1회 실행&apos; 뒤에 자동으로 보내며, 실패한 주소는
        다음에 다시 보냅니다.
      </p>
      <p className={`mt-2 text-sm ${indexNow.configured ? "text-slate-700" : "text-amber-700"}`}>
        {indexNow.configured ? `키 파일: ${indexNow.detail}` : `설정 필요: ${indexNow.detail}`}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-slate-700">
          아직 알리지 않은 공개 페이지 <span className="font-semibold">{indexNow.pendingCount}</span>개
        </span>
        <button
          type="button"
          onClick={() => run(sendIndexNowAction, "보냈습니다.")}
          disabled={isPending || !indexNow.configured}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          지금 보내기
        </button>
      </div>
      {indexNow.recent.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1 text-xs text-slate-600">
          {indexNow.recent.map((s) => (
            <li key={s.created_at}>
              {formatKst(s.created_at)} · {TRIGGER_LABEL[s.trigger] ?? s.trigger} · {s.url_count}개 ·{" "}
              {s.success ? (
                <span className="text-green-700">성공({s.status_code})</span>
              ) : (
                <span className="text-red-600">실패{s.error ? `: ${s.error}` : ""}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
