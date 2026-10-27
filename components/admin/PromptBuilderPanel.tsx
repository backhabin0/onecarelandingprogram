"use client";

import { useState } from "react";
import Card from "@/components/admin/Card";
import FormField from "@/components/admin/FormField";
import { LANDING_PAGE_MAX_LENGTH } from "@/lib/landing-page-validation";
import { mockTemplates } from "@/lib/mock-data";
import {
  PROMPT_CHUNK_SIZE,
  buildBulkPrompts,
  parseSlugList,
  type PromptBusinessInfo,
  type PromptPhoto,
} from "@/lib/bulk-upload/prompt";

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

const REGION_LABEL = { name: "지역", slug: "region_slug" };
const KEYWORD_LABEL = { name: "키워드", slug: "keyword_slug" };

/**
 * AI(ChatGPT·Claude 등)에 붙여넣을 프롬프트 만들기. 이 화면은 AI를 직접 호출하지 않는다.
 * AI가 돌려준 표는 "올리기" 탭에 붙여넣거나 엑셀로 저장해 올린다.
 */
interface PromptBuilderPanelProps {
  /** 사진 보관함의 사진(로고 제외) — 있으면 프롬프트에 목록과 사진 고르기 규칙이 들어간다 */
  libraryPhotos?: readonly PromptPhoto[];
  /** 보관함 목록을 못 불러왔을 때 안내 */
  libraryPhotosError?: string | null;
}

export default function PromptBuilderPanel({ libraryPhotos = [], libraryPhotosError = null }: PromptBuilderPanelProps) {
  const [regionsText, setRegionsText] = useState("");
  const [keywordsText, setKeywordsText] = useState("");
  const [business, setBusiness] = useState<PromptBusinessInfo>({
    businessName: "",
    phone: "",
    kakaoUrl: "",
    address: "",
    template: mockTemplates[0]?.id ?? "template-a",
    industry: "",
  });
  const [copied, setCopied] = useState<number | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const regions = parseSlugList(regionsText, REGION_LABEL);
  const keywords = parseSlugList(keywordsText, KEYWORD_LABEL);
  const combinationCount = regions.items.length * keywords.items.length;
  const inputErrors = [...regions.errors, ...keywords.errors].map((e) => e.message);
  const result =
    inputErrors.length === 0 && (regions.items.length > 0 || keywords.items.length > 0)
      ? buildBulkPrompts({ regions: regions.items, keywords: keywords.items, business, photos: libraryPhotos })
      : null;

  const set = (field: keyof PromptBusinessInfo, value: string) =>
    setBusiness((current) => ({ ...current, [field]: value }));

  const handleCopy = async (index: number, text: string) => {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(index);
      setTimeout(() => setCopied((current) => (current === index ? null : current)), 2000);
    } catch {
      setCopyError("복사하지 못했습니다. 아래 상자의 내용을 직접 선택해 복사해주세요.");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900">1. 지역과 키워드</h2>
        <p className="mt-1 text-sm text-slate-500">
          한 줄에 하나씩 &quot;이름, slug&quot;로 입력하세요. slug는 영문 소문자·숫자·하이픈만 쓸 수 있고,
          페이지 주소는 region_slug-keyword_slug가 됩니다.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="지역 목록" htmlFor="promptRegions" hint="예: 강남, gangnam">
            <textarea
              id="promptRegions"
              className={`${inputClassName} min-h-40 font-mono`}
              placeholder={"강남, gangnam\n서초, seocho"}
              value={regionsText}
              onChange={(e) => setRegionsText(e.target.value)}
            />
          </FormField>
          <FormField label="키워드 목록" htmlFor="promptKeywords" hint="예: 헬스장, gym">
            <textarea
              id="promptKeywords"
              className={`${inputClassName} min-h-40 font-mono`}
              placeholder={"헬스장, gym\nPT, pt"}
              value={keywordsText}
              onChange={(e) => setKeywordsText(e.target.value)}
            />
          </FormField>
        </div>
        <p className="mt-3 text-sm text-slate-700">
          지역 {regions.items.length}개 × 키워드 {keywords.items.length}개 ={" "}
          <span className="font-semibold">{combinationCount.toLocaleString()}개 조합</span>
          {combinationCount > PROMPT_CHUNK_SIZE
            ? ` → 프롬프트 ${Math.ceil(combinationCount / PROMPT_CHUNK_SIZE)}개로 나눠 만듭니다(${PROMPT_CHUNK_SIZE}개씩)`
            : ""}
        </p>
        {inputErrors.length > 0 ? (
          <ul className="mt-2 list-disc pl-5 text-xs text-red-600">
            {inputErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900">2. 공통 업체 정보</h2>
        <p className="mt-1 text-sm text-slate-500">
          모든 행에 똑같이 들어갑니다. AI에게는 이 값을 바꾸지 말고 그대로 복사하라고 지시합니다.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="업체명 *" htmlFor="promptBusinessName">
            <input
              id="promptBusinessName"
              className={inputClassName}
              maxLength={LANDING_PAGE_MAX_LENGTH.businessName}
              value={business.businessName}
              onChange={(e) => set("businessName", e.target.value)}
            />
          </FormField>
          <FormField label="전화" htmlFor="promptPhone">
            <input
              id="promptPhone"
              className={inputClassName}
              maxLength={LANDING_PAGE_MAX_LENGTH.phone}
              value={business.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </FormField>
          <FormField label="카카오 URL" htmlFor="promptKakao">
            <input
              id="promptKakao"
              className={inputClassName}
              maxLength={LANDING_PAGE_MAX_LENGTH.kakaoUrl}
              value={business.kakaoUrl}
              onChange={(e) => set("kakaoUrl", e.target.value)}
            />
          </FormField>
          <FormField label="주소" htmlFor="promptAddress">
            <input
              id="promptAddress"
              className={inputClassName}
              maxLength={LANDING_PAGE_MAX_LENGTH.address}
              value={business.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </FormField>
          <FormField label="템플릿" htmlFor="promptTemplate">
            <select
              id="promptTemplate"
              className={inputClassName}
              value={business.template}
              onChange={(e) => set("template", e.target.value)}
            >
              {mockTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} ({template.id})
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="업종 설명(선택)" htmlFor="promptIndustry" hint="한두 줄. 예: 1:1 PT 중심의 소규모 헬스장">
            <input
              id="promptIndustry"
              className={inputClassName}
              maxLength={200}
              value={business.industry}
              onChange={(e) => set("industry", e.target.value)}
            />
          </FormField>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900">3. 프롬프트 복사</h2>
        <p className="mt-1 text-sm text-slate-500">
          프롬프트를 ChatGPT·Claude 같은 AI에 붙여넣고, AI가 준 표를 &quot;올리기&quot; 탭의 붙여넣기 칸에
          넣거나 엑셀로 저장해 올리세요. 올린 뒤에는 엑셀 업로드와 같은 검사를 거칩니다.
        </p>
        <p className="mt-2 text-sm text-slate-600" data-testid="prompt-photo-note">
          {libraryPhotos.length > 0
            ? `사진 보관함의 사진 ${libraryPhotos.length.toLocaleString()}장(파일 이름·설명)이 프롬프트에 들어갑니다. AI가 페이지 내용에 맞는 사진을 골라 대표 사진·사진2·사진3 칸에 파일 이름으로 넣습니다.`
            : "사진 보관함에 사진이 없어 사진 칸은 비워 둡니다. 보관함에 사진을 올리면 AI가 사진도 골라 넣습니다."}
        </p>
        {libraryPhotosError ? <p className="mt-1 text-sm text-amber-700">{libraryPhotosError}</p> : null}
        {result && result.errors.length > 0 ? (
          <ul className="mt-3 list-disc pl-5 text-sm text-red-600">
            {result.errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ) : null}
        {copyError ? <p className="mt-3 text-sm text-red-600">{copyError}</p> : null}
        {result && result.prompts.length > 0 ? (
          <div className="mt-4 flex flex-col gap-4">
            {result.prompts.map((prompt, index) => (
              <div key={prompt.from} className="rounded-md border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-800">
                    프롬프트 {index + 1}
                    {result.prompts.length > 1 ? ` / ${result.prompts.length}` : ""} · {prompt.from}~{prompt.to}행 (
                    {prompt.count}개)
                  </p>
                  <button
                    type="button"
                    onClick={() => handleCopy(index, prompt.text)}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    {copied === index ? "복사됨" : "프롬프트 복사"}
                  </button>
                </div>
                <textarea
                  readOnly
                  aria-label={`프롬프트 ${index + 1}`}
                  className={`${inputClassName} mt-3 min-h-48 font-mono text-xs`}
                  value={prompt.text}
                />
              </div>
            ))}
          </div>
        ) : !result ? (
          <p className="mt-3 text-sm text-slate-400">지역과 키워드를 입력하면 프롬프트가 만들어집니다.</p>
        ) : null}
      </Card>
    </div>
  );
}
