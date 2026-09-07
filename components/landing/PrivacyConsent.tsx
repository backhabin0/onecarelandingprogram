interface PrivacyConsentProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  variant?: "light" | "dark";
}

export default function PrivacyConsent({
  id,
  checked,
  onChange,
  variant = "light",
}: PrivacyConsentProps) {
  const textClassName =
    variant === "dark" ? "text-slate-200" : "text-slate-700";
  const hintClassName = variant === "dark" ? "text-slate-400" : "text-slate-500";

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex items-start gap-2">
        <input
          id={id}
          type="checkbox"
          required
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-slate-300"
        />
        <span className={`text-sm ${textClassName}`}>
          개인정보 수집 및 이용에 동의합니다.
        </span>
      </label>
      <p className={`pl-7 text-xs ${hintClassName}`}>
        상담을 위해 이름, 연락처, 문의내용을 수집하며, 수집된 정보는 상담
        목적으로만 사용됩니다.
      </p>
    </div>
  );
}
