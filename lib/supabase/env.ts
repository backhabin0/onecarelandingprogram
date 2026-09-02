function assertEnvVar(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `환경변수 ${name}가 설정되지 않았습니다. 프로젝트 루트의 .env.local 파일에 ${name} 값을 입력해주세요.`
    );
  }
  return value;
}

export function getSupabaseUrl(): string {
  return assertEnvVar(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    "NEXT_PUBLIC_SUPABASE_URL"
  );
}

export function getSupabaseAnonKey(): string {
  return assertEnvVar(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  );
}
