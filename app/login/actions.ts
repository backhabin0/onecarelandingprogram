"use server";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export interface SignInResult {
  success: boolean;
  error?: string;
}

export async function signInAction(
  email: string,
  password: string
): Promise<SignInResult> {
  const trimmedEmail = email.trim();

  if (!trimmedEmail || !password) {
    return { success: false, error: "이메일과 비밀번호를 입력해주세요." };
  }

  try {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    if (error) {
      console.error("[auth] signInWithPassword error:", error);
      return {
        success: false,
        error: "이메일 또는 비밀번호가 올바르지 않습니다.",
      };
    }

    return { success: true };
  } catch (err) {
    console.error("[auth] signIn client error:", err);
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "로그인 중 알 수 없는 오류가 발생했습니다.",
    };
  }
}
