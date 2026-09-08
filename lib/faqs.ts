import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { CreateFaqInput, LandingPageFaq, UpdateFaqInput } from "@/types/seo";
import { MAX_FAQS_PER_LANDING_PAGE } from "@/lib/faq-constants";

export { MAX_FAQS_PER_LANDING_PAGE };

interface GetFaqsResult {
  data: LandingPageFaq[];
  error: string | null;
}

/** 관리자 화면 전용: 비활성 포함 전체 FAQ를 정렬 순서대로 조회한다. */
export async function getFaqsByLandingPageId(
  landingPageId: string
): Promise<GetFaqsResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("landing_page_faqs")
      .select("*")
      .eq("landing_page_id", landingPageId)
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("[landing_page_faqs] select error:", error);
      return { data: [], error: "FAQ 목록을 불러오지 못했습니다." };
    }

    return { data: (data as LandingPageFaq[]) ?? [], error: null };
  } catch (err) {
    console.error("[landing_page_faqs] client error:", err);
    return {
      data: [],
      error:
        err instanceof Error ? err.message : "FAQ 목록을 불러오지 못했습니다.",
    };
  }
}

export interface CreateFaqResult {
  success: boolean;
  error?: string;
  id?: string;
}

export async function createFaq(
  landingPageId: string,
  input: CreateFaqInput
): Promise<CreateFaqResult> {
  try {
    const supabase = await getSupabaseServerClient();

    const { count, error: countError } = await supabase
      .from("landing_page_faqs")
      .select("id", { count: "exact", head: true })
      .eq("landing_page_id", landingPageId);

    if (countError) {
      console.error("[landing_page_faqs] count error:", countError);
      return { success: false, error: "FAQ 개수를 확인하지 못했습니다." };
    }

    if ((count ?? 0) >= MAX_FAQS_PER_LANDING_PAGE) {
      return {
        success: false,
        error: `FAQ는 페이지당 최대 ${MAX_FAQS_PER_LANDING_PAGE}개까지 등록할 수 있습니다.`,
      };
    }

    const { data, error } = await supabase
      .from("landing_page_faqs")
      .insert({
        landing_page_id: landingPageId,
        question: input.question,
        answer: input.answer,
        sort_order: count ?? 0,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[landing_page_faqs] insert error:", error);
      return { success: false, error: "FAQ를 저장하지 못했습니다." };
    }

    return { success: true, id: data.id };
  } catch (err) {
    console.error("[landing_page_faqs] client error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "FAQ를 저장하지 못했습니다.",
    };
  }
}

export interface UpdateFaqResult {
  success: boolean;
  error?: string;
}

export async function updateFaq(
  id: string,
  input: UpdateFaqInput
): Promise<UpdateFaqResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase
      .from("landing_page_faqs")
      .update({
        question: input.question,
        answer: input.answer,
        is_active: input.isActive,
      })
      .eq("id", id);

    if (error) {
      console.error("[landing_page_faqs] update error:", error);
      return { success: false, error: "FAQ를 수정하지 못했습니다." };
    }

    return { success: true };
  } catch (err) {
    console.error("[landing_page_faqs] client error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "FAQ를 수정하지 못했습니다.",
    };
  }
}

export interface DeleteFaqResult {
  success: boolean;
  error?: string;
}

export async function deleteFaq(id: string): Promise<DeleteFaqResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase
      .from("landing_page_faqs")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("[landing_page_faqs] delete error:", error);
      return { success: false, error: "FAQ를 삭제하지 못했습니다." };
    }

    return { success: true };
  } catch (err) {
    console.error("[landing_page_faqs] client error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "FAQ를 삭제하지 못했습니다.",
    };
  }
}

export type FaqMoveDirection = "up" | "down";

export interface MoveFaqResult {
  success: boolean;
  error?: string;
}

/**
 * FAQ 정렬 순서를 이웃 항목과 맞바꾼다. 관리자 목록에서 위/아래 버튼으로
 * 호출된다 — 별도의 드래그 정렬 UI는 만들지 않는다.
 */
export async function moveFaq(
  landingPageId: string,
  id: string,
  direction: FaqMoveDirection
): Promise<MoveFaqResult> {
  try {
    const { data: faqs, error } = await getFaqsByLandingPageId(landingPageId);
    if (error) {
      return { success: false, error };
    }

    const index = faqs.findIndex((faq) => faq.id === id);
    if (index === -1) {
      return { success: false, error: "FAQ를 찾을 수 없습니다." };
    }

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= faqs.length) {
      // 이미 맨 위/맨 아래인 경우 조용히 무시한다.
      return { success: true };
    }

    const current = faqs[index];
    const target = faqs[targetIndex];

    const supabase = await getSupabaseServerClient();
    const [currentUpdate, targetUpdate] = await Promise.all([
      supabase
        .from("landing_page_faqs")
        .update({ sort_order: target.sort_order })
        .eq("id", current.id),
      supabase
        .from("landing_page_faqs")
        .update({ sort_order: current.sort_order })
        .eq("id", target.id),
    ]);

    if (currentUpdate.error || targetUpdate.error) {
      console.error(
        "[landing_page_faqs] move error:",
        currentUpdate.error ?? targetUpdate.error
      );
      return { success: false, error: "순서를 변경하지 못했습니다." };
    }

    return { success: true };
  } catch (err) {
    console.error("[landing_page_faqs] client error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "순서를 변경하지 못했습니다.",
    };
  }
}
