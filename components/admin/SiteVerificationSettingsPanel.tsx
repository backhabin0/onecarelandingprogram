"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/admin/Card";
import FormField from "@/components/admin/FormField";
import { updateSiteVerificationAction } from "@/app/admin/settings/actions";
import type { SiteVerificationSettings } from "@/lib/site-verification";

interface SiteVerificationSettingsPanelProps {
  initialSettings: SiteVerificationSettings;
}

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

function StatusBadge({ source }: { source: "db" | "env" | "none" }) {
  if (source === "none") {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
        미설정
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        source === "db"
          ? "bg-blue-50 text-blue-700"
          : "bg-green-50 text-green-700"
      }`}
    >
      {source === "db" ? "설정됨 (관리자)" : "설정됨 (환경변수)"}
    </span>
  );
}

export default function SiteVerificationSettingsPanel({
  initialSettings,
}: SiteVerificationSettingsPanelProps) {
  const router = useRouter();
  const [syncedSettings, setSyncedSettings] = useState(initialSettings);
  const [google, setGoogle] = useState(initialSettings.google.value ?? "");
  const [naver, setNaver] = useState(initialSettings.naver.value ?? "");
  const [isSaving, startSaving] = useTransition();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );

  // 저장 성공 후 router.refresh()로 서버 컴포넌트(AdminSettingsPage)가 DB에서
  // 다시 조회한 최신 값이 props로 내려오면, 렌더 중에 상태를 동기화한다
  // (배지 상태를 클라이언트에서 추측하지 않고 항상 실제 DB 조회 결과를 반영한다).
  if (initialSettings !== syncedSettings) {
    setSyncedSettings(initialSettings);
    setGoogle(initialSettings.google.value ?? "");
    setNaver(initialSettings.naver.value ?? "");
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) return;

    setMessage(null);
    startSaving(async () => {
      const result = await updateSiteVerificationAction({ google, naver });

      if (result.success) {
        setMessage({ type: "success", text: "검색엔진 인증 설정을 저장했습니다." });
        router.refresh();
      } else {
        setMessage({
          type: "error",
          text: result.error ?? "설정을 저장하지 못했습니다.",
        });
      }
    });
  };

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900">검색엔진 소유확인</h2>
      <p className="mt-1 text-sm text-slate-500">
        onecarepage.co.kr 도메인 전체에 적용되는 전역 설정입니다. 저장하면
        Vercel 재배포 없이 다음 페이지 요청부터 즉시 반영됩니다.
      </p>

      {message ? (
        <div
          className={`mt-4 rounded-md border px-4 py-3 text-sm ${
            message.type === "success"
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-6">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">
            Google Search Console
          </h3>
          <div className="mt-3">
            <FormField
              label="Google 인증값"
              htmlFor="googleVerification"
              hint="Google Search Console의 URL 접두어 속성에서 HTML 태그 인증을 사용할 경우 content 값을 입력합니다. 도메인 속성은 DNS TXT 인증이 필요하므로 이 설정으로 대체할 수 없습니다."
            >
              <div className="flex items-center gap-2">
                <input
                  id="googleVerification"
                  className={inputClassName}
                  placeholder="예: abc123xyz"
                  value={google}
                  maxLength={500}
                  onChange={(e) => setGoogle(e.target.value)}
                  disabled={isSaving}
                />
                <StatusBadge source={initialSettings.google.source} />
              </div>
            </FormField>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-slate-800">
            네이버 서치어드바이저
          </h3>
          <div className="mt-3">
            <FormField
              label="네이버 인증값"
              htmlFor="naverVerification"
              hint='네이버 서치어드바이저에서 제공하는 naver-site-verification 메타태그의 content 값만 입력하세요. 예: <meta name="naver-site-verification" content="abc123"> → abc123'
            >
              <div className="flex items-center gap-2">
                <input
                  id="naverVerification"
                  className={inputClassName}
                  placeholder="예: abc123"
                  value={naver}
                  maxLength={500}
                  onChange={(e) => setNaver(e.target.value)}
                  disabled={isSaving}
                />
                <StatusBadge source={initialSettings.naver.source} />
              </div>
            </FormField>
          </div>
        </div>

        <p className="text-xs text-slate-400">
          입력값을 지우고 저장하면 DB 값은 비워지고(null), 기존 환경변수
          (GOOGLE_SITE_VERIFICATION / NAVER_SITE_VERIFICATION)가 설정되어
          있다면 그 값이 대신 사용될 수 있습니다.
        </p>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className={`rounded-md px-5 py-2.5 text-sm font-medium text-white ${
              isSaving ? "cursor-not-allowed bg-blue-400" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {isSaving ? "저장 중..." : "저장"}
          </button>
        </div>
      </form>
    </Card>
  );
}
