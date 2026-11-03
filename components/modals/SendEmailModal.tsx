import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RiCloseLine, RiSendPlaneLine } from "react-icons/ri";

interface Account { id: string; name: string | null; from_email: string; from_name: string | null; signature: string | null }

// Send an email to one contact straight from Linki, from any configured email account.
export default function SendEmailModal({ targetId, toName, toEmail, onClose, onSent }: {
  targetId: string;
  toName?: string | null;
  toEmail: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountId, setAccountId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/email-accounts").then((r) => r.json()).then((list: Account[]) => {
      setAccounts(list);
      try {
        const last = localStorage.getItem("linki.sendEmail.account");
        setAccountId(list.find((a) => a.id === last)?.id ?? list[0]?.id ?? "");
      } catch { setAccountId(list[0]?.id ?? ""); }
    }).catch(() => setAccounts([]));
    subjectRef.current?.focus();
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const account = accounts?.find((a) => a.id === accountId);

  async function send() {
    if (!accountId || !subject.trim() || !body.trim()) return;
    setSending(true);
    const res = await fetch(`/api/targets/${targetId}/emails`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email_account_id: accountId, subject: subject.trim(), body }),
    });
    setSending(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error ?? "Failed to send");
      return;
    }
    try { localStorage.setItem("linki.sendEmail.account", accountId); } catch { /* ignore */ }
    toast.success(`Email sent to ${toName || toEmail}`);
    onSent?.();
    onClose();
  }

  const field = "w-full bg-base-200/60 border border-base-300/40 rounded-xl px-3 py-2 text-sm text-base-content/80 placeholder-base-content/25 focus:outline-none focus:border-base-300/80 transition-colors";
  const label = "block text-[11px] text-base-content/40 uppercase tracking-wide mb-1.5";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-xl bg-base-100 border border-base-300/60 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-base-300/40">
          <h2 className="text-sm font-semibold text-base-content">Send email</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-base-content/40 hover:text-base-content hover:bg-base-300/50 transition-colors">
            <RiCloseLine size={16} />
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>From</label>
              {accounts && accounts.length === 0 ? (
                <p className="text-xs text-warning py-2">No email accounts yet — add one in Settings → Email.</p>
              ) : (
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={field}>
                  {(accounts ?? []).map((a) => (
                    <option key={a.id} value={a.id}>{a.from_name ? `${a.from_name} <${a.from_email}>` : a.from_email}</option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className={label}>To</label>
              <div className={`${field} text-base-content/60 truncate`}>{toName ? `${toName} <${toEmail}>` : toEmail}</div>
            </div>
          </div>
          <div>
            <label className={label}>Subject</label>
            <input ref={subjectRef} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className={field} />
          </div>
          <div>
            <label className={label}>Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send(); }}
              rows={10}
              placeholder="Write your email..."
              className={`${field} leading-relaxed resize-none`}
            />
            {account?.signature && (
              <button type="button" onClick={() => setBody((b) => `${b}${b ? "\n\n" : ""}${account.signature}`)} className="mt-1.5 text-[11px] text-primary/80 hover:text-primary">
                + Insert signature
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-base-300/40">
          <span className="text-[11px] text-base-content/30">Ctrl/⌘ + Enter to send</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-base-content/50 hover:text-base-content hover:bg-base-300/40 transition-colors">Cancel</button>
            <button
              onClick={send}
              disabled={sending || !accountId || !subject.trim() || !body.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-primary/90 text-primary-content hover:bg-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <RiSendPlaneLine size={14} /> {sending ? "Sending..." : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
