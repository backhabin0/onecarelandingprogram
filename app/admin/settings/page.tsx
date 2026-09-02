import PageHeader from "@/components/admin/PageHeader";
import Card from "@/components/admin/Card";

export default function AdminSettingsPage() {
  return (
    <div>
      <PageHeader
        title="설정"
        description="관리자 계정 및 시스템 설정 화면입니다. (추후 단계에서 구현)"
      />

      <Card className="p-6">
        <p className="text-sm text-slate-500">
          현재 단계에서는 준비 중인 화면입니다. 다음 단계에서 계정 관리, 배포
          설정 등의 기능이 추가될 예정입니다.
        </p>
      </Card>
    </div>
  );
}
