import type { Slot } from "@/lib/dialer/availability";

export interface DialerRow {
  id: string;
  full_name: string | null;
  salutation?: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  company: string | null;
  phone: string;
  timezone: string | null;
  call_status: string | null;
  call_attempts: number;
  last_called_at: string | null;
  call_callback_at: string | null;
  slots: Slot[];
}

export const OUTCOMES = [
  { key: "reached", label: "Reached", emoji: "🎉", cls: "bg-success/10 text-success border-success/25 hover:bg-success/20" },
  { key: "no_answer", label: "No answer", emoji: "📵", cls: "bg-warning/10 text-warning border-warning/25 hover:bg-warning/20" },
  { key: "voicemail", label: "Voicemail", emoji: "📼", cls: "bg-info/10 text-info border-info/25 hover:bg-info/20" },
  { key: "callback", label: "Call back", emoji: "⏰", cls: "bg-primary/10 text-primary border-primary/25 hover:bg-primary/20" },
  { key: "not_interested", label: "Not interested", emoji: "🙅", cls: "bg-base-300/60 text-base-content/60 border-base-300 hover:bg-base-300" },
  { key: "wrong_number", label: "Wrong number", emoji: "🔀", cls: "bg-error/10 text-error border-error/25 hover:bg-error/20" },
] as const;

export const OUTCOME_LABEL: Record<string, string> = Object.fromEntries(OUTCOMES.map((o) => [o.key, o.label]));

export function contactName(r: Pick<DialerRow, "full_name" | "first_name" | "last_name">) {
  return r.full_name || [r.first_name, r.last_name].filter(Boolean).join(" ") || "Unknown";
}

export function clock(sec: number) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// 3725 → "1h 2m", 134 → "2m 14s"
export function humanSec(sec: number) {
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `${h}h ${m}m`;
  return s ? `${m}m ${s}s` : `${m}m`;
}
