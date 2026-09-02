import PageHeader from "@/components/admin/PageHeader";
import Card from "@/components/admin/Card";
import { mockTemplates } from "@/lib/mock-data";

const PREVIEW_STYLES: Record<string, string> = {
  "template-a": "bg-gradient-to-br from-blue-50 to-white text-blue-400",
  "template-b": "bg-gradient-to-br from-slate-900 to-orange-500 text-white",
};

export default function AdminTemplatesPage() {
  return (
    <div>
      <PageHeader
        title="템플릿 관리"
        description="랜딩페이지 생성/수정 시 선택할 수 있는 템플릿 목록입니다."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {mockTemplates.map((template) => (
          <Card key={template.id} className="overflow-hidden">
            <div
              className={`flex h-32 items-center justify-center text-sm font-medium ${
                PREVIEW_STYLES[template.id] ?? "bg-slate-100 text-slate-400"
              }`}
            >
              {template.name} 미리보기
            </div>
            <div className="p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  {template.name}
                </h3>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    template.available
                      ? "bg-green-100 text-green-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {template.available ? "사용 가능" : "준비 중"}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {template.description}
              </p>
              {template.features.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-1 text-xs text-slate-500">
                  {template.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-1.5">
                      <span className="mt-0.5 text-blue-500">✓</span>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
