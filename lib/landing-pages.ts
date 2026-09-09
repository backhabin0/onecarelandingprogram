import "server-only";

import { cache } from "react";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { removeLandingPageImageByUrl } from "@/lib/storage/landing-page-assets";
import type {
  CreateLandingPageInput,
  LandingPage,
  LandingPageStatus,
  UpdateLandingPageInput,
} from "@/types/landing-page";
import type { LandingPageFaq, LandingPageSeoSettings } from "@/types/seo";

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

interface GetPublicLandingPageIdBySlugResult {
  data: { id: string; business_name: string } | null;
  error: string | null;
}

/**
 * 상담 신청/Analytics 이벤트 기록처럼 landing_page_id(+ 상담 알림 이메일에
 * 필요한 business_name)만 있으면 되는 호출부 전용 경량 조회. SEO 설정/FAQ까지
 * 함께 가져오는 getPublicLandingPageBySlug보다 가벼워, 자주 호출되는 이 경로들에서
 * 불필요한 join을 피한다. business_name은 join 없이 같은 테이블의 컬럼만
 * 추가하는 것이라 기존 RLS/성능 특성에 영향이 없다.
 */
export async function getPublicLandingPageIdBySlug(
  slug: string
): Promise<GetPublicLandingPageIdBySlugResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("landing_pages")
      .select("id, business_name")
      .eq("slug", slug)
      .eq("status", "public")
      .maybeSingle();

    if (error) {
      console.error("[landing_pages] select public id by slug error:", error);
      return { data: null, error: "랜딩페이지를 불러오지 못했습니다." };
    }

    return { data: data ?? null, error: null };
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

export interface PublicLandingPageWithSeo {
  landingPage: LandingPage;
  seoSettings: LandingPageSeoSettings | null;
  /** is_active = true인 FAQ만(관리자 세션으로 조회되더라도 애플리케이션 레벨에서 다시 한번 필터링) */
  faqs: LandingPageFaq[];
}

interface GetPublicLandingPageBySlugResult {
  data: PublicLandingPageWithSeo | null;
  error: string | null;
}

const PUBLIC_LANDING_PAGE_WITH_SEO_SELECT =
  "*, seo_settings:landing_page_seo_settings(*), faqs:landing_page_faqs(*)";

/**
 * 고객용 공개 페이지(/[slug])에서 사용하는 조회 함수.
 *
 * landing_pages + SEO 설정(1:1) + FAQ(1:N)를 한 번의 쿼리로 함께 가져와
 * 페이지 렌더링 한 번에 DB를 여러 번 왕복하지 않게 한다.
 *
 * anon 대상 RLS(status = 'public', FAQ의 is_active = true)에도 의존하지만,
 * 그것만으로 끝내지 않고 애플리케이션 쿼리/후처리에도 동일한 조건을 명시한다
 * — 관리자 세션으로 이 함수가 호출되더라도(예: 프리뷰) private 페이지나
 * 비활성 FAQ가 노출되지 않게 하기 위함이다.
 */
export async function getPublicLandingPageBySlug(
  slug: string
): Promise<GetPublicLandingPageBySlugResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("landing_pages")
      .select(PUBLIC_LANDING_PAGE_WITH_SEO_SELECT)
      .eq("slug", slug)
      .eq("status", "public")
      // PUBLIC_LANDING_PAGE_WITH_SEO_SELECT에서 landing_page_faqs를 "faqs"로
      // alias했으므로, 정렬 대상 referencedTable도 원래 테이블명이 아니라
      // 이 alias를 그대로 써야 PostgREST가 인식한다.
      .order("sort_order", { referencedTable: "faqs", ascending: true })
      .maybeSingle();

    if (error) {
      console.error("[landing_pages] select public by slug error:", error);
      return { data: null, error: "랜딩페이지를 불러오지 못했습니다." };
    }

    if (!data) {
      return { data: null, error: null };
    }

    const {
      seo_settings: seoSettings,
      faqs,
      ...landingPage
    } = data as LandingPage & {
      seo_settings: LandingPageSeoSettings | null;
      faqs: LandingPageFaq[] | null;
    };

    return {
      data: {
        landingPage: landingPage as LandingPage,
        seoSettings: seoSettings ?? null,
        faqs: (faqs ?? []).filter((faq) => faq.is_active),
      },
      error: null,
    };
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

/**
 * app/[slug]/page.tsx의 generateMetadata와 페이지 컴포넌트가 같은 요청 안에서
 * 동일한 slug를 각각 조회하더라도 DB 조회가 중복 실행되지 않도록 React
 * cache로 감싼 버전. 두 곳 모두 이 함수를 사용해야 한다.
 */
export const getCachedPublicLandingPageBySlug = cache(getPublicLandingPageBySlug);

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

export interface SitemapLandingPageRow {
  slug: string;
  updated_at: string;
  created_at: string;
}

export interface GetPublicLandingPagesForSitemapResult {
  data: SitemapLandingPageRow[];
  error: string | null;
}

/**
 * app/sitemap.ts 전용 조회. status = 'public'이면서 seo_noindex가 true가
 * 아닌 페이지만 포함한다. anon 대상 RLS(status = 'public')에도 의존하지만
 * getPublicLandingPageBySlug와 동일한 이유로 애플리케이션 쿼리/후처리에도
 * 동일한 조건을 명시한다 — 관리자가 로그인한 채로 /sitemap.xml을 직접
 * 열어보는 경우에도 private/noindex 페이지가 sitemap에 노출되지 않게
 * 하기 위함이다. SEO 설정 row가 없는 페이지는 seo_noindex = false로 간주한다.
 */
export async function getPublicLandingPagesForSitemap(): Promise<GetPublicLandingPagesForSitemapResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("landing_pages")
      .select(
        "slug, updated_at, created_at, seo_settings:landing_page_seo_settings(seo_noindex)"
      )
      .eq("status", "public")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[landing_pages] select public for sitemap error:", error);
      return { data: [], error: "랜딩페이지 목록을 불러오지 못했습니다." };
    }

    const rows = (data ?? []) as unknown as Array<
      SitemapLandingPageRow & { seo_settings: { seo_noindex: boolean } | null }
    >;

    return {
      data: rows
        .filter((row) => row.seo_settings?.seo_noindex !== true)
        .map(({ slug, updated_at, created_at }) => ({
          slug,
          updated_at,
          created_at,
        })),
      error: null,
    };
  } catch (err) {
    console.error("[landing_pages] client error:", err);
    return { data: [], error: "랜딩페이지 목록을 불러오지 못했습니다." };
  }
}
