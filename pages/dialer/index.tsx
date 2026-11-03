import Head from "next/head";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { availability as availAt, bucketOf, type Avail, type Bucket } from "@/lib/dialer/availability";
import CallWizard from "@/components/dialer/CallWizard";
import LegendBar from "@/components/dialer/LegendBar";
import { Dialy } from "@/components/dialer/Cheerleader";
import { xpOf } from "@/lib/dialer/legend";
import { OUTCOME_LABEL, contactName as name, type DialerRow as Row } from "@/lib/dialer/shared";
import {
  RiPhoneFill,
  RiSkipForwardLine,
  RiExternalLinkLine,
  RiTimeLine,
  RiEditBoxLine,
  RiMailSendLine,
} from "react-icons/ri";
import SendEmailModal from "@/components/modals/SendEmailModal";

const MY_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function fmtDur(min: number) {
  if (min < 60) return `${Math.max(1, Math.round(min))}m`;
  if (min < 24 * 60) { const h = Math.floor(min / 60), m = Math.round(min % 60); return m ? `${h}h ${m}m` : `${h}h`; }
  return `${Math.round(min / 1440)}d`;
}

const availability = (r: Row, now: number) => availAt(r, now, MY_TZ);

function isToday(iso: string | null, now: number) {
  return !!iso && new Date(iso).toDateString() === new Date(now).toDateString();
}

function hhmm(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function localClock(tz: string | null, now: number) {
  if (!tz || tz === MY_TZ) return null;
  try { return new Intl.DateTimeFormat([], { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(now)); } catch { return null; }
}

function Pill({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium whitespace-nowrap ${cls}`}>{children}</span>;
}

const LIST_KEY = "dialer.listId";
const TAB_KEY = "dialer.tab";

const TABS: { key: Bucket; label: string }[] = [
  { key: "now", label: "Now" },
  { key: "later", label: "Later" },
  { key: "waiting", label: "Waiting" },
  { key: "nohours", label: "No hours" },
  { key: "done", label: "Done" },
];

export default function DialerPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [lists, setLists] = useState<{ id: string; name: string }[]>([]);
  const [listId, setListId] = useState("");
  const [ready, setReady] = useState(false); // saved list restored from localStorage
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Bucket>("now");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wizard, setWizard] = useState<{ row: Row; logOnly: boolean } | null>(null);
  const [emailTo, setEmailTo] = useState<{ id: string; name: string; email: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [lifetime, setLifetime] = useState({ calls: 0, reached: 0, talk_sec: 0 });
  const [streak, setStreak] = useState(0);
  const [sessionsToday, setSessionsToday] = useState({ calls: 0, reached: 0 });

  // Restore the remembered list + tab once, then allow loading
  useEffect(() => {
    try {
      setListId(localStorage.getItem(LIST_KEY) ?? "");
      const t = localStorage.getItem(TAB_KEY) as Bucket | null;
      if (t && TABS.some((x) => x.key === t)) setTab(t);
    } catch { /* ignore */ }
    setReady(true);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!ready) return;
    setLoading(true);
    fetch(`/api/dialer${listId ? `?list_id=${listId}` : ""}`)
      .then((r) => r.json())
      .then((d) => {
        setRows(d.contacts ?? []);
        const ls = d.lists ?? [];
        setLists(ls);
        // A remembered list that no longer exists falls back to "all"
        if (listId && !ls.some((l: { id: string }) => l.id === listId)) setListId("");
      })
      .catch(() => toast.error("Failed to load queue"))
      .finally(() => setLoading(false));
  }, [listId, ready]);

  const loadStats = useCallback(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    fetch(`/api/dialer/analytics?since=${encodeURIComponent(start.toISOString())}&tz_offset=${new Date().getTimezoneOffset()}`)
      .then((r) => r.json())
      .then((d) => {
        setLifetime(d.lifetime);
        setStreak(d.streak);
        const s = d.sessions as { outcome: string }[];
        setSessionsToday({ calls: s.length, reached: s.filter((x) => x.outcome === "reached").length });
      })
      .catch(() => {});
  }, []);
  useEffect(loadStats, [loadStats]);

  function chooseList(id: string) {
    setListId(id);
    setSelectedId(null);
    try { localStorage.setItem(LIST_KEY, id); } catch { /* ignore */ }
  }
  function chooseTab(t: Bucket) {
    setTab(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* ignore */ }
  }

  const buckets = useMemo(() => {
    const out: Record<Bucket, { row: Row; av: Avail; waitUntil?: number }[]> = { now: [], later: [], waiting: [], nohours: [], done: [] };
    for (const row of rows) {
      const av = availability(row, now);
      const { bucket, waitUntil } = bucketOf(row, now, av);
      out[bucket].push({ row, av, waitUntil });
    }
    out.now.sort((a, b) => (a.av.closesIn ?? 0) - (b.av.closesIn ?? 0));
    out.later.sort((a, b) => (a.av.opensIn ?? 0) - (b.av.opensIn ?? 0));
    out.waiting.sort((a, b) => (a.waitUntil ?? 0) - (b.waitUntil ?? 0));
    out.done.sort((a, b) => (b.row.last_called_at ?? "").localeCompare(a.row.last_called_at ?? ""));
    return out;
  }, [rows, now]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;
  // Today's numbers: recorded sessions, or at least the contacts touched today
  const calledToday = Math.max(sessionsToday.calls, rows.filter((r) => isToday(r.last_called_at, now)).length);
  const reachedToday = Math.max(sessionsToday.reached, rows.filter((r) => isToday(r.last_called_at, now) && r.call_status === "reached").length);
  const stats = { xp: xpOf(lifetime.calls, lifetime.reached, lifetime.talk_sec), callsToday: calledToday, reachedToday, streak };

  function skip() {
    const ids = buckets[tab].map((b) => b.row.id);
    const idx = selected ? ids.indexOf(selected.id) : -1;
    setSelectedId(ids.length ? ids[(idx + 1) % ids.length] : null);
  }

  function onWizardDone(upd: Partial<Row>, outcome: string) {
    const w = wizard;
    setWizard(null);
    if (!w) return;
    const nextRows = rows.map((r) => (r.id === w.row.id ? { ...r, ...upd } : r));
    setRows(nextRows);
    loadStats();
    toast.success(`${name(w.row)} — ${OUTCOME_LABEL[outcome] ?? "logged"}`);
    // Auto-advance within the tab we're working: the next contact still in it
    const ids = buckets[tab].map((b) => b.row.id);
    const idx = ids.indexOf(w.row.id);
    const t = Date.now();
    const pick = [...ids.slice(idx + 1), ...ids.slice(0, Math.max(idx, 0))].find((id) => {
      const r = nextRows.find((x) => x.id === id);
      return !!r && r.id !== w.row.id && bucketOf(r, t, availability(r, t)).bucket === tab;
    }) ?? null;
    setSelectedId(pick);
  }

  async function requeue(id: string) {
    const res = await fetch("/api/dialer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target_id: id, outcome: "requeue" }) });
    if (!res.ok) { toast.error("Failed"); return; }
    const upd = await res.json();
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...upd } : r)));
    toast.success("Back in the queue");
  }

  async function emailContact(r: Row) {
    const res = await fetch(`/api/targets/${r.id}`);
    const t = res.ok ? await res.json() : null;
    if (!t?.email) { toast.error("This contact has no email address"); return; }
    setEmailTo({ id: r.id, name: name(r), email: t.email });
  }

  // Keyboard: Enter/C call, S skip, L log without calling, Esc close, ↑↓ move
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (wizard || emailTo || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || e.metaKey || e.ctrlKey || e.altKey) return;
      const ids = buckets[tab].map((b) => b.row.id);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const idx = selectedId ? ids.indexOf(selectedId) : -1;
        const n = e.key === "ArrowDown" ? Math.min(ids.length - 1, idx + 1) : Math.max(0, idx - 1);
        if (ids[n]) setSelectedId(ids[n]);
        return;
      }
      if (!selected) return;
      if (e.key === "Enter" || e.key.toLowerCase() === "c") { e.preventDefault(); setWizard({ row: selected, logOnly: false }); }
      else if (e.key.toLowerCase() === "l") setWizard({ row: selected, logOnly: true });
      else if (e.key.toLowerCase() === "s") skip();
      else if (e.key === "Escape") setSelectedId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const list = buckets[tab];
  const selAv = selected ? availability(selected, now) : null;
  const selClock = selected ? localClock(selected.timezone, now) : null;

  return (
    <>
      <Head><title>Dialer — Linki</title></Head>
      {wizard && <CallWizard row={wizard.row} logOnly={wizard.logOnly} stats={stats} onClose={() => setWizard(null)} onDone={onWizardDone} />}
      {emailTo && <SendEmailModal targetId={emailTo.id} toName={emailTo.name} toEmail={emailTo.email} onClose={() => setEmailTo(null)} />}
      <div className="-m-6 h-screen flex overflow-hidden">
        {/* Queue */}
        <div className="w-[380px] shrink-0 border-r border-base-300/40 flex flex-col bg-base-100">
          <div className="px-4 pt-5 pb-3">
            <h1 className="text-base font-semibold text-base-content tracking-tight">Dialer</h1>
            <div className="mt-3">
              <LegendBar {...stats} compact />
              <div className="flex items-center gap-2 mt-2 px-1">
                <div className="flex-1 h-1.5 rounded-full bg-base-300/60 overflow-hidden">
                  <div className="h-full rounded-full bg-success transition-all duration-700" style={{ width: `${Math.min(100, (calledToday / 30) * 100)}%` }} />
                </div>
                <span className="text-[10px] text-base-content/40 shrink-0">{calledToday}/30 today{reachedToday > 0 && <> · <span className="text-success">{reachedToday} reached</span></>}</span>
              </div>
            </div>
            <select
              value={listId}
              onChange={(e) => chooseList(e.target.value)}
              className="mt-3 w-full px-3 py-1.5 bg-base-200 border border-base-300/40 rounded-lg text-xs text-base-content/70 focus:outline-none"
            >
              <option value="">All contacts with a phone</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>

          <div className="flex gap-0.5 mx-4 mb-2 bg-base-200 border border-base-300/40 rounded-xl p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => chooseTab(t.key)}
                className={`flex-1 px-0.5 py-1 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap ${tab === t.key ? "bg-base-300 text-base-content shadow-sm" : "text-base-content/40 hover:text-base-content/70"}`}
              >
                {t.label} <span className={tab === t.key ? "text-base-content/50" : "text-base-content/25"}>{buckets[t.key].length}</span>
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-4 flex flex-col gap-1">
            {loading ? (
              <p className="text-center text-xs text-base-content/30 py-16">Loading…</p>
            ) : list.length === 0 ? (
              <p className="text-center text-xs text-base-content/30 py-16 px-6 leading-relaxed">
                {rows.length === 0
                  ? "No contacts with a phone number yet. Add a phone and opening hours on a contact."
                  : tab === "now" ? "Nobody is available right now." : tab === "nohours" ? "Everyone has opening hours set. 👏" : "Nothing here."}
              </p>
            ) : list.map(({ row: r, av, waitUntil }) => {
              const active = r.id === selectedId;
              const clk = localClock(r.timezone, now);
              return (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={`text-left px-3 py-2.5 rounded-xl border transition-colors ${active ? "bg-primary/10 border-primary/30" : "bg-base-200/50 border-base-300/30 hover:bg-base-200 hover:border-base-300/70"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-base-content truncate">{name(r)}</span>
                    {tab === "now" && <Pill cls={(av.closesIn ?? 99) <= 30 ? "bg-warning/15 text-warning" : "bg-success/15 text-success"}>closes {fmtDur(av.closesIn ?? 0)}</Pill>}
                    {tab === "later" && <Pill cls="bg-base-300 text-base-content/50">opens in {fmtDur(av.opensIn ?? 0)}</Pill>}
                    {tab === "waiting" && waitUntil && <Pill cls="bg-info/15 text-info">retry {hhmm(waitUntil)}</Pill>}
                    {tab === "nohours" && <Pill cls="bg-base-300 text-base-content/40">any time</Pill>}
                    {tab === "done" && r.call_status && <Pill cls={r.call_status === "reached" ? "bg-success/15 text-success" : "bg-base-300 text-base-content/50"}>{OUTCOME_LABEL[r.call_status]}</Pill>}
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-xs text-base-content/40 truncate">{[r.title, r.company].filter(Boolean).join(" · ") || r.phone}</span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {clk && <span className="text-[10px] text-base-content/30">{clk} local</span>}
                      {r.call_attempts > 0 && tab !== "done" && <span className="text-[10px] text-base-content/30">{r.call_attempts}× tried</span>}
                      {tab === "done" && (
                        <span
                          onClick={(e) => { e.stopPropagation(); requeue(r.id); }}
                          className="text-[10px] text-base-content/30 hover:text-primary cursor-pointer"
                        >re-queue</span>
                      )}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="px-4 py-2 border-t border-base-300/40 text-[10px] text-base-content/25 leading-relaxed">
            ↑↓ move · ↵ call · L log · S skip · Esc close · {MY_TZ}
          </div>
        </div>

        {/* Contact panel */}
        <div className="flex-1 min-w-0 flex flex-col bg-base-100">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
              <Dialy size={120} excited={false} />
              <p className="text-sm text-base-content/70 mt-3">
                {buckets.now.length > 0 ? `${buckets.now.length} available to call right now` : "Nobody is available right now"}
              </p>
              <p className="text-xs text-base-content/30 mt-1">Pick someone from the queue and hit Call.</p>
              <div className="w-full max-w-sm mt-6"><LegendBar {...stats} /></div>
            </div>
          ) : (
            <>
              <div className="shrink-0 px-6 py-4 border-b border-base-300/40 bg-base-200/40">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-base font-semibold text-base-content truncate">{name(selected)}</h2>
                      {selAv && !selAv.noHours && (
                        selAv.open
                          ? <Pill cls="bg-success/15 text-success">open · closes {fmtDur(selAv.closesIn ?? 0)}</Pill>
                          : <Pill cls="bg-base-300 text-base-content/50">closed · opens in {fmtDur(selAv.opensIn ?? 0)}</Pill>
                      )}
                      {selAv?.noHours && <Pill cls="bg-base-300 text-base-content/40">no opening hours</Pill>}
                      {selected.call_attempts > 0 && <Pill cls="bg-base-300 text-base-content/50">{selected.call_attempts}× tried{selected.call_status ? ` · last: ${OUTCOME_LABEL[selected.call_status]}` : ""}</Pill>}
                    </div>
                    <p className="text-xs text-base-content/40 mt-0.5 truncate">{[selected.title, selected.company].filter(Boolean).join(" · ")}</p>
                    {selClock && <p className="text-[11px] text-base-content/30 mt-1 inline-flex items-center gap-1"><RiTimeLine size={11} /> {selClock} local ({selected.timezone})</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      title="Send email"
                      onClick={() => emailContact(selected)}
                      className="w-9 h-9 flex items-center justify-center rounded-xl text-base-content/40 hover:text-base-content hover:bg-base-300/50 transition-colors"
                    ><RiMailSendLine size={15} /></button>
                    <button
                      title="Log a call without dialing (L)"
                      onClick={() => setWizard({ row: selected, logOnly: true })}
                      className="w-9 h-9 flex items-center justify-center rounded-xl text-base-content/40 hover:text-base-content hover:bg-base-300/50 transition-colors"
                    ><RiEditBoxLine size={15} /></button>
                    <button
                      title="Skip (S)"
                      onClick={skip}
                      className="w-9 h-9 flex items-center justify-center rounded-xl text-base-content/40 hover:text-base-content hover:bg-base-300/50 transition-colors"
                    ><RiSkipForwardLine size={15} /></button>
                    <a
                      title="Open full contact"
                      href={`/contacts/${selected.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-9 h-9 flex items-center justify-center rounded-xl text-base-content/40 hover:text-base-content hover:bg-base-300/50 transition-colors"
                    ><RiExternalLinkLine size={15} /></a>
                    <button
                      onClick={() => setWizard({ row: selected, logOnly: false })}
                      className="ml-1 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-success/90 text-success-content hover:bg-success transition-colors"
                    >
                      <RiPhoneFill size={15} /> Call <span className="font-normal opacity-80">{selected.phone}</span>
                    </button>
                  </div>
                </div>
              </div>

              <iframe
                key={selected.id}
                src={`/contacts/${selected.id}?embed=1`}
                className="flex-1 w-full border-0 bg-base-100"
                title="Contact details"
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}
