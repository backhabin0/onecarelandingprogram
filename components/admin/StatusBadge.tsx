import type { LandingPageStatus } from "@/types/landing-page";

const STATUS_STYLES: Record<LandingPageStatus, string> = {
  public: "bg-green-100 text-green-700",
  private: "bg-slate-100 text-slate-600",
};

const STATUS_LABELS: Record<LandingPageStatus, string> = {
  public: "공개",
  private: "비공개",
};

interface StatusBadgeProps {
  status: LandingPageStatus;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
