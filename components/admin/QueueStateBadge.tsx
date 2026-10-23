import { QUEUE_STATE_LABELS, QUEUE_STATE_STYLES } from "@/lib/publish-queue-labels";
import type { LandingPageQueueState } from "@/types/publish-queue";

export default function QueueStateBadge({ state }: { state: LandingPageQueueState }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${QUEUE_STATE_STYLES[state]}`}
    >
      {QUEUE_STATE_LABELS[state]}
    </span>
  );
}
