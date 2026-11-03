import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { RiCheckLine, RiCloseLine, RiExternalLinkLine, RiFileCopyLine, RiPhoneFill, RiPhoneLine, RiTimeLine } from "react-icons/ri";
import LogActivityModal from "@/components/modals/LogActivityModal";
import NewTodoModal from "@/components/modals/NewTodoModal";
import DateTimePicker, { fromLocalValue } from "@/components/ui/DateTimePicker";
import Cheerleader, { Dialy } from "./Cheerleader";
import LegendBar from "./LegendBar";
import ScriptView, { fillScript } from "./ScriptView";
import { availability } from "@/lib/dialer/availability";
import { OUTCOMES, OUTCOME_LABEL, clock, contactName, humanSec, type DialerRow } from "@/lib/dialer/shared";

interface Script { id: string; name: string; body: string }
interface Stats { xp: number; callsToday: number; reachedToday: number; streak: number }

const MY_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Full-screen call flow: script + timer + cheerleader → outcome → shared Log activity modal → optional todo.
// `logOnly` skips the live call (timer/dial) and goes straight to wrap-up.
export default function CallWizard({ row, stats, logOnly = false, onClose, onDone }: {
  row: DialerRow;
  stats: Stats;
  logOnly?: boolean;
  onClose: () => void;
  onDone: (upd: Partial<DialerRow>, outcome: string) => void;
}) {
  const [phase, setPhase] = useState<"call" | "outcome" | "callback">(logOnly ? "outcome" : "call");
  const [startedAt] = useState(() => new Date());
  const [seconds, setSeconds] = useState(0);
  const [finalSec, setFinalSec] = useState<number | null>(null);
  const [scripts, setScripts] = useState<Script[] | null>(null);
  const [scriptId, setScriptId] = useState("");
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState<string>("");
  const [callbackAt, setCallbackAt] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [showTodo, setShowTodo] = useState<{ upd: Partial<DialerRow> } | null>(null);
  const [busy, setBusy] = useState(false);
  // Todos are a premium feature — free build skips the follow-up step.
  const [hasPremium, setHasPremium] = useState(false);
  useEffect(() => {
    fetch("/api/premium-status").then((r) => (r.ok ? r.json() : null)).then((d) => setHasPremium(!!d?.hasPremium)).catch(() => {});
  }, []);
  const dialRef = useRef<HTMLAnchorElement>(null);

  // Timer
  useEffect(() => {
    if (phase !== "call") return;
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt.getTime()) / 1000)), 500);
    return () => clearInterval(t);
  }, [phase, startedAt]);

  // Dial on start
  useEffect(() => {
    if (!logOnly) dialRef.current?.click();
  }, [logOnly]);

  // Scripts (selection remembered)
  useEffect(() => {
    fetch("/api/dialer/scripts").then((r) => r.json()).then((list: Script[]) => {
      setScripts(list);
      let saved = "";
      try { saved = localStorage.getItem("dialer.scriptId") ?? ""; } catch { /* ignore */ }
      setScriptId(list.find((s) => s.id === saved)?.id ?? list[0]?.id ?? "");
    }).catch(() => setScripts([]));
  }, []);

  function pickScript(id: string) {
    setScriptId(id);
    try { localStorage.setItem("dialer.scriptId", id); } catch { /* ignore */ }
  }

  const script = scripts?.find((s) => s.id === scriptId);
  const filled = useMemo(() => (script ? fillScript(script.body, row) : ""), [script, row]);
  const name = contactName(row);
  const av = availability(row, Date.now(), MY_TZ);
  const dur = finalSec ?? seconds;

  function endCall() {
    setFinalSec(Math.floor((Date.now() - startedAt.getTime()) / 1000));
    setPhase("outcome");
  }

  // One decision per screen: picking an outcome moves straight on (callback asks for a time first)
  function pickOutcome(key: string) {
    setOutcome(key);
    if (key === "callback") setPhase("callback");
    else setShowLog(true);
  }

  // Keyboard
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (showLog || showTodo) return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return;
      if (phase === "call" && (e.key === "Enter" || e.key === "e")) { e.preventDefault(); endCall(); }
      if (phase === "outcome") {
        const i = Number(e.key);
        if (i >= 1 && i <= OUTCOMES.length) pickOutcome(OUTCOMES[i - 1].key);
      }
      if (phase === "callback" && e.key === "Enter" && callbackAt) { e.preventDefault(); setShowLog(true); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function finish() {
    setBusy(true);
    const res = await fetch("/api/dialer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_id: row.id,
        outcome,
        no_log: true, // the shared Log activity modal already wrote the entry
        callback_at: outcome === "callback" ? fromLocalValue(callbackAt)?.toISOString() : undefined,
        duration_sec: logOnly ? undefined : dur,
        started_at: logOnly ? undefined : startedAt.toISOString(),
        script_id: logOnly || !scriptId ? undefined : scriptId,
      }),
    });
    setBusy(false);
    if (!res.ok) { toast.error("Failed to save call outcome"); return; }
    const upd = await res.json();
    setShowLog(false);
    if (hasPremium) setShowTodo({ upd });
    else onDone(upd, outcome);
  }

  const initialBody = `${OUTCOME_LABEL[outcome] ?? "Call"}${logOnly ? "" : ` · ${humanSec(dur)}`}${notes.trim() ? `\n${notes.trim()}` : " — "}`;
  const clk = row.timezone && row.timezone !== MY_TZ
    ? (() => { try { return new Intl.DateTimeFormat([], { timeZone: row.timezone!, hour: "2-digit", minute: "2-digit" }).format(new Date()); } catch { return null; } })()
    : null;

  return (
    <div className="fixed inset-0 z-[60] bg-base-100 flex flex-col overflow-hidden dialer-pop">
      <a ref={dialRef} href={`tel:${row.phone}`} className="hidden" aria-hidden />

      {/* Top bar */}
      <div className="shrink-0 h-16 px-6 flex items-center gap-4 border-b border-base-300/40 bg-base-200/60">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-base-content truncate">{name}</h2>
            {row.call_attempts > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-base-300 text-base-content/50">{row.call_attempts}× tried</span>}
          </div>
          <p className="text-xs text-base-content/40 truncate">{[row.title, row.company].filter(Boolean).join(" · ")}</p>
        </div>

        {phase === "call" ? (
          <>
            <div className="flex items-center gap-2.5 px-4 py-1.5 rounded-xl bg-base-300/50">
              <span className="w-2.5 h-2.5 rounded-full bg-success dialer-live" />
              <span className="font-mono text-2xl font-semibold tabular-nums text-base-content">{clock(seconds)}</span>
            </div>
            <button onClick={endCall} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-error/90 text-error-content hover:bg-error transition-colors">
              <RiPhoneFill size={15} className="rotate-[135deg]" /> End call <kbd className="text-[9px] opacity-60">↵</kbd>
            </button>
          </>
        ) : (
          <button onClick={onClose} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs text-base-content/50 hover:text-base-content hover:bg-base-300/50 transition-colors">
            <RiCloseLine size={15} /> Discard
          </button>
        )}
      </div>

      {phase === "call" ? (
        <div className="flex-1 min-h-0 flex">
          {/* Script */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="shrink-0 px-8 py-3 flex items-center gap-3 border-b border-base-300/30">
              <span className="text-[11px] uppercase tracking-wide text-base-content/40">Script</span>
              {scripts && scripts.length > 0 && (
                <select value={scriptId} onChange={(e) => pickScript(e.target.value)} className="px-3 py-1.5 bg-base-200 border border-base-300/40 rounded-lg text-xs text-base-content/80 focus:outline-none max-w-xs">
                  {scripts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              <a href="/dialer/scripts" target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-[11px] text-base-content/40 hover:text-primary">
                Manage scripts <RiExternalLinkLine size={11} />
              </a>
            </div>
            <div className="flex-1 overflow-y-auto px-10 py-8">
              <div className="max-w-3xl mx-auto">
                {scripts === null ? null : script ? (
                  <ScriptView body={filled} large />
                ) : (
                  <div className="text-center py-20">
                    <p className="text-sm text-base-content/50">No script yet.</p>
                    <a href="/dialer/scripts" target="_blank" rel="noopener noreferrer" className="inline-block mt-3 px-4 py-2 rounded-xl text-sm bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20">Write your first script</a>
                    <p className="text-xs text-base-content/30 mt-3">Wing it for now — you&apos;ve got this.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Side: cheerleader + context + scratchpad */}
          <div className="w-[340px] shrink-0 border-l border-base-300/40 bg-base-200/30 flex flex-col overflow-hidden">
            <div className="shrink-0 px-5 pt-4 pb-2 flex justify-center">
              <Cheerleader seconds={seconds} size={140} />
            </div>
            <div className="flex-1 min-h-0 px-5 flex flex-col gap-3 pb-4">
              <div className="rounded-xl border border-base-300/40 bg-base-200/60 p-3 flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <a href={`tel:${row.phone}`} className="inline-flex items-center gap-2 text-sm font-semibold text-success hover:underline"><RiPhoneLine size={14} /> {row.phone}</a>
                  <span className="flex gap-1">
                    <button title="Copy number" onClick={() => { navigator.clipboard?.writeText(row.phone); toast.success("Copied"); }} className="w-7 h-7 flex items-center justify-center rounded-lg text-base-content/40 hover:text-base-content hover:bg-base-300/50"><RiFileCopyLine size={13} /></button>
                    <a title="Open contact" href={`/contacts/${row.id}`} target="_blank" rel="noopener noreferrer" className="w-7 h-7 flex items-center justify-center rounded-lg text-base-content/40 hover:text-base-content hover:bg-base-300/50"><RiExternalLinkLine size={13} /></a>
                  </span>
                </div>
                {clk && <p className="text-[11px] text-base-content/40 inline-flex items-center gap-1"><RiTimeLine size={11} /> {clk} their time ({row.timezone})</p>}
                {!av.noHours && av.open && <p className="text-[11px] text-success/80">Open · closes in {humanSec((av.closesIn ?? 0) * 60)}</p>}
              </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Quick notes while you talk — they go into the log"
                className="flex-1 min-h-16 w-full bg-base-200/60 border border-base-300/40 rounded-xl px-3 py-2.5 text-sm text-base-content/80 placeholder-base-content/25 leading-relaxed focus:outline-none focus:border-base-300/80 resize-none"
              />
              <LegendBar {...stats} compact />
            </div>
          </div>
        </div>
      ) : (
        /* Wrap-up — one step per screen, never scrolls */
        <div className="flex-1 min-h-0 flex items-center justify-center px-6">
          {phase === "outcome" ? (
            <div key="outcome" className="w-full max-w-2xl flex flex-col items-center dialer-pop">
              <Dialy size={96} mood="celebrate" />
              <h3 className="text-xl font-semibold text-base-content mt-2">{logOnly ? "Log a call" : "Nice work!"}</h3>
              <p className="text-sm text-base-content/50 mt-1 text-center">
                {logOnly ? `How did it go with ${name}?` : <>Call lasted <span className="font-mono text-base-content/80">{humanSec(dur)}</span>. How did it go?</>}
              </p>
              <div className="grid grid-cols-3 gap-2.5 w-full mt-6">
                {OUTCOMES.map((o, i) => (
                  <button
                    key={o.key}
                    onClick={() => pickOutcome(o.key)}
                    className={`flex flex-col items-center gap-1 py-4 rounded-2xl border text-sm font-medium transition-transform hover:scale-[1.02] ${o.cls}`}
                  >
                    <span className="text-2xl">{o.emoji}</span>
                    {o.label}
                    <kbd className="text-[9px] opacity-50">{i + 1}</kbd>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div key="callback" className="w-full max-w-md dialer-pop">
              <h3 className="text-lg font-semibold text-base-content">⏰ Call back when?</h3>
              <p className="text-sm text-base-content/50 mt-1 mb-4">Pick a date and time — {name} moves to &quot;Waiting&quot; until then.</p>
              <DateTimePicker value={callbackAt} onChange={setCallbackAt} placeholder="Pick a date & time" defaultOpen clearable={false} />
              <div className="flex items-center justify-between mt-5">
                <button onClick={() => setPhase("outcome")} className="px-3 py-2 rounded-xl text-sm text-base-content/50 hover:text-base-content hover:bg-base-300/40">← Back</button>
                <button
                  onClick={() => setShowLog(true)}
                  disabled={!callbackAt}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-primary/90 text-primary-content hover:bg-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <RiCheckLine size={16} /> Continue <kbd className="text-[9px] opacity-60">↵</kbd>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showLog && (
        <LogActivityModal
          targetId={row.id}
          initialType="call"
          initialBody={initialBody}
          subtitle={`${name}${logOnly ? "" : ` · ${humanSec(dur)}`}`}
          onClose={() => setShowLog(false)}
          onSave={() => { finish(); }}
        />
      )}

      {showTodo && (
        <NewTodoModal
          targetId={row.id}
          initialTitle={outcome === "callback" ? `Call back ${name}` : ""}
          initialDue={outcome === "callback" ? callbackAt : ""}
          subtitle="Need a follow-up? Create a todo, or skip it."
          cancelLabel="No todo"
          onClose={() => onDone(showTodo.upd, outcome)}
          onSave={() => { toast.success("Todo created"); onDone(showTodo.upd, outcome); }}
        />
      )}
    </div>
  );
}
