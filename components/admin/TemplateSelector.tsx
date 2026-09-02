"use client";

import type { Template } from "@/types/landing-page";

interface TemplateSelectorProps {
  templates: Template[];
  selectedTemplateId: string;
  onSelect: (templateId: string) => void;
}

export default function TemplateSelector({
  templates,
  selectedTemplateId,
  onSelect,
}: TemplateSelectorProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {templates.map((template) => {
        const selected = template.id === selectedTemplateId;
        return (
          <button
            key={template.id}
            type="button"
            onClick={() => onSelect(template.id)}
            className={`overflow-hidden rounded-lg border text-left transition-colors ${
              selected
                ? "border-blue-600 ring-2 ring-blue-100"
                : "border-slate-200 hover:border-slate-300"
            }`}
          >
            <div className="flex h-32 items-center justify-center bg-slate-100 text-sm text-slate-400">
              {template.name} 미리보기
            </div>
            <div className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {template.name}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {template.description}
                </p>
              </div>
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold ${
                  selected
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-slate-300 text-transparent"
                }`}
              >
                ✓
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
