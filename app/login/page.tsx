import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import LoginForm from "@/components/auth/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/admin");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <p className="text-lg font-semibold text-slate-900">OneCare Admin</p>
          <p className="mt-1 text-sm text-slate-500">관리자 로그인</p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
