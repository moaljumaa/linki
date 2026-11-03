import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RiCloseLine } from "react-icons/ri";

export interface ActivityLog {
  id: string;
  target_id: string;
  type: "call" | "email" | "meeting" | "note" | "other";
  body: string;
  logged_at: string;
  created_at: string;
}

export const LOG_TYPE_COLORS: Record<string, string> = {
  call: "bg-blue-500/15 text-blue-400",
  email: "bg-violet-500/15 text-violet-400",
  meeting: "bg-emerald-500/15 text-emerald-400",
  note: "bg-base-300 text-base-content/50",
  other: "bg-base-300 text-base-content/50",
};

const TYPES = ["note", "call", "email", "meeting", "other"] as const;
const PLACEHOLDERS: Record<string, string> = {
  note: "Write your note...",
  call: "What was discussed on this call?",
  email: "Summary of the email sent or received...",
  meeting: "What happened in this meeting?",
  other: "Describe the activity...",
};

// The one "Log activity" modal — used on the contact page and by the dialer's call wizard.
export default function LogActivityModal({ targetId, onClose, onSave, initialType = "note", initialBody = "", subtitle, cancelLabel = "Cancel", saveLabel = "Log activity" }: {
  targetId: string;
  onClose: () => void;
  onSave: (log: ActivityLog) => void;
  initialType?: ActivityLog["type"];
  initialBody?: string;
  subtitle?: string;
  cancelLabel?: string;
  saveLabel?: string;
}) {
  const [type, setType] = useState<ActivityLog["type"]>(initialType);
  const [body, setBody] = useState(initialBody);
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    if (!body.trim()) return;
    setSaving(true);
    const res = await fetch("/api/activity-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_id: targetId, type, body: body.trim() }),
    });
    setSaving(false);
    if (!res.ok) { toast.error("Failed to log"); return; }
    onSave(await res.json() as ActivityLog);
    toast.success("Activity logged");
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-base-100 border border-base-300/60 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-base-300/40">
          <div>
            <h2 className="text-sm font-semibold text-base-content">Log activity</h2>
            {subtitle && <p className="text-[11px] text-base-content/40 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-base-content/40 hover:text-base-content hover:bg-base-300/50 transition-colors">
            <RiCloseLine size={16} />
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <div className="flex gap-1.5">
            {TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                  type === t
                    ? LOG_TYPE_COLORS[t] + " ring-1 ring-inset ring-current/20"
                    : "bg-base-200 text-base-content/40 hover:text-base-content/70"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") save(); }}
            placeholder={PLACEHOLDERS[type]}
            rows={6}
            className="w-full bg-base-200/60 border border-base-300/40 rounded-xl px-4 py-3 text-sm text-base-content/80 placeholder-base-content/25 leading-relaxed focus:outline-none focus:border-base-300/80 resize-none transition-colors"
          />
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-base-300/40">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-base-content/50 hover:text-base-content hover:bg-base-300/40 transition-colors">
            {cancelLabel}
          </button>
          <button
            onClick={save}
            disabled={!body.trim() || saving}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-primary/90 text-primary-content hover:bg-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Logging..." : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
