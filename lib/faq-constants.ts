/**
 * 서버(lib/faqs.ts)와 클라이언트(components/admin/FaqManager.tsx) 양쪽에서
 * 쓰는 상수. "server-only"를 import하는 lib/faqs.ts를 클라이언트 컴포넌트가
 * 직접 import하면 빌드가 깨지므로 이 값만 별도 파일로 분리한다.
 */
export const MAX_FAQS_PER_LANDING_PAGE = 20;
