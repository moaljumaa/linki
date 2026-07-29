import Head from "next/head";
import { useEffect, useState, useRef } from "react";
import { FiUserPlus, FiMessageSquare, FiEye, FiRepeat, FiUsers, FiRefreshCw } from "react-icons/fi";
import { RiMailSendLine, RiReplyLine, RiRobot2Line, RiLinkedinBoxLine, RiFilterLine } from "react-icons/ri";

interface DashboardStats {
  totals: {
    total_targets: number;
    connections_requested: number;
    connected: number;
    messages_sent: number;
    inmails_sent: number;
    replies_received: number;
    active_runs: number;
    total_lists: number;
    total_workflows: number;
    emails_sent: number;
    email_replies: number;
  };
  today: {
    visits_today: number;
    connections_today: number;
    messages_today: number;
    inmails_today: number;
  };
  activity: { day: string; visits: number; connections: number; messages: number; inmails: number; emails: number }[];
  lists: { id: string; name: string }[];
  workflows: { id: string; name: string }[];
}

interface AgentStats {
  daily: { day: string; cost_usd: number; input_tokens: number; output_tokens: number }[];
}

interface AccountRow {
  id: string;
  is_authenticated: number;
  li_connections: number | null;
  li_pending: number | null;
  li_profile_views: number | null;
  li_stats_synced_at: string | null;
}

// ── Animated counter ──────────────────────────────────────────────────────────

function Counter({ value, duration = 800 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const raf = useRef<number>(0);
  const start = useRef<number>(0);
  const from = useRef<number>(0);

  useEffect(() => {
    from.current = display;
    start.current = 0;
    cancelAnimationFrame(raf.current);
    function step(ts: number) {
      if (!start.current) start.current = ts;
      const p = Math.min((ts - start.current) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from.current + (value - from.current) * ease));
      if (p < 1) raf.current = requestAnimationFrame(step);
    }
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value]); // eslint-disable-line

  return <>{display.toLocaleString()}</>;
}

// ── Channel section header ─────────────────────────────────────────────────────

function ChannelHeader({ icon, label, color }: { icon: React.ReactNode; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-widest" style={{ color }}>
        {icon} {label}
      </span>
      <div className="flex-1 h-px bg-base-300/50" />
    </div>
  );
}

// ── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, color, icon, pulse,
}: {
  label: string;
  value: number;
  sub?: string;
  color: string;
  icon: React.ReactNode;
  pulse?: boolean;
}) {
  return (
    <div
      className="relative bg-base-200 border border-base-300/50 rounded-xl p-4 overflow-hidden group hover:border-base-300 transition-colors"
      style={{ "--kpi-color": color } as React.CSSProperties}
    >
      <div
        className="absolute top-0 right-0 w-16 h-16 rounded-bl-3xl opacity-[0.06] transition-opacity group-hover:opacity-10"
        style={{ background: color }}
      />
      <div className="flex items-start justify-between mb-3">
        <span
          className="w-7 h-7 rounded-lg flex items-center justify-center text-xs shrink-0"
          style={{ background: `${color}18`, color }}
        >
          {icon}
        </span>
        {pulse && (
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: color }} />
          </span>
        )}
      </div>
      <div className="tabular-nums font-semibold text-2xl text-base-content leading-none mb-1.5">
        <Counter value={value} />
      </div>
      <div className="text-xs text-base-content/40">{label}</div>
      {sub && <div className="text-xs mt-1" style={{ color }}>{sub}</div>}
    </div>
  );
}

// ── Funnel bar row ─────────────────────────────────────────────────────────────

function FunnelRow({
  icon, color, label, value, max,
}: {
  icon: React.ReactNode;
  color: string;
  label: string;
  value: number;
  max: number;
}) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 group">
      <span
        className="w-5 h-5 rounded flex items-center justify-center shrink-0"
        style={{ background: `${color}15`, color }}
      >
        {icon}
      </span>
      <span className="text-xs text-base-content/50 w-24 shrink-0">{label}</span>
      <div className="flex-1 h-1 bg-base-300/30 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="text-sm font-semibold tabular-nums text-base-content w-10 text-right">
        <Counter value={value} />
      </span>
    </div>
  );
}

// ── Activity chart ────────────────────────────────────────────────────────────

const SERIES = [
  { key: "visits" as const,      color: "#5aa2ff", label: "Visits" },
  { key: "connections" as const, color: "#32d583", label: "Connects" },
  { key: "messages" as const,    color: "#f4b740", label: "Messages" },
  { key: "inmails" as const,     color: "#e879f9", label: "InMails" },
  { key: "emails" as const,      color: "#fb923c", label: "Emails" },
];

const DAY_OPTIONS = [7, 14, 30, 90];

function ActivityChart({
  data, days, onDaysChange,
}: {
  data: DashboardStats["activity"];
  days: number;
  onDaysChange: (d: number) => void;
}) {
  const [activeSeries, setActiveSeries] = useState<Set<string>>(new Set(SERIES.map(s => s.key)));
  const maxVal = Math.max(
    ...data.flatMap(d => SERIES.filter(s => activeSeries.has(s.key)).map(s => d[s.key])),
    1
  );
  const labelEvery = days <= 7 ? 1 : days <= 14 ? 2 : days <= 30 ? 5 : 15;
  const gridLines = [0.25, 0.5, 0.75, 1];

  function toggleSeries(key: string) {
    setActiveSeries(prev => {
      const next = new Set(prev);
      if (next.has(key) && next.size > 1) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="bg-base-200 border border-base-300/50 rounded-xl p-5 flex flex-col" style={{ minHeight: 260 }} data-tour="dashboard-chart">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-base-content">Activity</span>
          <div className="flex items-center gap-2">
            {SERIES.map(s => (
              <button
                key={s.key}
                onClick={() => toggleSeries(s.key)}
                className="flex items-center gap-1.5 text-xs transition-opacity"
                style={{ opacity: activeSeries.has(s.key) ? 1 : 0.3 }}
              >
                <span className="w-2 h-2 rounded-sm inline-block" style={{ background: s.color }} />
                <span style={{ color: activeSeries.has(s.key) ? s.color : undefined }} className="text-base-content/35">{s.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-0.5 bg-base-300/50 rounded-lg p-0.5">
          {DAY_OPTIONS.map(d => (
            <button
              key={d}
              onClick={() => onDaysChange(d)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                days === d
                  ? "bg-base-100 text-base-content shadow-sm"
                  : "text-base-content/35 hover:text-base-content/60"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="relative flex-1" style={{ minHeight: 140 }}>
        {gridLines.map(g => (
          <div
            key={g}
            className="absolute left-0 right-0 border-t border-base-300/20"
            style={{ bottom: `${g * 100}%` }}
          />
        ))}

        <div className="absolute inset-0 flex items-end gap-0.5">
          {data.map((d, i) => {
            const showLabel = i % labelEvery === 0;
            return (
              <div key={d.day} className="flex flex-col items-center flex-1 group relative h-full justify-end">
                {/* Tooltip */}
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-base-300 border border-base-300 rounded-lg px-3 py-2 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10 shadow-xl transition-opacity">
                  <div className="text-base-content/40 mb-1.5 font-medium">{d.day}</div>
                  {SERIES.filter(s => activeSeries.has(s.key)).map(s => (
                    <div key={s.key} className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
                      <span style={{ color: s.color }}>{d[s.key]} {s.label.toLowerCase()}</span>
                    </div>
                  ))}
                </div>
                {/* Bars */}
                <div className="flex items-end gap-px w-full">
                  {SERIES.filter(s => activeSeries.has(s.key)).map(s => (
                    <div
                      key={s.key}
                      className="flex-1 rounded-t-sm transition-all duration-300"
                      style={{
                        height: `${Math.max(2, (d[s.key] / maxVal) * 120)}px`,
                        background: s.color,
                        opacity: d[s.key] === 0 ? 0.08 : 0.75,
                      }}
                    />
                  ))}
                </div>
                {showLabel && (
                  <span className="text-[9px] text-base-content/20 mt-1 leading-none shrink-0">
                    {d.day.slice(5)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── LinkedIn stats card ───────────────────────────────────────────────────────

interface LiStats { connections: number; pending: number; profile_views: number }

function LinkedInCard({
  accountId, cachedStats, cachedSyncedAt,
}: {
  accountId?: string;
  cachedStats?: LiStats | null;
  cachedSyncedAt?: string | null;
}) {
  const [syncing, setSyncing] = useState(false);
  const [liStats, setLiStats] = useState<LiStats | null>(cachedStats ?? null);
  const [syncedAt, setSyncedAt] = useState<string | null>(cachedSyncedAt ?? null);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function handleSync() {
    if (!accountId) return;
    setSyncing(true); setSyncError(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}/li-stats`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      setLiStats(data);
      setSyncedAt(new Date().toISOString());
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  const items = [
    { label: "Connections", value: liStats?.connections ?? null, color: "#32d583" },
    { label: "Pending sent", value: liStats?.pending ?? null, color: "#f4b740" },
    { label: "Profile views", value: liStats?.profile_views ?? null, color: "#5aa2ff" },
  ];

  return (
    <div className="bg-base-200 border border-base-300/50 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <RiLinkedinBoxLine size={14} className="text-base-content/30" />
          <span className="text-xs font-medium text-base-content/40 uppercase tracking-widest">LinkedIn</span>
        </div>
        <div className="flex items-center gap-2">
          {syncedAt && (
            <span className="text-[10px] text-base-content/20">
              {new Date(syncedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {accountId && (
            <button
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-base-content/40 hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40"
            >
              <FiRefreshCw size={10} className={syncing ? "animate-spin" : ""} />
              {syncing ? "Syncing" : "Sync"}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {items.map(s => (
          <div key={s.label} className="flex flex-col gap-1.5 bg-base-300/30 rounded-lg p-3">
            {s.value !== null
              ? <span className="text-xl font-semibold tabular-nums" style={{ color: s.color }}><Counter value={s.value} /></span>
              : <span className="text-xl font-semibold text-base-content/10">—</span>
            }
            <span className="text-[10px] text-base-content/30 uppercase tracking-wide">{s.label}</span>
          </div>
        ))}
      </div>

      {syncError && <p className="text-xs text-error mt-2">{syncError}</p>}
      {!accountId && <p className="text-xs text-base-content/20 mt-2">No authenticated account.</p>}
    </div>
  );
}

// ── AI usage panel ────────────────────────────────────────────────────────────

function AiUsagePanel({ data, days }: { data: AgentStats["daily"]; days: number }) {
  const totalCost = data.reduce((s, d) => s + (d.cost_usd ?? 0), 0);
  const totalTokens = data.reduce((s, d) => s + (d.input_tokens ?? 0) + (d.output_tokens ?? 0), 0);
  const hasData = totalCost > 0 || totalTokens > 0;
  const maxCost = Math.max(...data.map(d => d.cost_usd ?? 0), 0.000001);
  const labelEvery = days <= 7 ? 1 : days <= 14 ? 2 : days <= 30 ? 5 : 15;

  return (
    <div className="bg-base-200 border border-base-300/50 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <RiRobot2Line size={14} className="text-base-content/30" />
          <span className="text-xs font-medium text-base-content/40 uppercase tracking-widest">AI Usage</span>
        </div>
        {hasData && (
          <div className="flex items-center gap-3 text-xs">
            <span className="text-base-content/30 tabular-nums">{totalTokens.toLocaleString()} tokens</span>
            <span className="font-semibold tabular-nums" style={{ color: "#a78bfa" }}>${totalCost.toFixed(4)}</span>
          </div>
        )}
      </div>

      {!hasData ? (
        <p className="text-xs text-base-content/20 py-2">No AI usage in this period.</p>
      ) : (
        <div className="flex items-end gap-0.5" style={{ height: 52 }}>
          {data.map((d, i) => {
            const showLabel = i % labelEvery === 0;
            const height = Math.max(2, ((d.cost_usd ?? 0) / maxCost) * 44);
            return (
              <div key={d.day} className="flex flex-col items-center flex-1 group relative justify-end" style={{ height: "100%" }}>
                <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-base-300 border border-base-300 rounded-lg px-2.5 py-1.5 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10 shadow-xl">
                  <div className="text-base-content/40 mb-1">{d.day}</div>
                  <div style={{ color: "#a78bfa" }}>${(d.cost_usd ?? 0).toFixed(5)}</div>
                  <div className="text-base-content/40">{((d.input_tokens ?? 0) + (d.output_tokens ?? 0)).toLocaleString()} tok</div>
                </div>
                <div
                  className="w-full rounded-t-sm"
                  style={{ height, background: "#a78bfa", opacity: (d.cost_usd ?? 0) === 0 ? 0.08 : 0.65 }}
                />
                {showLabel && (
                  <span className="text-[9px] text-base-content/20 mt-1 leading-none">{d.day.slice(5)}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

function FilterBar({
  lists, workflows, listId, workflowId, onListChange, onWorkflowChange,
}: {
  lists: { id: string; name: string }[];
  workflows: { id: string; name: string }[];
  listId: string;
  workflowId: string;
  onListChange: (id: string) => void;
  onWorkflowChange: (id: string) => void;
}) {
  const hasFilter = listId || workflowId;
  return (
    <div className="flex items-center gap-2">
      <RiFilterLine size={12} className="text-base-content/30 shrink-0" />
      <select
        value={listId}
        onChange={(e) => { onListChange(e.target.value); if (e.target.value) onWorkflowChange(""); }}
        className={`h-7 px-2.5 rounded-lg text-xs border bg-base-200 transition-colors focus:outline-none cursor-pointer ${
          listId ? "border-primary/40 text-primary" : "border-base-300/50 text-base-content/50 hover:border-base-300"
        }`}
      >
        <option value="">All lists</option>
        {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <select
        value={workflowId}
        onChange={(e) => { onWorkflowChange(e.target.value); if (e.target.value) onListChange(""); }}
        className={`h-7 px-2.5 rounded-lg text-xs border bg-base-200 transition-colors focus:outline-none cursor-pointer ${
          workflowId ? "border-primary/40 text-primary" : "border-base-300/50 text-base-content/50 hover:border-base-300"
        }`}
      >
        <option value="">All campaigns</option>
        {workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      {hasFilter && (
        <button
          onClick={() => { onListChange(""); onWorkflowChange(""); }}
          className="h-7 px-2 rounded-lg text-xs text-base-content/30 hover:text-base-content/60 hover:bg-base-300/50 transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [agentStats, setAgentStats] = useState<AgentStats | null>(null);
  // Open-core: the AI usage panel reflects the premium AI writer — hidden in the public build.
  const [hasPremium, setHasPremium] = useState(true);
  const [error, setError] = useState(false);
  const [days, setDays] = useState(7);
  const [account, setAccount] = useState<AccountRow | null>(null);
  const [listId, setListId] = useState("");
  const [workflowId, setWorkflowId] = useState("");

  useEffect(() => {
    fetch("/api/accounts")
      .then(r => r.json())
      .then((accounts: AccountRow[]) => {
        const auth = accounts.find(a => a.is_authenticated === 1);
        if (auth) setAccount(auth);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/premium-status").then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setHasPremium(!!d.hasPremium); }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ days: String(days) });
    if (listId) params.set("list_id", listId);
    if (workflowId) params.set("workflow_id", workflowId);

    Promise.all([
      fetch(`/api/dashboard/stats?${params}`).then(r => r.json()),
      fetch(`/api/dashboard/agent-stats?days=${days}`).then(r => r.json()),
    ])
      .then(([s, a]) => { if (!cancelled) { setStats(s); setAgentStats(a); } })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [days, listId, workflowId]);

  if (error) return <div className="text-error text-sm">Failed to load dashboard.</div>;

  if (!stats) {
    return (
      <div className="flex items-center gap-2 text-base-content/40 text-sm py-10">
        <span className="loading loading-spinner loading-xs" />
        Loading…
      </div>
    );
  }

  const { totals, today } = stats;
  const acceptanceRate = totals.connections_requested > 0
    ? Math.round((totals.connected / totals.connections_requested) * 100) : 0;
  const replyRate = totals.messages_sent > 0
    ? Math.round((totals.replies_received / totals.messages_sent) * 100) : 0;
  const emailReplyRate = totals.emails_sent > 0
    ? Math.round((totals.email_replies / totals.emails_sent) * 100) : 0;
  const maxFunnelValue = totals.total_targets;

  return (
    <>
    <Head>
      <title>Dashboard — Linki</title>
      <meta name="robots" content="noindex, nofollow" />
    </Head>

    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-base-content">Dashboard</h1>
          <p className="text-base-content/40 text-sm mt-0.5">Your outreach at a glance.</p>
        </div>

        <div className="flex items-center gap-3" data-tour="dashboard-filters">
          {/* Filters */}
          <FilterBar
            lists={stats.lists}
            workflows={stats.workflows}
            listId={listId}
            workflowId={workflowId}
            onListChange={setListId}
            onWorkflowChange={setWorkflowId}
          />

          {/* Today pills */}
          <div className="flex items-center gap-1.5 pl-2 border-l border-base-300/40">
            <span className="text-xs text-base-content/25 mr-0.5">Today</span>
            {[
              { label: `${today.visits_today} visits`,       color: "#5aa2ff" },
              { label: `${today.connections_today} connects`, color: "#32d583" },
              { label: `${today.messages_today} messages`,   color: "#f4b740" },
              { label: `${today.inmails_today} inmails`,     color: "#c084fc" },
            ].map(p => (
              <span
                key={p.label}
                className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
                style={{ background: `${p.color}15`, color: p.color }}
              >
                {p.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── KPI rows — LinkedIn then Email ── */}
      <div className="space-y-3">
        {/* LinkedIn */}
        <div>
          <ChannelHeader
            icon={<RiLinkedinBoxLine size={11} />}
            label="LinkedIn"
            color="#5aa2ff"
          />
          <div className="grid grid-cols-5 gap-3">
            <KpiCard
              label="Profiles visited"
              value={totals.connections_requested}
              color="#5aa2ff"
              icon={<FiEye size={13} />}
            />
            <KpiCard
              label="Connections sent"
              value={totals.connections_requested}
              sub={acceptanceRate > 0 ? `${acceptanceRate}% accepted` : undefined}
              color="#32d583"
              icon={<FiUserPlus size={13} />}
              pulse={totals.active_runs > 0}
            />
            <KpiCard
              label="Messages sent"
              value={totals.messages_sent}
              sub={replyRate > 0 ? `${replyRate}% replied` : undefined}
              color="#f4b740"
              icon={<FiMessageSquare size={13} />}
            />
            <KpiCard
              label="InMails sent"
              value={totals.inmails_sent}
              color="#e879f9"
              icon={<RiLinkedinBoxLine size={13} />}
            />
            <KpiCard
              label="LI Replies"
              value={totals.replies_received}
              color="#c084fc"
              icon={<FiRepeat size={13} />}
            />
          </div>
        </div>

        {/* Email */}
        <div>
          <ChannelHeader
            icon={<RiMailSendLine size={11} />}
            label="Email"
            color="#fb923c"
          />
          <div className="grid grid-cols-4 gap-3">
            <KpiCard
              label="Emails sent"
              value={totals.emails_sent}
              sub={emailReplyRate > 0 ? `${emailReplyRate}% replied` : undefined}
              color="#fb923c"
              icon={<RiMailSendLine size={13} />}
            />
            <KpiCard
              label="Email replies"
              value={totals.email_replies}
              color="#32d583"
              icon={<RiReplyLine size={13} />}
            />
            <KpiCard
              label="Total targets"
              value={totals.total_targets}
              color="#808080"
              icon={<FiUsers size={13} />}
            />
            <KpiCard
              label="Connected"
              value={totals.connected}
              color="#32d583"
              icon={<FiUserPlus size={13} />}
            />
          </div>
        </div>
      </div>

      {/* ── Second row: funnel left, chart right ── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "260px 1fr" }}>

        {/* Left: funnel + LinkedIn + AI */}
        <div className="space-y-3">
          {/* Funnel */}
          <div className="bg-base-200 border border-base-300/50 rounded-xl overflow-hidden" data-tour="dashboard-funnel">
            <div className="px-4 py-2.5 border-b border-base-300/30">
              <span className="text-xs font-medium text-base-content/30 uppercase tracking-widest">Funnel</span>
            </div>
            <div className="divide-y divide-base-300/20 py-1">
              <FunnelRow icon={<FiUsers size={11} />}        color="#808080" label="Targets"        value={totals.total_targets}       max={maxFunnelValue} />
              <FunnelRow icon={<FiUserPlus size={11} />}     color="#32d583" label="Connected"      value={totals.connected}           max={maxFunnelValue} />
              <FunnelRow icon={<FiRepeat size={11} />}       color="#c084fc" label="LI replies"     value={totals.replies_received}    max={maxFunnelValue} />
              <FunnelRow icon={<RiMailSendLine size={11} />} color="#fb923c" label="Emails sent"    value={totals.emails_sent}         max={maxFunnelValue} />
              <FunnelRow icon={<RiReplyLine size={11} />}    color="#32d583" label="Email replies"  value={totals.email_replies}       max={maxFunnelValue} />
            </div>
          </div>

          {/* LinkedIn account card */}
          <LinkedInCard
            accountId={account?.id}
            cachedStats={account?.li_connections != null ? {
              connections: account.li_connections!,
              pending: account.li_pending!,
              profile_views: account.li_profile_views!,
            } : null}
            cachedSyncedAt={account?.li_stats_synced_at}
          />

          {/* AI usage mini */}
          {hasPremium && agentStats && <AiUsagePanel data={agentStats.daily} days={days} />}
        </div>

        {/* Right: activity chart */}
        <ActivityChart data={stats.activity} days={days} onDaysChange={setDays} />
      </div>
    </div>
    </>
  );
}
