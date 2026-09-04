import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { removeLandingPageImageByUrl } from "@/lib/storage/landing-page-assets";
import type {
  CreateLandingPageInput,
  LandingPage,
  LandingPageStatus,
  UpdateLandingPageInput,
} from "@/types/landing-page";

interface GetLandingPagesResult {
  data: LandingPage[];
  error: string | null;
}

export async function getLandingPages(): Promise<GetLandingPagesResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("landing_pages")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[landing_pages] select error:", error);
      return { data: [], error: "랜딩페이지 목록을 불러오지 못했습니다." };
    }

    return { data: (data as LandingPage[]) ?? [], error: null };
  } catch (err) {
    console.error("[landing_pages] client error:", err);
    return {
      data: [],
      error:
        err instanceof Error
          ? err.message
          : "랜딩페이지 목록을 불러오는 중 오류가 발생했습니다.",
    };
  }
}

export interface InsertLandingPageResult {
  success: boolean;
  error?: string;
  id?: string;
}

export async function insertLandingPage(
  input: CreateLandingPageInput
): Promise<InsertLandingPageResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("landing_pages")
      .insert({
        business_name: input.businessName,
        title: input.title,
        slug: input.slug,
        hero_text: input.heroText || null,
        description: input.description || null,
        phone: input.phone || null,
        kakao_url: input.kakaoUrl || null,
        address: input.address || null,
        template: input.template,
        status: input.status,
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        return { success: false, error: "이미 사용 중인 URL입니다." };
      }
      console.error("[landing_pages] insert error:", error);
      return {
        success: false,
        error: "저장 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
      };
    }

    return { success: true, id: data.id };
  } catch (err) {
    console.error("[landing_pages] client error:", err);
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "저장 중 알 수 없는 오류가 발생했습니다.",
    };
  }
}

interface GetLandingPageByIdResult {
  data: LandingPage | null;
  error: string | null;
}

export async function getLandingPageById(
  id: string
): Promise<GetLandingPageByIdResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("landing_pages")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[landing_pages] select by id error:", error);
      return { data: null, error: "랜딩페이지를 불러오지 못했습니다." };
    }

    return { data: (data as LandingPage | null) ?? null, error: null };
  } catch (err) {
    console.error("[landing_pages] client error:", err);
    return {
      data: null,
      error:
        err instanceof Error
          ? err.message
          : "랜딩페이지를 불러오는 중 오류가 발생했습니다.",
    };
  }
}

export interface UpdateLandingPageResult {
  success: boolean;
  error?: string;
}

export async function updateLandingPage(
  id: string,
  input: UpdateLandingPageInput
): Promise<UpdateLandingPageResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase
      .from("landing_pages")
      .update({
        business_name: input.businessName,
        title: input.title,
        slug: input.slug,
        hero_text: input.heroText || null,
        description: input.description || null,
        phone: input.phone || null,
        kakao_url: input.kakaoUrl || null,
        address: input.address || null,
        template: input.template,
        status: input.status,
      })
      .eq("id", id);

    if (error) {
      if (error.code === "23505") {
        return { success: false, error: "이미 사용 중인 URL입니다." };
      }
      console.error("[landing_pages] update error:", error);
      return {
        success: false,
        error: "수정 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
      };
    }

    return { success: true };
  } catch (err) {
    console.error("[landing_pages] client error:", err);
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "수정 중 알 수 없는 오류가 발생했습니다.",
    };
  }
}

export interface DeleteLandingPageResult {
  success: boolean;
  error?: string;
}

export async function deleteLandingPage(
  id: string
): Promise<DeleteLandingPageResult> {
  try {
    const supabase = await getSupabaseServerClient();

    // Storage 정리를 위해 삭제 전에 이 페이지가 사용 중인 이미지 URL을 확보한다.
    // (다른 페이지의 이미지는 절대 건드리지 않도록 이 row에 한정해서만 조회한다)
    const { data: existing } = await supabase
      .from("landing_pages")
      .select("logo_url, main_image_url")
      .eq("id", id)
      .maybeSingle();

    const { error } = await supabase.from("landing_pages").delete().eq("id", id);

    if (error) {
      console.error("[landing_pages] delete error:", error);
      return { success: false, error: "랜딩페이지를 삭제하지 못했습니다." };
    }

    if (existing) {
      // DB row는 이미 삭제되었으므로, Storage 정리 실패가 되살릴 수는 없다.
      // best-effort로만 처리한다.
      await Promise.all([
        removeLandingPageImageByUrl(supabase, existing.logo_url),
        removeLandingPageImageByUrl(supabase, existing.main_image_url),
      ]);
    }

    return { success: true };
  } catch (err) {
    console.error("[landing_pages] client error:", err);
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "랜딩페이지를 삭제하지 못했습니다.",
    };
  }
}

interface GetPublicLandingPageBySlugResult {
  data: LandingPage | null;
  error: string | null;
}

/**
 * 고객용 공개 페이지(/[slug])에서 사용하는 조회 함수.
 *
 * anon 대상 RLS(status = 'public')에도 의존하지만, 그것만으로 끝내지 않고
 * 애플리케이션 쿼리에도 status = 'public' 조건을 명시한다 — 관리자 세션으로
 * 이 함수가 호출되더라도(예: 프리뷰) private 페이지가 노출되지 않게 하기 위함이다.
 */
export async function getPublicLandingPageBySlug(
  slug: string
): Promise<GetPublicLandingPageBySlugResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("landing_pages")
      .select("*")
      .eq("slug", slug)
      .eq("status", "public")
      .maybeSingle();

    if (error) {
      console.error("[landing_pages] select public by slug error:", error);
      return { data: null, error: "랜딩페이지를 불러오지 못했습니다." };
    }

    return { data: (data as LandingPage | null) ?? null, error: null };
  } catch (err) {
    console.error("[landing_pages] client error:", err);
    return {
      data: null,
      error:
        err instanceof Error
          ? err.message
          : "랜딩페이지를 불러오는 중 오류가 발생했습니다.",
    };
  }
}

export interface UpdateLandingPageStatusResult {
  success: boolean;
  error?: string;
}

export async function updateLandingPageStatus(
  id: string,
  status: LandingPageStatus
): Promise<UpdateLandingPageStatusResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase
      .from("landing_pages")
      .update({ status })
      .eq("id", id);

    if (error) {
      console.error("[landing_pages] update status error:", error);
      return {
        success: false,
        error: "상태를 변경하지 못했습니다. 잠시 후 다시 시도해주세요.",
      };
    }

    return { success: true };
  } catch (err) {
    console.error("[landing_pages] client error:", err);
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "상태를 변경하지 못했습니다.",
    };
  }
}

export type LandingPageImageField = "logo_url" | "main_image_url";

export interface UpdateLandingPageImageUrlResult {
  success: boolean;
  error?: string;
  slug?: string;
}

/**
 * logo_url 또는 main_image_url 컬럼만 갱신한다.
 * Storage 업로드/삭제 자체는 호출부(Server Action)에서 처리하고,
 * 이 함수는 DB에 public URL(또는 null)만 반영한다.
 */
export async function updateLandingPageImageUrl(
  id: string,
  field: LandingPageImageField,
  url: string | null
): Promise<UpdateLandingPageImageUrlResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("landing_pages")
      .update({ [field]: url })
      .eq("id", id)
      .select("slug")
      .single();

    if (error) {
      console.error("[landing_pages] update image url error:", error);
      return {
        success: false,
        error: "이미지 정보를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.",
      };
    }

    return { success: true, slug: data?.slug };
  } catch (err) {
    console.error("[landing_pages] client error:", err);
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "이미지 정보를 저장하지 못했습니다.",
    };
  }
}
