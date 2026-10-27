import { MEDIA_MAX_BYTES, type MediaKind, type MediaMime } from "@/lib/media/library";

/**
 * 업로드 전 브라우저에서 사진을 줄인다(새 라이브러리 없이 createImageBitmap + canvas).
 * - 사진: 긴 변 1600px, WebP 품질 0.8
 * - 로고: 긴 변 512px, WebP(투명 배경 유지)
 * - og:image: 1200×630 JPEG(가운데를 채워 자름, 투명 부분은 흰색)
 * 다시 그려 저장하므로 휴대폰 사진의 위치(GPS) 등 메타데이터도 빠진다.
 * WebP를 못 만드는 브라우저면 사진은 JPEG, 로고는 PNG로 저장한다.
 *
 * 아래 순수 함수(크기 계산·형식 판별)는 테스트에서 바로 쓰고, compressForLibrary는 브라우저에서만 부른다.
 */

export const MEDIA_PRESETS: Record<MediaKind, { maxSide: number; quality: number; fallbackMime: MediaMime }> = {
  photo: { maxSide: 1600, quality: 0.8, fallbackMime: "image/jpeg" },
  logo: { maxSide: 512, quality: 0.9, fallbackMime: "image/png" },
};

export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;
const OG_QUALITY = 0.82;

/** 브라우저가 읽을 수 있는 원본 형식 */
export const ACCEPTED_SOURCE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/** 원본 파일 상한(압축 전). 이보다 크면 브라우저 메모리 문제로 거절한다 */
export const MAX_SOURCE_BYTES = 30 * 1024 * 1024;

export const HEIC_MESSAGE =
  "아이폰 HEIC 사진은 올릴 수 없습니다. 아이폰 설정 > 카메라 > 포맷에서 '높은 호환성'을 고르거나, JPG로 바꿔서 올려주세요.";

/** HEIC/HEIF(아이폰 기본 형식)인지: 형식 값이 비어 있는 경우가 많아 확장자도 본다 */
export function isHeicFile(file: { name: string; type: string }): boolean {
  return /^image\/hei[cf](-sequence)?$/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

/** 원본 파일 검사. 문제가 있으면 안내 문구 */
export function checkSourceFile(file: { name: string; type: string; size: number }): string | null {
  if (isHeicFile(file)) return HEIC_MESSAGE;
  if (!(ACCEPTED_SOURCE_TYPES as readonly string[]).includes(file.type)) {
    return "JPG, PNG, WEBP 사진만 올릴 수 있습니다.";
  }
  if (file.size > MAX_SOURCE_BYTES) return "30MB보다 큰 사진은 올릴 수 없습니다.";
  return null;
}

/** 긴 변이 maxSide를 넘으면 비율을 지켜 줄인 크기(키우지는 않음) */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const scale = maxSide / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** 대상 비율을 가득 채우도록 가운데를 자르는 원본 영역(object-fit: cover) */
export function coverCrop(
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number
): { sx: number; sy: number; sw: number; sh: number } {
  const targetRatio = targetWidth / targetHeight;
  if (width / height > targetRatio) {
    const sw = Math.round(height * targetRatio);
    return { sx: Math.round((width - sw) / 2), sy: 0, sw, sh: height };
  }
  const sh = Math.round(width / targetRatio);
  return { sx: 0, sy: Math.round((height - sh) / 2), sw: width, sh };
}

/** ArrayBuffer의 sha256(소문자 16진수) */
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface CompressedMedia {
  sha256: string;
  kind: MediaKind;
  file: Blob;
  mime: MediaMime;
  width: number;
  height: number;
  og: Blob;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function drawCanvas(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.imageSmoothingQuality = "high";
  draw(ctx);
  return canvas;
}

/** 2MB 안에 들어올 때까지 품질을 낮춰 본다. WebP가 안 되면 대체 형식 */
async function encodeWithinLimit(
  canvas: HTMLCanvasElement,
  preferred: MediaMime,
  fallback: MediaMime,
  quality: number
): Promise<{ blob: Blob; mime: MediaMime } | null> {
  for (const mime of preferred === fallback ? [preferred] : [preferred, fallback]) {
    for (const q of [quality, 0.7, 0.6, 0.5]) {
      const blob = await canvasToBlob(canvas, mime, q);
      // WebP를 못 만드는 브라우저는 PNG로 돌려준다 → 대체 형식으로 넘어간다.
      if (!blob || blob.type !== mime) break;
      if (blob.size <= MEDIA_MAX_BYTES) return { blob, mime };
      if (mime === "image/png") break; // PNG는 품질 값이 없다.
    }
  }
  return null;
}

/**
 * 보관함에 올릴 파일 두 개(본 파일 + og:image JPEG)를 만든다. 실패하면 안내 문구를 던진다.
 * 브라우저 전용.
 */
export async function compressForLibrary(file: File, kind: MediaKind): Promise<CompressedMedia> {
  const problem = checkSourceFile(file);
  if (problem) throw new Error(problem);

  const original = await file.arrayBuffer();
  const sha256 = await sha256Hex(original);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("사진을 읽지 못했습니다. 다른 파일로 시도해주세요.");
  }

  try {
    const preset = MEDIA_PRESETS[kind];
    const size = fitWithin(bitmap.width, bitmap.height, preset.maxSide);
    const main = drawCanvas(size.width, size.height, (ctx) => ctx.drawImage(bitmap, 0, 0, size.width, size.height));
    const encoded = await encodeWithinLimit(main, "image/webp", preset.fallbackMime, preset.quality);
    if (!encoded) throw new Error("사진을 2MB 이하로 줄이지 못했습니다. 더 작은 사진으로 시도해주세요.");

    const crop = coverCrop(bitmap.width, bitmap.height, OG_IMAGE_SIZE.width, OG_IMAGE_SIZE.height);
    const ogCanvas = drawCanvas(OG_IMAGE_SIZE.width, OG_IMAGE_SIZE.height, (ctx) => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, OG_IMAGE_SIZE.width, OG_IMAGE_SIZE.height);
      if (kind === "logo") {
        // 로고는 자르지 않고 가운데에 작게 둔다.
        const fit = fitWithin(bitmap.width, bitmap.height, 480);
        ctx.drawImage(
          bitmap,
          (OG_IMAGE_SIZE.width - fit.width) / 2,
          (OG_IMAGE_SIZE.height - fit.height) / 2,
          fit.width,
          fit.height
        );
      } else {
        ctx.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, OG_IMAGE_SIZE.width, OG_IMAGE_SIZE.height);
      }
    });
    const og = await encodeWithinLimit(ogCanvas, "image/jpeg", "image/jpeg", OG_QUALITY);
    if (!og) throw new Error("공유용 사진(og:image)을 만들지 못했습니다.");

    return { sha256, kind, file: encoded.blob, mime: encoded.mime, width: size.width, height: size.height, og: og.blob };
  } finally {
    bitmap.close();
  }
}

/**
 * og:image 전용 업로드(SEO 설정의 OG 이미지 칸): 1200×630 JPEG로 바꾼 File. 브라우저 전용.
 */
export async function compressOgImage(file: File): Promise<File> {
  const problem = checkSourceFile(file);
  if (problem) throw new Error(problem);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("사진을 읽지 못했습니다. 다른 파일로 시도해주세요.");
  }
  try {
    const crop = coverCrop(bitmap.width, bitmap.height, OG_IMAGE_SIZE.width, OG_IMAGE_SIZE.height);
    const canvas = drawCanvas(OG_IMAGE_SIZE.width, OG_IMAGE_SIZE.height, (ctx) => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, OG_IMAGE_SIZE.width, OG_IMAGE_SIZE.height);
      ctx.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, OG_IMAGE_SIZE.width, OG_IMAGE_SIZE.height);
    });
    const encoded = await encodeWithinLimit(canvas, "image/jpeg", "image/jpeg", OG_QUALITY);
    if (!encoded) throw new Error("사진을 2MB 이하로 줄이지 못했습니다.");
    return new File([encoded.blob], "og.jpg", { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}
