/**
 * next/image 최적화를 쓸 수 있는 이미지인지: 이 프로젝트의 Supabase Storage 공개 경로만 허용한다
 * (next.config.ts의 images.remotePatterns와 같은 기준). 엑셀로 받은 임의의 외부 주소까지
 * 최적화 서버를 거치게 하면 남의 이미지를 대신 변환해 주는 통로가 될 수 있어 막는다.
 */
export const SUPABASE_PUBLIC_STORAGE_PATH = "/storage/v1/object/public/";

export function getSupabaseStorageHost(supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  if (!supabaseUrl) return null;
  try {
    return new URL(supabaseUrl).hostname;
  } catch {
    return null;
  }
}

export function isOptimizableImageUrl(src: string, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL): boolean {
  const host = getSupabaseStorageHost(supabaseUrl);
  if (!host) return false;
  try {
    const url = new URL(src);
    return url.protocol === "https:" && url.hostname === host && url.pathname.startsWith(SUPABASE_PUBLIC_STORAGE_PATH);
  } catch {
    return false;
  }
}
