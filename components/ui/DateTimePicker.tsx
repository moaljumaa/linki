import { useMemo, useState } from "react";
import { RiArrowLeftSLine, RiArrowRightSLine, RiCalendarLine, RiCloseLine } from "react-icons/ri";

// Date + time in one control. `value` is a local "YYYY-MM-DDTHH:mm" string ("" = unset).
// Expands in-flow (no popover) so it never clips inside overflow-hidden modals.

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function toLocalValue(d: Date) {
  return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalValue(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function fmt(v: string) {
  const d = fromLocalValue(v);
  if (!d) return "";
  return d.toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function inHours(h: number) {
  const d = new Date();
  d.setHours(d.getHours() + h, d.getMinutes() < 30 ? 0 : 30, 0, 0);
  return d;
}
function tomorrow9() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}
function nextMonday9() {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  d.setHours(9, 0, 0, 0);
  return d;
}

const PRESETS: { label: string; get: () => Date }[] = [
  { label: "In 1 hour", get: () => inHours(1) },
  { label: "In 3 hours", get: () => inHours(3) },
  { label: "Tomorrow 9:00", get: tomorrow9 },
  { label: "Next Monday 9:00", get: nextMonday9 },
];

export default function DateTimePicker({ value, onChange, placeholder = "Pick date & time", defaultOpen = false, clearable = true }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  defaultOpen?: boolean;
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const sel = fromLocalValue(value);
  const [view, setView] = useState(() => { const d = sel ?? new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });

  const days = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // Monday-first
    const weeks = Math.ceil((offset + new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate()) / 7);
    return Array.from({ length: weeks * 7 }, (_, i) => new Date(view.getFullYear(), view.getMonth(), 1 - offset + i));
  }, [view]);

  const todayStr = ymd(new Date());
  const hh = sel ? sel.getHours() : 9;
  const mm = sel ? sel.getMinutes() : 0;

  function setDay(d: Date) {
    onChange(toLocalValue(new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm)));
  }
  function setTime(h: number, m: number) {
    const base = sel ?? new Date();
    onChange(toLocalValue(new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m)));
  }
  function pickPreset(d: Date) {
    onChange(toLocalValue(d));
    setView(new Date(d.getFullYear(), d.getMonth(), 1));
  }

  const selCls = "bg-base-200 border border-base-300/40 rounded-lg pl-3 pr-8 py-1.5 text-sm text-base-content/80 focus:outline-none focus:border-base-300/80";

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-xl border text-sm text-left transition-colors ${open ? "border-primary/40 bg-primary/5" : "border-base-300/40 bg-base-200/60 hover:border-base-300/80"}`}
        >
          <RiCalendarLine size={14} className="text-base-content/40 shrink-0" />
          <span className={value ? "text-base-content/90" : "text-base-content/30"}>{value ? fmt(value) : placeholder}</span>
        </button>
        {clearable && value && (
          <button type="button" onClick={() => onChange("")} title="Clear" className="w-8 h-8 flex items-center justify-center rounded-lg text-base-content/40 hover:text-base-content hover:bg-base-300/50 transition-colors">
            <RiCloseLine size={14} />
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2 p-3 rounded-xl border border-base-300/50 bg-base-200/50 flex flex-col gap-2.5">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button key={p.label} type="button" onClick={() => pickPreset(p.get())} className="px-2.5 py-1 rounded-lg text-[11px] bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors">
                {p.label}
              </button>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-base-content/80">{MONTHS[view.getMonth()]} {view.getFullYear()}</span>
              <div className="flex gap-0.5">
                <button type="button" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))} className="w-7 h-7 flex items-center justify-center rounded-md text-base-content/50 hover:bg-base-300/50"><RiArrowLeftSLine size={16} /></button>
                <button type="button" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))} className="w-7 h-7 flex items-center justify-center rounded-md text-base-content/50 hover:bg-base-300/50"><RiArrowRightSLine size={16} /></button>
              </div>
            </div>
            <div className="grid grid-cols-7 text-center text-[11px] text-base-content/30 mb-1">
              {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => <span key={d}>{d}</span>)}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {days.map((d) => {
                const inMonth = d.getMonth() === view.getMonth();
                const isSel = !!sel && ymd(d) === ymd(sel);
                const isToday = ymd(d) === todayStr;
                return (
                  <button
                    key={d.toISOString()}
                    type="button"
                    onClick={() => setDay(d)}
                    className={`h-7 rounded-lg text-sm transition-colors ${
                      isSel ? "bg-primary text-primary-content font-semibold"
                        : isToday ? "ring-1 ring-primary/50 text-base-content hover:bg-base-300/60"
                        : inMonth ? "text-base-content/75 hover:bg-base-300/60" : "text-base-content/20 hover:bg-base-300/40"
                    }`}
                  >{d.getDate()}</button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2.5 border-t border-base-300/40">
            <span className="text-xs font-medium text-base-content/60 mr-1">Time</span>
            <select value={hh} onChange={(e) => setTime(Number(e.target.value), mm)} className={selCls}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{pad(h)}</option>)}
            </select>
            <span className="text-base-content/30">:</span>
            <select value={mm - (mm % 5)} onChange={(e) => setTime(hh, Number(e.target.value))} className={selCls}>
              {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => <option key={m} value={m}>{pad(m)}</option>)}
            </select>
            <button type="button" onClick={() => setOpen(false)} className="ml-auto px-4 py-1.5 rounded-lg text-xs font-medium bg-primary/90 text-primary-content hover:bg-primary transition-colors">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
