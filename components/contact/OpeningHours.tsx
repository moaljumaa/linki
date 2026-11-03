import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RiCloseLine, RiAddLine } from "react-icons/ri";

interface Slot { day: number; open_time: string; close_time: string }

// Display order Mon..Sun; values are JS getDay() (0 = Sun)
const DAYS = [
  { v: 1, l: "Mon" }, { v: 2, l: "Tue" }, { v: 3, l: "Wed" }, { v: 4, l: "Thu" },
  { v: 5, l: "Fri" }, { v: 6, l: "Sat" }, { v: 0, l: "Sun" },
];
const WEEKDAYS = [1, 2, 3, 4, 5];

export default function OpeningHours({ targetId, initialTimezone }: { targetId: string; initialTimezone: string | null }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [tz, setTz] = useState(initialTimezone ?? "");
  const [days, setDays] = useState<number[]>(WEEKDAYS);
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("12:00");

  useEffect(() => {
    fetch(`/api/targets/${targetId}/hours`).then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setSlots(d.slots); }).catch(() => {});
  }, [targetId]);

  async function saveSlots(next: Slot[]) {
    const res = await fetch(`/api/targets/${targetId}/hours`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slots: next }),
    });
    if (!res.ok) { toast.error((await res.json()).error ?? "Failed to save"); return; }
    setSlots((await res.json()).slots);
  }

  async function saveTz() {
    const res = await fetch(`/api/targets/${targetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: tz }),
    });
    if (!res.ok) toast.error("Failed to save timezone");
  }

  function add() {
    if (days.length === 0 || from >= to) { toast.error("Pick days and a valid time range"); return; }
    const fresh = days.filter((d) => !slots.some((s) => s.day === d && s.open_time === from && s.close_time === to));
    saveSlots([...slots, ...fresh.map((d) => ({ day: d, open_time: from, close_time: to }))]);
  }

  // Group identical time ranges so "Mon–Fri 09:00–12:00" is one line
  const groups = [...new Set(slots.map((s) => `${s.open_time}-${s.close_time}`))].map((k) => {
    const [open_time, close_time] = k.split("-");
    return { open_time, close_time, days: DAYS.filter((d) => slots.some((s) => s.day === d.v && s.open_time === open_time && s.close_time === close_time)) };
  });

  return (
    <div className="bg-base-200 border border-base-300/50 rounded-xl p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] text-base-content/40 uppercase tracking-wide">Opening hours</p>
        <label className="flex items-center gap-1.5 text-[11px] text-base-content/40">
          Timezone
          <input
            list="tz-list"
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            onBlur={saveTz}
            placeholder="my own"
            className="w-36 px-2 py-0.5 rounded bg-base-300 border border-base-300/60 text-xs text-base-content/80 focus:outline-none focus:border-primary/40"
          />
          <datalist id="tz-list">
            {(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []).map((z) => <option key={z} value={z} />)}
          </datalist>
        </label>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-base-content/30 mb-3">No hours set — shows in the dialer at any time.</p>
      ) : (
        <div className="flex flex-col gap-1.5 mb-3">
          {groups.map((g) => (
            <div key={`${g.open_time}-${g.close_time}`} className="group flex items-center gap-2 text-sm">
              <span className="text-base-content/80 tabular-nums">{g.open_time}–{g.close_time}</span>
              <span className="text-base-content/40 text-xs">{g.days.map((d) => d.l).join(" ")}</span>
              <button
                title="Remove"
                onClick={() => saveSlots(slots.filter((s) => !(s.open_time === g.open_time && s.close_time === g.close_time)))}
                className="opacity-0 group-hover:opacity-100 text-base-content/30 hover:text-error/70 transition-all"
              ><RiCloseLine size={14} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1">
          {DAYS.map((d) => (
            <button
              key={d.v}
              onClick={() => setDays((p) => p.includes(d.v) ? p.filter((x) => x !== d.v) : [...p, d.v])}
              className={`w-8 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                days.includes(d.v) ? "bg-primary/10 text-primary border-primary/30" : "bg-base-300/50 text-base-content/40 border-transparent hover:text-base-content/70"
              }`}
            >{d.l.slice(0, 2)}</button>
          ))}
        </div>
        <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className="px-2 py-1 rounded-md bg-base-300 text-xs focus:outline-none" />
        <span className="text-base-content/30 text-xs">–</span>
        <input type="time" value={to} onChange={(e) => setTo(e.target.value)} className="px-2 py-1 rounded-md bg-base-300 text-xs focus:outline-none" />
        <button onClick={add} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
          <RiAddLine size={12} /> Add
        </button>
      </div>
    </div>
  );
}
