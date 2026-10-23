import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * docs/samples/ 예시 파일 생성용(`npm run samples`). 테스트가 아니라 앱 코드(양식·프롬프트 생성
 * 함수)를 그대로 써서 파일을 만들기 위해 vitest의 경로 별칭(@/)만 빌려 쓴다.
 */
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: root }],
  },
  test: {
    environment: "node",
    include: ["scripts/generate-samples.ts"],
  },
});
