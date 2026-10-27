import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseUrl } from "@/lib/supabase/env";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";
import { ilikeAnyFilter, sanitizeSearchTerm } from "@/lib/search-term";
import { LANDING_PAGE_ASSETS_BUCKET } from "@/lib/storage/landing-page-assets";
import {
  IMAGE_REFERENCE_COLUMNS,
  countImageReferences,
  describeImageReferences,
} from "@/lib/storage/asset-references";
import {
  MEDIA_MAX_BYTES,
  buildLibraryPaths,
  buildPublicStorageUrl,
  mediaBaseName,
  normalizeMediaName,
  numberedMediaName,
  sanitizeMediaDescription,
  sanitizeMediaName,
  type MediaAsset,
  type MediaKind,
  type MediaLibraryEntry,
  type MediaMime,
} from "@/lib/media/library";

/**
 * 사진 보관함(019 media_assets) 조회·등록·삭제. 파일은 브라우저가 Storage에 직접 올리고,
 * 여기서는 올라간 파일을 확인한 뒤 목록에 등록한다. 모든 함수는 requireUser()로 인증을
 * 확인한 Server Action·화면에서만 부른다.
 */

export const MEDIA_PAGE_SIZE = 60;

export interface ListMediaAssetsResult {
  data: MediaAsset[];
  count: number;
  error: string | null;
}

export async function listMediaAssets(filter: {
  search?: string;
  kind?: MediaKind | "all";
  page?: number;
  pageSize?: number;
}): Promise<ListMediaAssetsResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const pageSize = filter.pageSize ?? MEDIA_PAGE_SIZE;
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const from = (page - 1) * pageSize;
    const term = sanitizeSearchTerm(filter.search ?? "");

    const build = (head: boolean) => {
      let query = supabase.from("media_assets").select(head ? "id" : "*", { count: "exact", head });
      if (filter.kind && filter.kind !== "all") query = query.eq("kind", filter.kind);
      if (term) query = query.or(ilikeAnyFilter(["name", "description"], term));
      return query;
    };

    const { data, error, count } = await build(false)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      if (error.code === "PGRST103") {
        const { count: total, error: countError } = await build(true);
        if (!countError) return { data: [], count: total ?? 0, error: null };
      }
      console.error("[media] list error:", error.message);
      return { data: [], count: 0, error: "사진 보관함을 불러오지 못했습니다." };
    }
    return { data: (data as MediaAsset[]) ?? [], count: count ?? 0, error: null };
  } catch (err) {
    console.error("[media] client error:", err instanceof Error ? err.message : err);
    return { data: [], count: 0, error: "사진 보관함을 불러오지 못했습니다." };
  }
}

/** 보관함 전체 사용량(화면 표시용) */
export async function getMediaUsage(): Promise<{ count: number; bytes: number; error: string | null }> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await fetchAllRows<{ bytes: number; og_bytes: number }>((from, to) =>
      supabase.from("media_assets").select("bytes, og_bytes").order("id", { ascending: true }).range(from, to)
    );
    if (error) return { count: 0, bytes: 0, error: "사용량을 불러오지 못했습니다." };
    return { count: data.length, bytes: data.reduce((sum, row) => sum + row.bytes + row.og_bytes, 0), error: null };
  } catch {
    return { count: 0, bytes: 0, error: "사용량을 불러오지 못했습니다." };
  }
}

/**
 * 사진 칸에 들어 있는 주소별 사용 수(보관함 화면의 "사용 중" 표시용).
 * 칸이 몇 개 안 되므로 주소가 있는 행을 1,000행씩 끝까지 읽어 센다.
 */
export async function getUsedImageUrlCounts(): Promise<{ data: Map<string, number>; error: string | null }> {
  const counts = new Map<string, number>();
  try {
    const supabase = await getSupabaseServerClient();
    for (const ref of IMAGE_REFERENCE_COLUMNS) {
      const { data, error } = await fetchAllRows<Record<string, string | null>>((from, to) => {
        let query = supabase.from(ref.table).select(ref.column).not(ref.column, "is", null);
        if (ref.unpublishedOnly) query = query.neq("state", "published");
        return query.order(ref.key, { ascending: true }).range(from, to);
      });
      if (error) return { data: counts, error: "사진을 쓰는 곳을 확인하지 못했습니다." };
      for (const row of data) {
        const url = row[ref.column];
        if (url) counts.set(url, (counts.get(url) ?? 0) + 1);
      }
    }
    return { data: counts, error: null };
  } catch {
    return { data: counts, error: "사진을 쓰는 곳을 확인하지 못했습니다." };
  }
}

export async function getMediaAssetBySha(sha256: string): Promise<{ data: MediaAsset | null; error: string | null }> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.from("media_assets").select("*").eq("sha256", sha256).maybeSingle();
    if (error) {
      console.error("[media] select by sha error:", error.message);
      return { data: null, error: "사진 보관함을 확인하지 못했습니다." };
    }
    return { data: (data as MediaAsset | null) ?? null, error: null };
  } catch {
    return { data: null, error: "사진 보관함을 확인하지 못했습니다." };
  }
}

/**
 * 엑셀 사진 칸 검사용: 이름 후보(normalizeMediaName한 값)와 맞는 보관함 사진만 돌려준다.
 * 확장자 없이 쓴 이름도 찾을 수 있도록 확장자를 뺀 이름도 비교한다.
 */
export async function getMediaLibraryEntries(
  normalizedNames: readonly string[]
): Promise<{ data: MediaLibraryEntry[]; error: string | null }> {
  if (normalizedNames.length === 0) return { data: [], error: null };
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await fetchAllRows<MediaLibraryEntry>((from, to) =>
      supabase.from("media_assets").select("name, url, description").order("id", { ascending: true }).range(from, to)
    );
    if (error) {
      // 019 적용 전에도 주소(URL)로 쓴 사진 칸은 검사할 수 있도록 빈 보관함으로 본다.
      console.error("[media] library entries error:", error);
      return { data: [], error: "사진 보관함을 확인하지 못했습니다." };
    }
    const wanted = new Set(normalizedNames);
    return {
      data: data.filter(
        (entry) =>
          wanted.has(normalizeMediaName(entry.name)) || wanted.has(normalizeMediaName(mediaBaseName(entry.name)))
      ),
      error: null,
    };
  } catch {
    return { data: [], error: "사진 보관함을 확인하지 못했습니다." };
  }
}

/**
 * AI 프롬프트용 보관함 사진 목록(로고 빼고, 이름 순). 이름과 설명만 1,000행씩 끝까지 읽는다.
 */
export async function getLibraryPhotosForPrompt(): Promise<{
  data: { name: string; description: string }[];
  error: string | null;
}> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await fetchAllRows<{ name: string; description: string }>((from, to) =>
      supabase
        .from("media_assets")
        .select("name, description")
        .eq("kind", "photo")
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    );
    if (error) {
      console.error("[media] prompt photos error:", error);
      return { data: [], error: "사진 보관함 목록을 불러오지 못했습니다." };
    }
    return { data, error: null };
  } catch {
    return { data: [], error: "사진 보관함 목록을 불러오지 못했습니다." };
  }
}

/** 보관함 사진 설명 바꾸기(설명만 고친다) */
export async function updateMediaAssetDescription(
  id: string,
  description: string
): Promise<{ success: boolean; asset?: MediaAsset; error?: string }> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("media_assets")
      .update({ description: sanitizeMediaDescription(description) })
      .eq("id", id)
      .select("*");
    if (error) {
      console.error("[media] update description error:", error.message);
      return { success: false, error: "설명을 저장하지 못했습니다." };
    }
    const [asset] = (data as MediaAsset[] | null) ?? [];
    if (!asset) return { success: false, error: "사진을 찾을 수 없습니다. 목록을 새로고침해주세요." };
    return { success: true, asset };
  } catch {
    return { success: false, error: "설명을 저장하지 못했습니다." };
  }
}

export interface RegisterMediaAssetInput {
  sha256: string;
  kind: MediaKind;
  fileName: string;
  /** 올릴 때 적은 설명(선택) */
  description?: string;
  mime: MediaMime;
  width: number;
  height: number;
}

export interface RegisterMediaAssetResult {
  success: boolean;
  asset?: MediaAsset;
  /** 같은 사진이 이미 있어 새로 저장하지 않았으면 true */
  reused?: boolean;
  error?: string;
}

interface StoredObjectInfo {
  name: string;
  metadata?: { size?: number; mimetype?: string } | null;
}

/** 브라우저가 올린 두 파일(본 파일·OG)이 실제로 있는지, 크기가 상한 안인지 확인한다 */
async function findUploadedFiles(
  sha256: string,
  mime: MediaMime
): Promise<{ bytes: number; ogBytes: number } | { error: string }> {
  const supabase = await getSupabaseServerClient();
  const { path, ogPath } = buildLibraryPaths(sha256, mime);
  const { data, error } = await supabase.storage
    .from(LANDING_PAGE_ASSETS_BUCKET)
    .list("library", { search: sha256, limit: 10 });
  if (error) {
    console.error("[media] storage list error:", error.message);
    return { error: "올린 파일을 확인하지 못했습니다." };
  }
  const files = (data ?? []) as StoredObjectInfo[];
  const main = files.find((file) => `library/${file.name}` === path);
  const og = files.find((file) => `library/${file.name}` === ogPath);
  if (!main || !og) return { error: "올린 파일을 찾지 못했습니다. 다시 올려주세요." };
  const bytes = Number(main.metadata?.size ?? 0);
  const ogBytes = Number(og.metadata?.size ?? 0);
  if (!(bytes > 0 && bytes <= MEDIA_MAX_BYTES && ogBytes > 0 && ogBytes <= MEDIA_MAX_BYTES)) {
    return { error: "파일 크기가 2MB를 넘거나 비어 있습니다." };
  }
  return { bytes, ogBytes };
}

const NAME_ATTEMPTS = 50;

/** 같은 사진을 다시 올리면서 설명을 적었고 기존 설명이 비어 있으면 채운다(있는 설명은 덮어쓰지 않음) */
async function fillEmptyDescription(asset: MediaAsset, description: string): Promise<MediaAsset> {
  if (!description || asset.description) return asset;
  const updated = await updateMediaAssetDescription(asset.id, description);
  return updated.asset ?? asset;
}

/**
 * 올라간 파일을 보관함 목록에 등록한다. 주소·경로는 서버가 sha256으로 직접 만든다(브라우저가 보낸
 * 주소를 믿지 않음). 이름이 겹치면 "이름 (2).jpg"처럼 번호를 붙인다. 같은 사진(sha256)이 이미
 * 있으면 그 행을 그대로 돌려준다.
 */
export async function registerMediaAsset(input: RegisterMediaAssetInput): Promise<RegisterMediaAssetResult> {
  const description = sanitizeMediaDescription(input.description ?? "");
  const existing = await getMediaAssetBySha(input.sha256);
  if (existing.error) return { success: false, error: existing.error };
  if (existing.data) return { success: true, asset: await fillEmptyDescription(existing.data, description), reused: true };

  const uploaded = await findUploadedFiles(input.sha256, input.mime);
  if ("error" in uploaded) return { success: false, error: uploaded.error };

  try {
    const supabase = await getSupabaseServerClient();
    const supabaseUrl = getSupabaseUrl();
    const { path, ogPath } = buildLibraryPaths(input.sha256, input.mime);
    const baseName = sanitizeMediaName(input.fileName);

    for (let n = 1; n <= NAME_ATTEMPTS; n += 1) {
      const { data, error } = await supabase
        .from("media_assets")
        .insert({
          sha256: input.sha256,
          kind: input.kind,
          name: numberedMediaName(baseName, n),
          description,
          storage_path: path,
          url: buildPublicStorageUrl(supabaseUrl, path),
          og_storage_path: ogPath,
          og_url: buildPublicStorageUrl(supabaseUrl, ogPath),
          mime: input.mime,
          width: input.width,
          height: input.height,
          bytes: uploaded.bytes,
          og_bytes: uploaded.ogBytes,
        })
        .select("*")
        .single();

      if (!error) return { success: true, asset: data as MediaAsset };
      if (error.code !== "23505") {
        console.error("[media] insert error:", error.message);
        return { success: false, error: "사진 보관함에 등록하지 못했습니다." };
      }
      // 같은 사진을 그 사이 다른 창에서 등록했으면 그 행을 쓴다. 아니면 이름이 겹친 것 → 다음 번호.
      const again = await getMediaAssetBySha(input.sha256);
      if (again.data) return { success: true, asset: await fillEmptyDescription(again.data, description), reused: true };
    }
    return { success: false, error: "같은 이름의 사진이 너무 많습니다. 파일 이름을 바꿔 올려주세요." };
  } catch (err) {
    console.error("[media] register client error:", err instanceof Error ? err.message : err);
    return { success: false, error: "사진 보관함에 등록하지 못했습니다." };
  }
}

export interface DeleteMediaAssetResult {
  success: boolean;
  error?: string;
}

/**
 * 보관함 사진을 지운다. 페이지·대기열·SEO·대표 업체 중 한 곳이라도 쓰고 있으면(본 파일 또는 OG 파일
 * 주소) 지우지 않는다. 쓰는 곳 확인이 실패해도 지우지 않는다. 목록 행을 먼저 지우고 파일을 지운다
 * (파일 삭제가 실패해도 깨진 목록이 남지 않음 — 남은 파일은 로그로만 알린다).
 */
export async function deleteMediaAsset(id: string): Promise<DeleteMediaAssetResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.from("media_assets").select("*").eq("id", id).maybeSingle();
    if (error) {
      console.error("[media] select for delete error:", error.message);
      return { success: false, error: "사진을 지우지 못했습니다." };
    }
    const asset = data as MediaAsset | null;
    if (!asset) return { success: false, error: "사진을 찾을 수 없습니다. 목록을 새로고침해주세요." };

    const references = await countImageReferences(supabase, [asset.url, asset.og_url]);
    if (references.error) return { success: false, error: `${references.error} 지우지 않았습니다.` };
    if (references.total > 0) {
      return {
        success: false,
        error: `쓰고 있는 사진이라 지울 수 없습니다(${describeImageReferences(references.places)}). 먼저 그 칸에서 다른 사진으로 바꿔주세요.`,
      };
    }

    const { error: deleteError } = await supabase.from("media_assets").delete().eq("id", id);
    if (deleteError) {
      console.error("[media] delete row error:", deleteError.message);
      return { success: false, error: "사진을 지우지 못했습니다." };
    }

    const { error: removeError } = await supabase.storage
      .from(LANDING_PAGE_ASSETS_BUCKET)
      .remove([asset.storage_path, asset.og_storage_path]);
    if (removeError) console.error("[media] storage remove error (orphan files left):", removeError.message);

    return { success: true };
  } catch (err) {
    console.error("[media] delete client error:", err instanceof Error ? err.message : err);
    return { success: false, error: "사진을 지우지 못했습니다." };
  }
}
