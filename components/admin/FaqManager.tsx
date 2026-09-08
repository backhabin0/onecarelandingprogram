"use client";

import { useState, useTransition, type FormEvent } from "react";
import type { LandingPageFaq } from "@/types/seo";
import Card from "@/components/admin/Card";
import FormField from "@/components/admin/FormField";
import {
  createFaqAction,
  deleteFaqAction,
  moveFaqAction,
  updateFaqAction,
} from "@/app/admin/pages/actions";
import { MAX_FAQS_PER_LANDING_PAGE } from "@/lib/faq-constants";

interface FaqManagerProps {
  landingPageId: string;
  slug: string;
  initialFaqs: LandingPageFaq[];
}

const QUESTION_MAX_LENGTH = 200;
const ANSWER_MAX_LENGTH = 2000;

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

const EMPTY_DRAFT = { question: "", answer: "" };

export default function FaqManager({
  landingPageId,
  slug,
  initialFaqs,
}: FaqManagerProps) {
  const [faqs, setFaqs] = useState<LandingPageFaq[]>(initialFaqs);
  const [newFaq, setNewFaq] = useState(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const canAddMore = faqs.length < MAX_FAQS_PER_LANDING_PAGE;

  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPending) return;
    setError(null);

    startTransition(async () => {
      const result = await createFaqAction(landingPageId, slug, newFaq);
      if (!result.success || !result.id) {
        setError(result.error ?? "FAQ를 추가하지 못했습니다.");
        return;
      }

      setFaqs((prev) => [
        ...prev,
        {
          id: result.id!,
          landing_page_id: landingPageId,
          question: newFaq.question.trim(),
          answer: newFaq.answer.trim(),
          sort_order: prev.length,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);
      setNewFaq(EMPTY_DRAFT);
    });
  };

  const startEdit = (faq: LandingPageFaq) => {
    setEditingId(faq.id);
    setEditDraft({ question: faq.question, answer: faq.answer });
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(EMPTY_DRAFT);
  };

  const handleUpdate = (faq: LandingPageFaq) => {
    if (isPending) return;
    setError(null);
    setPendingId(faq.id);

    startTransition(async () => {
      const result = await updateFaqAction(faq.id, landingPageId, slug, {
        question: editDraft.question,
        answer: editDraft.answer,
        isActive: faq.is_active,
      });

      if (!result.success) {
        setError(result.error ?? "FAQ를 수정하지 못했습니다.");
        setPendingId(null);
        return;
      }

      setFaqs((prev) =>
        prev.map((item) =>
          item.id === faq.id
            ? { ...item, question: editDraft.question.trim(), answer: editDraft.answer.trim() }
            : item
        )
      );
      setEditingId(null);
      setEditDraft(EMPTY_DRAFT);
      setPendingId(null);
    });
  };

  const handleToggleActive = (faq: LandingPageFaq) => {
    if (isPending) return;
    setError(null);
    setPendingId(faq.id);

    startTransition(async () => {
      const result = await updateFaqAction(faq.id, landingPageId, slug, {
        question: faq.question,
        answer: faq.answer,
        isActive: !faq.is_active,
      });

      if (!result.success) {
        setError(result.error ?? "FAQ 상태를 변경하지 못했습니다.");
        setPendingId(null);
        return;
      }

      setFaqs((prev) =>
        prev.map((item) =>
          item.id === faq.id ? { ...item, is_active: !item.is_active } : item
        )
      );
      setPendingId(null);
    });
  };

  const handleDelete = (faq: LandingPageFaq) => {
    if (isPending) return;
    const confirmed = window.confirm("이 FAQ를 삭제하시겠습니까?");
    if (!confirmed) return;

    setError(null);
    setPendingId(faq.id);

    startTransition(async () => {
      const result = await deleteFaqAction(faq.id, landingPageId, slug);
      if (!result.success) {
        setError(result.error ?? "FAQ를 삭제하지 못했습니다.");
        setPendingId(null);
        return;
      }

      setFaqs((prev) => prev.filter((item) => item.id !== faq.id));
      setPendingId(null);
    });
  };

  const handleMove = (faq: LandingPageFaq, direction: "up" | "down") => {
    if (isPending) return;
    const index = faqs.findIndex((item) => item.id === faq.id);
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= faqs.length) return;

    setError(null);
    setPendingId(faq.id);

    startTransition(async () => {
      const result = await moveFaqAction(faq.id, landingPageId, slug, direction);
      if (!result.success) {
        setError(result.error ?? "순서를 변경하지 못했습니다.");
        setPendingId(null);
        return;
      }

      setFaqs((prev) => {
        const next = [...prev];
        [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
        return next;
      });
      setPendingId(null);
    });
  };

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900">수동 FAQ 관리</h2>
      <p className="mt-1 text-sm text-slate-500">
        여기서 추가한 FAQ는 자동 FAQ와 함께(또는 자동 FAQ를 끈 경우 단독으로)
        공개 페이지와 FAQPage 구조화 데이터에 그대로 노출됩니다. 입력한
        내용의 사실 여부는 관리자가 책임집니다. 최대 {MAX_FAQS_PER_LANDING_PAGE}개.
      </p>

      {error ? (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-4">
        {faqs.map((faq, index) => (
          <div
            key={faq.id}
            className="rounded-md border border-slate-200 p-4"
          >
            {editingId === faq.id ? (
              <div className="flex flex-col gap-3">
                <FormField label="질문" htmlFor={`edit-question-${faq.id}`}>
                  <input
                    id={`edit-question-${faq.id}`}
                    className={inputClassName}
                    maxLength={QUESTION_MAX_LENGTH}
                    value={editDraft.question}
                    onChange={(e) =>
                      setEditDraft((prev) => ({ ...prev, question: e.target.value }))
                    }
                  />
                </FormField>
                <FormField label="답변" htmlFor={`edit-answer-${faq.id}`}>
                  <textarea
                    id={`edit-answer-${faq.id}`}
                    rows={3}
                    className={inputClassName}
                    maxLength={ANSWER_MAX_LENGTH}
                    value={editDraft.answer}
                    onChange={(e) =>
                      setEditDraft((prev) => ({ ...prev, answer: e.target.value }))
                    }
                  />
                </FormField>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUpdate(faq)}
                    disabled={isPending && pendingId === faq.id}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isPending && pendingId === faq.id ? "저장 중..." : "저장"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {faq.question}
                    </p>
                    <p className="mt-1 whitespace-pre-line text-sm text-slate-600">
                      {faq.answer}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      faq.is_active
                        ? "bg-green-50 text-green-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {faq.is_active ? "노출 중" : "숨김"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleMove(faq, "up")}
                    disabled={isPending || index === 0}
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    위로
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMove(faq, "down")}
                    disabled={isPending || index === faqs.length - 1}
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    아래로
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(faq)}
                    disabled={isPending}
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleActive(faq)}
                    disabled={isPending && pendingId === faq.id}
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {faq.is_active ? "숨기기" : "노출하기"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(faq)}
                    disabled={isPending && pendingId === faq.id}
                    className="rounded-md border border-red-100 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    삭제
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {faqs.length === 0 ? (
          <p className="text-sm text-slate-400">등록된 수동 FAQ가 없습니다.</p>
        ) : null}
      </div>

      <form
        onSubmit={handleCreate}
        className="mt-6 flex flex-col gap-3 rounded-md border border-dashed border-slate-300 p-4"
      >
        <h3 className="text-sm font-semibold text-slate-800">FAQ 추가</h3>
        <FormField label="질문" htmlFor="new-faq-question">
          <input
            id="new-faq-question"
            required
            className={inputClassName}
            placeholder="예: 주차장이 있나요?"
            maxLength={QUESTION_MAX_LENGTH}
            value={newFaq.question}
            onChange={(e) => setNewFaq((prev) => ({ ...prev, question: e.target.value }))}
            disabled={!canAddMore}
          />
        </FormField>
        <FormField label="답변" htmlFor="new-faq-answer">
          <textarea
            id="new-faq-answer"
            required
            rows={3}
            className={inputClassName}
            placeholder="예: 건물 지하 주차장을 이용할 수 있습니다."
            maxLength={ANSWER_MAX_LENGTH}
            value={newFaq.answer}
            onChange={(e) => setNewFaq((prev) => ({ ...prev, answer: e.target.value }))}
            disabled={!canAddMore}
          />
        </FormField>
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-400">
            {canAddMore
              ? `${faqs.length}/${MAX_FAQS_PER_LANDING_PAGE}개 사용 중`
              : `최대 ${MAX_FAQS_PER_LANDING_PAGE}개까지 등록할 수 있습니다.`}
          </p>
          <button
            type="submit"
            disabled={isPending || !canAddMore}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "추가 중..." : "FAQ 추가"}
          </button>
        </div>
      </form>
    </Card>
  );
}
