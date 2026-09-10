import PageHeader from "@/components/admin/PageHeader";
import Card from "@/components/admin/Card";
import SiteVerificationSettingsPanel from "@/components/admin/SiteVerificationSettingsPanel";
import { getSiteVerificationSettings } from "@/lib/site-verification";

// 저장 직후 다음 요청부터 최신 DB 값을 보여줘야 하므로 캐시하지 않는다.
export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const siteVerification = await getSiteVerificationSettings();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="설정"
        description="관리자 계정 및 시스템 설정 화면입니다. (추후 단계에서 구현)"
      />

      <SiteVerificationSettingsPanel initialSettings={siteVerification} />

      <Card className="p-6">
        <p className="text-sm text-slate-500">
          현재 단계에서는 검색엔진 소유확인 설정만 제공됩니다. 다음 단계에서
          계정 관리 등의 기능이 추가될 예정입니다.
        </p>
      </Card>
    </div>
  );
}
