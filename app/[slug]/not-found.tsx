export default function PublicLandingPageNotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-white px-5 text-center">
      <p className="text-lg font-semibold text-slate-900">
        존재하지 않는 페이지입니다.
      </p>
      <p className="text-sm text-slate-500">
        주소를 다시 확인해 주세요.
      </p>
    </div>
  );
}
