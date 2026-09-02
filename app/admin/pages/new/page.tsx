import PageHeader from "@/components/admin/PageHeader";
import LandingPageForm from "@/components/admin/LandingPageForm";

export default function NewLandingPagePage() {
  return (
    <div>
      <PageHeader
        title="새 랜딩페이지 만들기"
        description="업체 정보를 입력하고 템플릿을 선택하세요."
      />
      <LandingPageForm />
    </div>
  );
}
