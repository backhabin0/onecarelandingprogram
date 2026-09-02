"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signInAction } from "@/app/login/actions";

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    setErrorMessage(null);
    setIsSubmitting(true);

    const result = await signInAction(email, password);

    if (!result.success) {
      setErrorMessage(result.error ?? "로그인 중 오류가 발생했습니다.");
      setIsSubmitting(false);
      return;
    }

    router.push("/admin");
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {errorMessage ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-slate-700">
          이메일
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          className={inputClassName}
          placeholder="admin@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="password"
          className="text-sm font-medium text-slate-700"
        >
          비밀번호
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          className={inputClassName}
          placeholder="********"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className={`mt-2 rounded-md px-4 py-2.5 text-sm font-medium text-white ${
          isSubmitting
            ? "cursor-not-allowed bg-blue-400"
            : "bg-blue-600 hover:bg-blue-700"
        }`}
      >
        {isSubmitting ? "로그인 중..." : "로그인"}
      </button>
    </form>
  );
}
