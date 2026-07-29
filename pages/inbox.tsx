import Head from "next/head";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  RiMailLine,
  RiLinkedinBoxLine,
  RiSearchLine,
  RiInboxLine,
  RiExternalLinkLine,
  RiSendPlaneLine,
  RiCloseLine,
  RiLoader4Line,
} from "react-icons/ri";
import type { InboxReply } from "./api/inbox/index";
import type { EmailMessage } from "./api/inbox/thread";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

const CHANNEL_TABS = [
  { key: "all", label: "All" },
  { key: "email", label: "Email" },
  { key: "linkedin", label: "LinkedIn" },
] as const;

type ChannelFilter = typeof CHANNEL_TABS[number]["key"];

// ── Classifier verdict badges ───────────────────────────────────────────────

const VERDICT_BADGES: Record<string, { label: string; cls: string }> = {
  ooo_followup: { label: "OOO follow-up", cls: "bg-warning/15 text-warning" },
  substitute: { label: "Substitute", cls: "bg-secondary/15 text-secondary" },
  call_task: { label: "Call task", cls: "bg-success/15 text-success" },
  human_reply: { label: "Human reply", cls: "bg-info/15 text-info" },
  not_interested: { label: "Not interested", cls: "bg-error/15 text-error" },
  cancelled: { label: "Cancelled", cls: "bg-base-300/60 text-base-content/50" },
};

function verdictBadge(reply: InboxReply): { label: string; cls: string } {
  if (reply.classification_error) return { label: "Failed", cls: "bg-error/15 text-error" };
  if (reply.reply_id && !reply.classified_at) return { label: "Pending", cls: "bg-base-300/60 text-base-content/50" };
  if (reply.reply_kind && VERDICT_BADGES[reply.reply_kind]) return VERDICT_BADGES[reply.reply_kind];
  return { label: "—", cls: "bg-base-300/40 text-base-content/30" };
}

// Stable key for filtering — matches the categories the badge renders.
function verdictKey(reply: InboxReply): string {
  if (reply.classification_error) return "failed";
  if (reply.reply_id && !reply.classified_at) return "pending";
  if (reply.reply_kind && VERDICT_BADGES[reply.reply_kind]) return reply.reply_kind;
  return "none";
}

const VERDICT_FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "All verdicts" },
  { key: "ooo_followup", label: "OOO follow-up" },
  { key: "substitute", label: "Substitute" },
  { key: "call_task", label: "Call task" },
  { key: "human_reply", label: "Human reply" },
  { key: "not_interested", label: "Not interested" },
  { key: "pending", label: "Pending" },
  { key: "failed", label: "Failed" },
  { key: "none", label: "Unclassified" },
];

// ── Reply Modal ───────────────────────────────────────────────────────────────

interface ReplyModalProps {
  reply: InboxReply;
  onClose: () => void;
  onActionDone: () => void;
  hasPremium: boolean;
}

function ReplyModal({ reply, onClose, onActionDone, hasPremium }: ReplyModalProps) {
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(true);
  const [replyText, setReplyText] = useState("");
  const [replySubject, setReplySubject] = useState("");
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState<"reclassify" | "cancel" | null>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const verdict = verdictBadge(reply);
  const dispatch = (() => {
    if (!reply.dispatch_result_json) return null;
    try { return JSON.parse(reply.dispatch_result_json) as Record<string, unknown>; } catch { return null; }
  })();
  const scheduledFor = dispatch?.scheduled_for as string | undefined;

  async function handleReclassify() {
    if (!reply.reply_id) return;
    setActing("reclassify");
    try {
      const r = await fetch(`/api/inbox/${reply.reply_id}/reclassify`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Reclassify failed");
      toast.success("Reclassified");
      onActionDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reclassify failed");
    } finally {
      setActing(null);
    }
  }

  async function handleCancelFollowup() {
    if (!reply.reply_id) return;
    setActing("cancel");
    try {
      const r = await fetch(`/api/inbox/${reply.reply_id}/cancel-followup`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Cancel failed");
      toast.success("Follow-up cancelled");
      onActionDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setActing(null);
    }
  }

  useEffect(() => {
    if (!reply.email_account_id || !reply.email) {
      setLoadingThread(false);
      return;
    }
    setLoadingThread(true);
    const params = new URLSearchParams({ targetId: reply.id, emailAccountId: reply.email_account_id });
    fetch(`/api/inbox/thread?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setMessages(d.messages ?? []);
        // Pre-fill reply subject from last message
        const last = (d.messages ?? []).at(-1) as EmailMessage | undefined;
        if (last) {
          setReplySubject(last.subject.startsWith("Re:") ? last.subject : `Re: ${last.subject}`);
        }
      })
      .catch(() => toast.error("Failed to load thread"))
      .finally(() => setLoadingThread(false));
  }, [reply.id, reply.email_account_id, reply.email]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!replyText.trim() || !reply.email || !reply.email_account_id) return;
    setSending(true);
    try {
      const r = await fetch("/api/inbox/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailAccountId: reply.email_account_id,
          to: reply.email,
          subject: replySubject,
          body: replyText,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Send failed");
      toast.success("Reply sent");
      setReplyText("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  const canReply = !!reply.email && !!reply.email_account_id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-2xl max-h-[85vh] flex flex-col bg-base-100 border border-base-300/50 rounded-xl shadow-2xl mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-base-300/50">
          <div>
            <div className="font-semibold text-base-content">
              {reply.full_name ?? reply.email ?? "Unknown"}
            </div>
            <div className="text-xs text-base-content/40 mt-0.5">
              {reply.email && <span>{reply.email}</span>}
              {reply.email_account_from && (
                <span className="ml-2 text-base-content/30">via {reply.email_account_from}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-base-content/40 hover:text-base-content transition-colors p-1"
          >
            <RiCloseLine size={18} />
          </button>
        </div>

        {/* Classifier verdict + dispatch trail */}
        {reply.reply_id && (
          <div className="px-5 py-3.5 border-b border-base-300/50 bg-base-200/40 space-y-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${verdict.cls}`}>
                {verdict.label}
              </span>
              {reply.manually_edited === 1 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-base-300/60 text-base-content/50">
                  edited
                </span>
              )}
              {reply.reply_summary && (
                <span className="text-xs text-base-content/60">{reply.reply_summary}</span>
              )}
            </div>

            {reply.classification_error && (
              <div className="text-xs text-error/80">Classifier error: {reply.classification_error}</div>
            )}

            {dispatch && (
              <div className="text-xs text-base-content/45 space-y-0.5">
                {scheduledFor && <div>Follow-up scheduled for {formatDate(scheduledFor)}</div>}
                {dispatch.substitute_target_id ? <div>Substitute enrolled</div> : null}
                {dispatch.todo_id ? <div>Call task created{dispatch.phone_number ? ` · ${dispatch.phone_number}` : ""}</div> : null}
              </div>
            )}

            <div className="flex items-center gap-2 pt-0.5">
              {hasPremium && (
                <button
                  onClick={handleReclassify}
                  disabled={acting !== null}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-base-300/50 text-base-content/70 hover:bg-base-300 disabled:opacity-40 transition-colors"
                >
                  {acting === "reclassify" ? <RiLoader4Line size={12} className="animate-spin" /> : null}
                  Reclassify
                </button>
              )}
              {scheduledFor && (
                <button
                  onClick={handleCancelFollowup}
                  disabled={acting !== null}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-error/10 text-error hover:bg-error/20 disabled:opacity-40 transition-colors"
                >
                  {acting === "cancel" ? <RiLoader4Line size={12} className="animate-spin" /> : null}
                  Cancel follow-up
                </button>
              )}
            </div>
          </div>
        )}

        {/* Thread */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
          {loadingThread ? (
            <div className="flex items-center justify-center gap-2 text-base-content/30 py-10">
              <RiLoader4Line size={18} className="animate-spin" />
              <span className="text-sm">Loading thread…</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center text-base-content/30 text-sm py-10">
              {canReply ? "No messages found in thread" : "No email account linked to this reply"}
            </div>
          ) : (
            messages.map((msg, i) => {
              const isFromContact = msg.from.toLowerCase().includes((reply.email ?? "").toLowerCase());
              return (
                <div
                  key={i}
                  className={`rounded-lg p-3.5 ${
                    isFromContact
                      ? "bg-base-200 border border-base-300/40"
                      : "bg-primary/8 border border-primary/20"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-base-content/60">{msg.from}</span>
                    <span className="text-xs text-base-content/30">{formatDate(msg.date)}</span>
                  </div>
                  <p className="text-sm text-base-content whitespace-pre-wrap leading-relaxed">
                    {msg.text || "(no text content)"}
                  </p>
                </div>
              );
            })
          )}
          <div ref={threadEndRef} />
        </div>

        {/* Reply composer */}
        {canReply && (
          <div className="border-t border-base-300/50 px-5 py-4 space-y-2.5">
            <input
              type="text"
              value={replySubject}
              onChange={(e) => setReplySubject(e.target.value)}
              placeholder="Subject"
              className="w-full bg-base-200 border border-base-300/50 rounded-lg px-3 py-1.5 text-sm text-base-content placeholder:text-base-content/30 focus:outline-none focus:border-primary/40"
            />
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder={`Reply to ${reply.full_name ?? reply.email}…`}
              rows={4}
              className="w-full bg-base-200 border border-base-300/50 rounded-lg px-3 py-2 text-sm text-base-content placeholder:text-base-content/30 focus:outline-none focus:border-primary/40 resize-none"
            />
            <div className="flex justify-end">
              <button
                onClick={handleSend}
                disabled={!replyText.trim() || sending}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {sending ? <RiLoader4Line size={14} className="animate-spin" /> : <RiSendPlaneLine size={14} />}
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function InboxPage() {
  const [replies, setReplies] = useState<InboxReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [verdict, setVerdict] = useState<string>("all");
  const [selectedReply, setSelectedReply] = useState<InboxReply | null>(null);
  const [reclassifyingAll, setReclassifyingAll] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  // Open-core: AI reply classification + backfill are premium (ee/). Replies are still
  // shown; only the AI action controls are gated behind an upgrade.
  const [hasPremium, setHasPremium] = useState(true);
  useEffect(() => {
    fetch("/api/premium-status").then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setHasPremium(!!d.hasPremium); }).catch(() => {});
  }, []);

  async function handleBackfill() {
    setBackfilling(true);
    try {
      const r = await fetch("/api/inbox/backfill", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Backfill failed");
      toast.success(
        d.to_process === 0
          ? "Nothing to backfill"
          : `Backfilled ${d.classified}/${d.captured} captured${d.failed ? ` (${d.failed} failed)` : ""}`,
      );
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Backfill failed");
    } finally {
      setBackfilling(false);
    }
  }

  async function handleReclassifyAll() {
    setReclassifyingAll(true);
    try {
      const r = await fetch("/api/inbox/reclassify-all", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Reclassify failed");
      toast.success(
        d.total === 0
          ? "Nothing to reclassify"
          : `Reclassified ${d.classified}/${d.total}${d.failed ? ` (${d.failed} failed)` : ""}`,
      );
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reclassify failed");
    } finally {
      setReclassifyingAll(false);
    }
  }

  function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (channel !== "all") params.set("channel", channel);
    fetch(`/api/inbox?${params}`)
      .then((r) => r.json())
      .then((d) => setReplies(d.replies ?? []))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  const filtered = replies.filter((r) => {
    if (verdict !== "all" && verdictKey(r) !== verdict) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (r.full_name ?? "").toLowerCase().includes(q) ||
      (r.email ?? "").toLowerCase().includes(q) ||
      (r.company ?? "").toLowerCase().includes(q) ||
      (r.workflow_name ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <>
      <Head>
        <title>Inbox — Linki</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      {selectedReply && (
        <ReplyModal
          reply={selectedReply}
          onClose={() => setSelectedReply(null)}
          onActionDone={load}
          hasPremium={hasPremium}
        />
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-semibold">Inbox</h1>
            {!loading && filtered.length > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-success/15 text-success">
                {filtered.length} repl{filtered.length !== 1 ? "ies" : "y"}
              </span>
            )}
          </div>
          <p className="text-base-content/40 text-sm mt-0.5">Contacts who replied to your outreach</p>
        </div>
        <div className="flex items-center gap-2">
          {hasPremium ? (
            <>
              <button
                onClick={handleBackfill}
                disabled={backfilling}
                title="Fetch + classify historic replies that predate the classifier (no dispatch)"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-base-200 border border-base-300/50 text-base-content/70 hover:bg-base-300/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {backfilling ? <RiLoader4Line size={13} className="animate-spin" /> : null}
                {backfilling ? "Backfilling…" : "Backfill"}
              </button>
              <button
                onClick={handleReclassifyAll}
                disabled={reclassifyingAll}
                title="Re-run the classifier on unclassified or failed replies (no dispatch)"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-base-200 border border-base-300/50 text-base-content/70 hover:bg-base-300/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {reclassifyingAll ? <RiLoader4Line size={13} className="animate-spin" /> : null}
                {reclassifyingAll ? "Reclassifying…" : "Reclassify all"}
              </button>
            </>
          ) : (
            <a href="https://opsily.com?utm_source=linki&utm_medium=app&utm_campaign=reply-ai" target="_blank" rel="noopener noreferrer"
              title="AI reply classification + auto-followup is a premium feature"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-colors">
              Auto-classify replies · Upgrade →
            </a>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/30 pointer-events-none">
            <RiSearchLine size={13} />
          </span>
          <input
            type="text"
            className="w-56 bg-base-200 border border-base-300/50 rounded-lg pl-8 pr-3 py-1.5 text-sm text-base-content placeholder:text-base-content/30 focus:outline-none focus:border-primary/40"
            placeholder="Name, email, company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="w-px h-4 bg-base-300/60" />

        <div className="flex items-center gap-1">
          {CHANNEL_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setChannel(tab.key)}
              className={`h-7 px-3 rounded-lg text-xs font-medium transition-colors ${
                channel === tab.key
                  ? "bg-primary/15 text-primary border border-primary/30"
                  : "text-base-content/50 hover:text-base-content hover:bg-base-300/50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-base-300/60" />

        <select
          value={verdict}
          onChange={(e) => setVerdict(e.target.value)}
          className="h-7 bg-base-200 border border-base-300/50 rounded-lg px-2.5 text-xs font-medium text-base-content/70 focus:outline-none focus:border-primary/40 cursor-pointer"
        >
          {VERDICT_FILTERS.map((v) => (
            <option key={v.key} value={v.key}>{v.label}</option>
          ))}
        </select>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex flex-col items-center justify-center gap-3 text-base-content/30 py-24">
          <span className="loading loading-spinner loading-md" />
          <span className="text-sm">Loading replies…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 text-base-content/30 py-24">
          <RiInboxLine size={36} className="opacity-30" />
          <div className="text-center">
            <p className="text-sm font-medium">
              {search ? "No replies match your search" : "No replies yet"}
            </p>
            <p className="text-xs mt-1 text-base-content/25">
              {!search && "Replies are detected automatically by the runner"}
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-base-300/50 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-base-300/50 bg-base-200/60">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-base-content/40">Contact</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-base-content/40">Channel</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-base-content/40">Verdict</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-base-content/40">From</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-base-content/40">Campaign</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-base-content/40">Replied</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-base-300/30 hover:bg-base-200/40 transition-colors cursor-pointer"
                  onClick={() => setSelectedReply(r)}
                >
                  {/* Contact */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-base-content">
                            {r.full_name ?? r.email ?? r.linkedin_url ?? "Unknown"}
                          </span>
                          {r.linkedin_url && (
                            <a
                              href={r.linkedin_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-base-content/25 hover:text-primary transition-colors"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <RiExternalLinkLine size={12} />
                            </a>
                          )}
                        </div>
                        <div className="text-xs text-base-content/40 mt-0.5">
                          {r.company ? (
                            <span>{r.company}</span>
                          ) : r.email ? (
                            <span>{r.email}</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Channel */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {(r.channel === "email" || r.channel === "both") && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-info/15 text-info">
                          <RiMailLine size={11} /> Email
                        </span>
                      )}
                      {(r.channel === "linkedin" || r.channel === "both") && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-primary/15 text-primary">
                          <RiLinkedinBoxLine size={11} /> LinkedIn
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Verdict */}
                  <td className="px-4 py-3">
                    {(() => {
                      const v = verdictBadge(r);
                      return (
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${v.cls}`}>
                            {v.label}
                          </span>
                          {r.reply_summary && (
                            <span className="text-xs text-base-content/35 truncate max-w-[16rem]" title={r.reply_summary}>
                              {r.reply_summary}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </td>

                  {/* From (email account) */}
                  <td className="px-4 py-3">
                    {r.email_account_from ? (
                      <span className="text-xs text-base-content/50">
                        {r.email_account_name ?? r.email_account_from}
                      </span>
                    ) : (
                      <span className="text-xs text-base-content/25">—</span>
                    )}
                  </td>

                  {/* Campaign */}
                  <td className="px-4 py-3">
                    {r.workflow_id ? (
                      <Link
                        href={`/workflows/${r.workflow_id}`}
                        className="text-xs text-base-content/60 hover:text-base-content transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.workflow_name ?? r.workflow_id}
                      </Link>
                    ) : (
                      <span className="text-xs text-base-content/25">—</span>
                    )}
                  </td>

                  {/* Replied */}
                  <td className="px-4 py-3 text-right">
                    <span className="text-xs text-base-content/40">{timeAgo(r.replied_at)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
