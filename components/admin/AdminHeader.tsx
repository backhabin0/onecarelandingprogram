interface AdminHeaderProps {
  email: string | null;
}

export default function AdminHeader({ email }: AdminHeaderProps) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
      <span className="text-sm text-slate-500">랜딩페이지 자동 생성 및 배포 관리자</span>
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-medium text-slate-600">
          관리
        </div>
        <span className="text-sm font-medium text-slate-700">
          {email ?? "관리자"}
        </span>
      </div>
    </header>
  );
}
