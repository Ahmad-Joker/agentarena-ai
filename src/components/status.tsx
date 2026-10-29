import { CheckCircle2, CircleDashed, Clock, Loader2, Ban, XCircle, TimerOff } from "lucide-react";
import { Badge } from "@/components/ui/primitives";

const RUN_STATUS: Record<string, { tone: "neutral" | "blue" | "success" | "danger" | "warning" | "violet"; label: string; icon: React.ReactNode }> = {
  PENDING: { tone: "neutral", label: "Pending", icon: <Clock className="size-3" /> },
  RUNNING: { tone: "blue", label: "Running", icon: <Loader2 className="size-3 animate-spin" /> },
  COMPLETED: { tone: "success", label: "Completed", icon: <CheckCircle2 className="size-3" /> },
  FAILED: { tone: "danger", label: "Failed", icon: <XCircle className="size-3" /> },
  CANCELLED: { tone: "warning", label: "Cancelled", icon: <Ban className="size-3" /> },
  TIMED_OUT: { tone: "warning", label: "Timed out", icon: <TimerOff className="size-3" /> },
};

export function StatusBadge({ status }: { status: string }) {
  const s = RUN_STATUS[status] ?? { tone: "neutral" as const, label: status, icon: <CircleDashed className="size-3" /> };
  return (
    <Badge tone={s.tone} aria-label={`Status: ${s.label}`}>
      {s.icon}
      {s.label}
    </Badge>
  );
}

export function SimulatedTag({ className }: { className?: string }) {
  return (
    <Badge tone="warning" className={className} title="Produced by deterministic simulated agents — not a live benchmark">
      SIMULATED
    </Badge>
  );
}

export function CostSourceTag({ source }: { source: string }) {
  if (source === "PROVIDER_REPORTED") return <Badge tone="success" title="spend_usd reported by HarnessRouter">provider-reported</Badge>;
  if (source === "SIMULATED") return <Badge tone="warning" title="Synthetic demo figure">simulated</Badge>;
  return <Badge tone="neutral" title="The provider did not report cost">not reported</Badge>;
}
