import { DAILY_GOAL, levelOf, quip } from "@/lib/dialer/legend";

// The playful "how much of a legend are you" bar: lifetime level + today's goal.
export default function LegendBar({ xp, callsToday, reachedToday, streak, compact = false }: {
  xp: number;
  callsToday: number;
  reachedToday: number;
  streak?: number;
  compact?: boolean;
}) {
  const lv = levelOf(xp);
  const goalPct = Math.min(100, (callsToday / DAILY_GOAL) * 100);

  return (
    <div className="rounded-2xl border border-base-300/50 bg-gradient-to-br from-base-200 to-base-200/40 p-3.5">
      <div className="flex items-center gap-3">
        <span className="text-2xl leading-none">{lv.cur.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-base-content truncate">{lv.cur.name}</span>
            <span className="text-[10px] text-base-content/40 shrink-0">{xp} XP{streak ? ` · 🔥 ${streak}d streak` : ""}</span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-base-300/60 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-success via-info to-primary transition-all duration-700" style={{ width: `${lv.pct}%` }} />
          </div>
          <p className="text-[10px] text-base-content/35 mt-1">
            {lv.next ? `${lv.toNext} XP to ${lv.next.emoji} ${lv.next.name}` : "Max level. You are the legend."}
          </p>
        </div>
      </div>

      {!compact && (
        <div className="mt-3 pt-3 border-t border-base-300/40">
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="text-base-content/60">Today&apos;s goal</span>
            <span className="text-base-content/40">{callsToday}/{DAILY_GOAL} calls{reachedToday > 0 && <> · <span className="text-success">{reachedToday} reached</span></>}</span>
          </div>
          <div className="h-1.5 rounded-full bg-base-300/60 overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-700 ${goalPct >= 100 ? "bg-warning" : "bg-success"}`} style={{ width: `${goalPct}%` }} />
          </div>
          <p className="text-[11px] text-base-content/50 mt-2 italic">{quip(callsToday, reachedToday)}</p>
        </div>
      )}
    </div>
  );
}
