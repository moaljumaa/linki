import Head from "next/head";
import { useEffect, useState } from "react";
import { FiUserPlus, FiMessageSquare, FiEye, FiRepeat, FiUsers, FiRefreshCw } from "react-icons/fi";

interface DashboardStats {
  totals: {
    total_targets: number;
    connections_requested: number;
    connected: number;
    messages_sent: number;
    replies_received: number;
    active_runs: number;
    total_lists: number;
    total_workflows: number;
  };
  today: {
    visits_today: number;
    connections_today: number;
    messages_today: number;
  };
  activity: { day: string; visits: number; connections: number; messages: number }[];
}

const CHART_COLORS = {
  visits: "#5aa2ff",
  connections: "#32d583",
  messages: "#f4b740",
};

const DAY_OPTIONS = [
  { label: "7d", value: 7 },
  { label: "14d", value: 14 },
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
];

function ActivityChart({
  data, days, onDaysChange,
}: {
  data: DashboardStats["activity"];
  days: number;
  onDaysChange: (d: number) => void;
}) {
  const maxVal = Math.max(...data.flatMap(d => [d.visits, d.connections, d.messages]), 1);
  const labelEvery = days <= 7 ? 1 : days <= 14 ? 2 : days <= 30 ? 5 : 15;

  return (
    <div className="bg-base-200 border border-base-300/50 rounded-xl p-5 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-base-content">Activity</span>
          <div className="flex items-center gap-3 text-xs text-base-content/35">
            {(["visits", "connections", "messages"] as const).map(k => (
              <span key={k} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm inline-block" style={{ background: CHART_COLORS[k] }} />
                {k.charAt(0).toUpperCase() + k.slice(1)}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-0.5 bg-base-300/60 rounded-lg p-0.5">
          {DAY_OPTIONS.map(o => (
            <button
              key={o.value}
              onClick={() => onDaysChange(o.value)}
              className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                days === o.value
                  ? "bg-base-100 text-base-content font-medium shadow-sm"
                  : "text-base-content/40 hover:text-base-content/70"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-end gap-[3px] flex-1 min-h-25">
        {data.map((d, i) => {
          const showLabel = i % labelEvery === 0;
          return (
            <div key={d.day} className="flex flex-col items-center flex-1 group relative">
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-base-300 border border-base-300/70 rounded-lg px-2.5 py-1.5 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10 shadow-lg">
                <div className="text-base-content/40 mb-1">{d.day}</div>
                <div style={{ color: CHART_COLORS.visits }}>{d.visits} visits</div>
                <div style={{ color: CHART_COLORS.connections }}>{d.connections} connections</div>
                <div style={{ color: CHART_COLORS.messages }}>{d.messages} messages</div>
              </div>
              <div className="flex items-end gap-[1px] w-full">
                {(["visits", "connections", "messages"] as const).map(key => (
                  <div
                    key={key}
                    className="flex-1 rounded-t-xs"
                    style={{
                      height: `${Math.max(2, (d[key] / maxVal) * 90)}px`,
                      background: CHART_COLORS[key],
                      opacity: d[key] === 0 ? 0.1 : 0.8,
                    }}
                  />
                ))}
              </div>
              {showLabel && (
                <span className="text-[9px] text-base-content/20 mt-1 leading-none">{d.day.slice(5)}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricRow({
  icon, color, label, value, sub,
}: {
  icon: React.ReactNode;
  color: string;
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-base-300/30 last:border-0">
      <div className="flex items-center gap-2.5">
        <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: `${color}18` }}>
          <span style={{ color }}>{icon}</span>
        </span>
        <span className="text-sm text-base-content/60">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-sm font-semibold text-base-content tabular-nums">{value.toLocaleString()}</span>
        {sub && <span className="text-xs text-base-content/30">{sub}</span>}
      </div>
    </div>
  );
}

interface LiStats {
  connections: number;
  pending: number;
  profile_views: number;
}

function LinkedInStatsCard({
  accountId,
  cachedStats,
  cachedSyncedAt,
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
    setSyncing(true);
    setSyncError(null);
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

  const syncLabel = syncedAt
    ? `Synced ${new Date(syncedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
    : null;

  const stats = liStats
    ? [
        { label: "Connections", value: liStats.connections, color: "#32d583" },
        { label: "Pending sent", value: liStats.pending, color: "#f4b740" },
        { label: "Profile views", value: liStats.profile_views, color: "#5aa2ff" },
      ]
    : [
        { label: "Connections", value: null, color: "#32d583" },
        { label: "Pending sent", value: null, color: "#f4b740" },
        { label: "Profile views", value: null, color: "#5aa2ff" },
      ];

  return (
    <div className="bg-base-200 border border-base-300/50 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-base-content/40 uppercase tracking-wide">LinkedIn account</span>
          {syncLabel && <span className="text-[10px] text-base-content/25">{syncLabel}</span>}
        </div>
        {accountId && (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            <FiRefreshCw size={11} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing…" : "Sync"}
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {stats.map(s => (
          <div key={s.label} className="flex flex-col gap-1">
            {s.value !== null
              ? <span className="text-lg font-semibold tabular-nums" style={{ color: s.color }}>{s.value.toLocaleString()}</span>
              : <span className="text-lg font-semibold text-base-content/15">—</span>
            }
            <span className="text-xs text-base-content/35">{s.label}</span>
          </div>
        ))}
      </div>

      {syncError && <p className="text-xs text-error mt-2">{syncError}</p>}
      {!accountId && <p className="text-xs text-base-content/25 mt-1">No authenticated account found.</p>}
    </div>
  );
}

interface AccountRow {
  id: string;
  is_authenticated: number;
  li_connections: number | null;
  li_pending: number | null;
  li_profile_views: number | null;
  li_stats_synced_at: string | null;
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState(false);
  const [days, setDays] = useState(7);
  const [account, setAccount] = useState<AccountRow | null>(null);

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
    setStats(null);
    fetch(`/api/dashboard/stats?days=${days}`)
      .then(r => r.json())
      .then(setStats)
      .catch(() => setError(true));
  }, [days]);

  if (error) return <div className="text-error text-sm">Failed to load dashboard.</div>;

  if (!stats) {
    return (
      <div className="flex items-center gap-2 text-base-content/40 text-sm">
        <span className="loading loading-spinner loading-xs" />
        Loading...
      </div>
    );
  }

  const { totals, today } = stats;
  const acceptanceRate = totals.connections_requested > 0
    ? Math.round((totals.connected / totals.connections_requested) * 100)
    : 0;
  const replyRate = totals.messages_sent > 0
    ? Math.round((totals.replies_received / totals.messages_sent) * 100)
    : 0;

  return (
    <>
    <Head>
      <title>Dashboard — Linki</title>
      <meta name="description" content="Your LinkedIn outreach at a glance. Track visits, connections, messages, and replies." />
      <meta name="robots" content="noindex, nofollow" />
    </Head>
    <div className="space-y-5">
      {/* Header + today pills */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-base-content mb-0.5">Dashboard</h1>
          <p className="text-base-content/40 text-sm">Your outreach at a glance.</p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-base-content/30">Today</span>
          {[
            { label: `${today.visits_today} visits`, color: CHART_COLORS.visits },
            { label: `${today.connections_today} connections`, color: CHART_COLORS.connections },
            { label: `${today.messages_today} messages`, color: CHART_COLORS.messages },
          ].map(p => (
            <span
              key={p.label}
              className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
              style={{ background: `${p.color}14`, color: p.color }}
            >
              {p.label}
            </span>
          ))}
          {acceptanceRate > 0 && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-success/15 text-success">
              {acceptanceRate}% accepted
            </span>
          )}
          {replyRate > 0 && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-primary/15 text-primary">
              {replyRate}% replied
            </span>
          )}
        </div>
      </div>

      {/* Two-column body */}
      <div className="grid grid-cols-[280px_1fr] gap-4 items-start">

        {/* Left column: funnel + LinkedIn stats */}
        <div className="space-y-4">
          <div className="bg-base-200 border border-base-300/50 rounded-xl px-4 py-1">
            <MetricRow icon={<FiUsers size={13} />} color="#a0a0a0" label="Targets" value={totals.total_targets} sub={`${totals.total_lists} lists`} />
            <MetricRow icon={<FiEye size={13} />} color={CHART_COLORS.visits} label="Profiles visited" value={totals.connections_requested} />
            <MetricRow icon={<FiUserPlus size={13} />} color={CHART_COLORS.connections} label="Connections sent" value={totals.connections_requested} sub={acceptanceRate > 0 ? `${acceptanceRate}% accepted` : undefined} />
            <MetricRow icon={<FiMessageSquare size={13} />} color={CHART_COLORS.messages} label="Messages sent" value={totals.messages_sent} sub={replyRate > 0 ? `${replyRate}% replied` : undefined} />
            <MetricRow icon={<FiRepeat size={13} />} color="#c084fc" label="Replies received" value={totals.replies_received} />
          </div>

          <LinkedInStatsCard
            accountId={account?.id}
            cachedStats={account && account.li_connections !== null ? {
              connections: account.li_connections!,
              pending: account.li_pending!,
              profile_views: account.li_profile_views!,
            } : null}
            cachedSyncedAt={account?.li_stats_synced_at}
          />
        </div>

        {/* Right column: chart fills remaining space */}
        <ActivityChart data={stats.activity} days={days} onDaysChange={setDays} />
      </div>
    </div>
    </>
  );
}
