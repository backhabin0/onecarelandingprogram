import PageHeader from "@/components/admin/PageHeader";
import Card from "@/components/admin/Card";
import { mockTemplates } from "@/lib/mock-data";

export default function AdminTemplatesPage() {
  return (
    <div>
      <PageHeader
        title="템플릿 관리"
        description="랜딩페이지 생성 시 선택할 수 있는 템플릿 목록입니다."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {mockTemplates.map((template) => (
          <Card key={template.id} className="overflow-hidden">
            <div className="flex h-36 items-center justify-center bg-slate-100 text-sm text-slate-400">
              템플릿 미리보기 이미지
            </div>
            <div className="p-4">
              <h3 className="text-sm font-semibold text-slate-900">
                {template.name}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {template.description}
              </p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
