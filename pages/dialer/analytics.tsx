import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import LegendBar from "@/components/dialer/LegendBar";
import { xpOf } from "@/lib/dialer/legend";
import { OUTCOMES, humanSec } from "@/lib/dialer/shared";

interface Session { id: string; started_at: string; outcome: string; duration_sec: number | null; script_id: string | null; script_name: string | null }
type Range = "day" | "week" | "month";

const RANGES: { key: Range; label: string; days: number }[] = [
  { key: "day", label: "Today", days: 1 },
  { key: "week", label: "Week", days: 7 },
  { key: "month", label: "Month", days: 30 },
];

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function summarize(s: Session[]) {
  const calls = s.length;
  const reached = s.filter((x) => x.outcome === "reached").length;
  const talk = s.reduce((a, x) => a + (x.duration_sec ?? 0), 0);
  const timed = s.filter((x) => x.duration_sec != null).length;
  return { calls, reached, talk, rate: calls ? Math.round((reached / calls) * 100) : 0, avg: timed ? Math.round(talk / timed) : 0, longest: Math.max(0, ...s.map((x) => x.duration_sec ?? 0)) };
}

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev && !cur) return null;
  if (!prev) return <span className="text-[10px] text-success">new</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return <span className="text-[10px] text-base-content/30">same as before</span>;
  return <span className={`text-[10px] ${pct > 0 ? "text-success" : "text-error/80"}`}>{pct > 0 ? "▲" : "▼"} {Math.abs(pct)}% vs prev</span>;
}

function Card({ label, value, sub, delta }: { label: string; value: string | number; sub?: string; delta?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-base-300/50 bg-base-200/60 px-4 py-3.5">
      <p className="text-[11px] text-base-content/40 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-semibold text-base-content mt-1 tabular-nums">{value}</p>
      <div className="mt-0.5 min-h-4">{delta ?? (sub && <span className="text-[10px] text-base-content/30">{sub}</span>)}</div>
    </div>
  );
}

export default function DialerAnalyticsPage() {
  const [range, setRange] = useState<Range>("day");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [lifetime, setLifetime] = useState({ calls: 0, reached: 0, talk_sec: 0 });
  const [streak, setStreak] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Two periods back so we can show "vs previous"
    const days = RANGES.find((r) => r.key === range)!.days;
    const since = addDays(startOfDay(new Date()), -(days * 2 - 1));
    setLoading(true);
    fetch(`/api/dialer/analytics?since=${encodeURIComponent(since.toISOString())}&tz_offset=${new Date().getTimezoneOffset()}`)
      .then((r) => r.json())
      .then((d) => { setSessions(d.sessions ?? []); setLifetime(d.lifetime); setStreak(d.streak); })
      .finally(() => setLoading(false));
  }, [range]);

  const days = RANGES.find((r) => r.key === range)!.days;
  const curStart = addDays(startOfDay(new Date()), -(days - 1));
  const { cur, prev } = useMemo(() => {
    const c: Session[] = [], p: Session[] = [];
    for (const s of sessions) (new Date(s.started_at) >= curStart ? c : p).push(s);
    return { cur: c, prev: p };
  }, [sessions]); // eslint-disable-line react-hooks/exhaustive-deps

  const sum = summarize(cur), psum = summarize(prev);

  // Bars: per hour (today) or per day
  const bars = useMemo(() => {
    if (range === "day") {
      const b = Array.from({ length: 24 }, (_, h) => ({ label: String(h), calls: 0, reached: 0 }));
      for (const s of cur) { const h = new Date(s.started_at).getHours(); b[h].calls++; if (s.outcome === "reached") b[h].reached++; }
      const first = Math.max(0, (b.findIndex((x) => x.calls) === -1 ? 8 : b.findIndex((x) => x.calls)) - 1);
      return b.slice(Math.min(first, 8), 21);
    }
    const b = Array.from({ length: days }, (_, i) => {
      const d = addDays(curStart, i);
      return { label: range === "week" ? d.toLocaleDateString([], { weekday: "short" }) : String(d.getDate()), key: d.toDateString(), calls: 0, reached: 0 };
    });
    for (const s of cur) {
      const x = b.find((y) => y.key === new Date(s.started_at).toDateString());
      if (x) { x.calls++; if (s.outcome === "reached") x.reached++; }
    }
    return b;
  }, [cur, range]); // eslint-disable-line react-hooks/exhaustive-deps
  const maxCalls = Math.max(1, ...bars.map((b) => b.calls));

  const outcomes = OUTCOMES.map((o) => ({ ...o, n: cur.filter((s) => s.outcome === o.key).length }));
  const maxOut = Math.max(1, ...outcomes.map((o) => o.n));

  const scripts = useMemo(() => {
    const m = new Map<string, { name: string; calls: number; reached: number }>();
    for (const s of cur) {
      const k = s.script_name ?? "No script";
      const x = m.get(k) ?? { name: k, calls: 0, reached: 0 };
      x.calls++; if (s.outcome === "reached") x.reached++;
      m.set(k, x);
    }
    return [...m.values()].sort((a, b) => b.calls - a.calls);
  }, [cur]);

  const todayS = sessions.filter((s) => new Date(s.started_at) >= startOfDay(new Date()));
  const xp = xpOf(lifetime.calls, lifetime.reached, lifetime.talk_sec);

  return (
    <>
      <Head><title>Dialer analytics — Linki</title></Head>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="text-lg font-semibold text-base-content tracking-tight">Dialer analytics</h1>
            <p className="text-xs text-base-content/40 mt-1">How the grind is going</p>
          </div>
          <div className="flex bg-base-200 border border-base-300/40 rounded-xl p-1">
            {RANGES.map((r) => (
              <button key={r.key} onClick={() => setRange(r.key)} className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${range === r.key ? "bg-base-300 text-base-content shadow-sm" : "text-base-content/40 hover:text-base-content/70"}`}>{r.label}</button>
            ))}
          </div>
        </div>

        <div className="mb-5">
          <LegendBar xp={xp} callsToday={todayS.length} reachedToday={todayS.filter((s) => s.outcome === "reached").length} streak={streak} />
        </div>

        <div className={`grid grid-cols-2 md:grid-cols-4 gap-3 mb-5 transition-opacity ${loading ? "opacity-50" : ""}`}>
          <Card label="Calls" value={sum.calls} delta={<Delta cur={sum.calls} prev={psum.calls} />} />
          <Card label="Reached" value={sum.reached} delta={<Delta cur={sum.reached} prev={psum.reached} />} />
          <Card label="Connect rate" value={`${sum.rate}%`} sub={`${psum.rate}% previous`} />
          <Card label="Talk time" value={humanSec(sum.talk)} delta={<Delta cur={sum.talk} prev={psum.talk} />} />
          <Card label="Avg call" value={sum.avg ? humanSec(sum.avg) : "—"} sub="timed calls only" />
          <Card label="Longest call" value={sum.longest ? humanSec(sum.longest) : "—"} />
          <Card label="Voicemails" value={cur.filter((s) => s.outcome === "voicemail").length} />
          <Card label="Callbacks set" value={cur.filter((s) => s.outcome === "callback").length} />
        </div>

        <div className="grid md:grid-cols-3 gap-3">
          <div className="md:col-span-2 rounded-2xl border border-base-300/50 bg-base-200/60 p-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[11px] text-base-content/40 uppercase tracking-wide">{range === "day" ? "Calls by hour" : "Calls by day"}</p>
              <span className="flex items-center gap-3 text-[10px] text-base-content/40">
                <span className="inline-flex items-center gap-1"><i className="w-2 h-2 rounded-sm bg-primary/60" />calls</span>
                <span className="inline-flex items-center gap-1"><i className="w-2 h-2 rounded-sm bg-success" />reached</span>
              </span>
            </div>
            <div className="flex items-end gap-1 h-40">
              {bars.map((b, i) => (
                <div key={i} className="flex-1 min-w-0 h-full flex flex-col justify-end items-center gap-1" title={`${b.calls} calls · ${b.reached} reached`}>
                  <div className="w-full flex flex-col justify-end rounded-t-md overflow-hidden bg-base-300/30" style={{ height: `${(b.calls / maxCalls) * 100}%`, minHeight: b.calls ? 3 : 0 }}>
                    <div className="w-full bg-success" style={{ height: `${b.calls ? (b.reached / b.calls) * 100 : 0}%` }} />
                    <div className="w-full bg-primary/60 flex-1" />
                  </div>
                  <span className="text-[9px] text-base-content/30 leading-none">{b.label}</span>
                </div>
              ))}
            </div>
            {sum.calls === 0 && <p className="text-center text-xs text-base-content/30 -mt-24 mb-16">No calls in this period yet — go make some noise. 📞</p>}
          </div>

          <div className="rounded-2xl border border-base-300/50 bg-base-200/60 p-4">
            <p className="text-[11px] text-base-content/40 uppercase tracking-wide mb-3">Outcomes</p>
            <div className="flex flex-col gap-2.5">
              {outcomes.map((o) => (
                <div key={o.key}>
                  <div className="flex justify-between text-xs mb-1"><span className="text-base-content/70">{o.emoji} {o.label}</span><span className="text-base-content/40 tabular-nums">{o.n}</span></div>
                  <div className="h-1.5 rounded-full bg-base-300/50 overflow-hidden"><div className="h-full rounded-full bg-primary/60" style={{ width: `${(o.n / maxOut) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {scripts.length > 0 && (
          <div className="mt-3 rounded-2xl border border-base-300/50 bg-base-200/60 p-4">
            <p className="text-[11px] text-base-content/40 uppercase tracking-wide mb-3">Scripts</p>
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] text-base-content/30 text-left"><th className="font-normal pb-1.5">Script</th><th className="font-normal pb-1.5 text-right">Calls</th><th className="font-normal pb-1.5 text-right">Reached</th><th className="font-normal pb-1.5 text-right">Rate</th></tr></thead>
              <tbody>
                {scripts.map((s) => (
                  <tr key={s.name} className="border-t border-base-300/30">
                    <td className="py-2 text-base-content/80">{s.name}</td>
                    <td className="py-2 text-right tabular-nums text-base-content/60">{s.calls}</td>
                    <td className="py-2 text-right tabular-nums text-base-content/60">{s.reached}</td>
                    <td className="py-2 text-right tabular-nums text-success">{Math.round((s.reached / s.calls) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
