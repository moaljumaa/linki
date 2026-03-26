import Head from "next/head";
import { useState, useEffect, useCallback } from "react";
import { GetServerSideProps } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import { RiArrowLeftLine, RiPlayLine, RiPauseLine } from "react-icons/ri";

interface RunProfile {
  id: number;
  target_id: number;
  full_name: string | null;
  linkedin_url: string | null;
  title: string | null;
  company: string | null;
  state: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  current_step: number;
  next_step_at: string | null;
  error_message: string | null;
}

interface Log {
  id: number;
  level: "info" | "warn" | "error";
  message: string;
  target_name: string | null;
  created_at: string;
}

interface RunDetail {
  id: number;
  workflow_name: string;
  list_name: string;
  account_name: string;
  status: "pending" | "running" | "paused" | "completed" | "failed";
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  profiles: RunProfile[];
  logs: Log[];
}

const STATUS_BADGE: Record<string, string> = {
  pending: "badge-ghost",
  running: "badge-info",
  paused: "badge-warning",
  completed: "badge-success",
  failed: "badge-error",
};

const PROFILE_STATE_BADGE: Record<string, string> = {
  pending: "badge-ghost",
  in_progress: "badge-info",
  completed: "badge-success",
  failed: "badge-error",
  skipped: "badge-ghost",
};

const LOG_LEVEL_COLOR: Record<string, string> = {
  info: "text-base-content/60",
  warn: "text-warning",
  error: "text-error",
};

export const getServerSideProps: GetServerSideProps = async ({ params }) => {
  const db = getDb();
  const id = Number(params?.id);

  const run = db
    .prepare(
      `SELECT r.*,
              w.name as workflow_name,
              l.name as list_name,
              a.name as account_name
       FROM runs r
       LEFT JOIN workflows w ON w.id = r.workflow_id
       LEFT JOIN lists l ON l.id = r.list_id
       LEFT JOIN accounts a ON a.id = r.account_id
       WHERE r.id = ?`
    )
    .get(id);
  if (!run) return { notFound: true };

  const profiles = db
    .prepare(
      `SELECT rp.*, t.full_name, t.linkedin_url, t.title, t.company
       FROM run_profiles rp
       LEFT JOIN targets t ON t.id = rp.target_id
       WHERE rp.run_id = ?
       ORDER BY rp.id`
    )
    .all(id);

  const logs = db
    .prepare(
      `SELECT lg.*, t.full_name as target_name
       FROM logs lg
       LEFT JOIN targets t ON t.id = lg.target_id
       WHERE lg.run_id = ?
       ORDER BY lg.created_at DESC
       LIMIT 100`
    )
    .all(id);

  return { props: { initialRun: { ...run, profiles, logs } } };
};

export default function RunDetailPage({ initialRun }: { initialRun: RunDetail }) {
  const [run, setRun] = useState<RunDetail>(initialRun);
  const [acting, setActing] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/runs/${initialRun.id}`);
    if (res.ok) setRun(await res.json());
  }, [initialRun.id]);

  // Poll every 4 seconds when running
  useEffect(() => {
    if (run.status !== "running") return;
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, [run.status, refresh]);

  async function startRun() {
    setActing(true);
    const res = await fetch(`/api/runs/${run.id}/start`, { method: "POST" });
    setActing(false);
    const data = await res.json();
    if (!res.ok) { toast.error(data.error ?? "Failed to start"); return; }
    toast.success("Run started");
    refresh();
  }

  async function pauseRun() {
    setActing(true);
    const res = await fetch(`/api/runs/${run.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "paused" }),
    });
    setActing(false);
    if (!res.ok) { toast.error("Failed to pause"); return; }
    toast.success("Run paused");
    refresh();
  }

  const total = run.profiles.length;
  const completed = run.profiles.filter((p) => p.state === "completed").length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <>
    <Head>
      <title>{run.workflow_name} — Runs — Linki</title>
      <meta name="robots" content="noindex, nofollow" />
    </Head>
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/runs" className="btn btn-ghost btn-sm btn-square">
          <RiArrowLeftLine size={16} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">{run.workflow_name} → {run.list_name}</h1>
          <p className="text-base-content/50 text-sm mt-0.5">{run.account_name}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${STATUS_BADGE[run.status]}`}>{run.status}</span>
          {(run.status === "pending" || run.status === "paused") && (
            <button className="btn btn-success btn-sm gap-1.5" onClick={startRun} disabled={acting}>
              <RiPlayLine size={14} /> Start
            </button>
          )}
          {run.status === "running" && (
            <button className="btn btn-warning btn-sm gap-1.5" onClick={pauseRun} disabled={acting}>
              <RiPauseLine size={14} /> Pause
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-base-200 border border-base-300/50 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-base-content/60">Progress</span>
          <span className="text-sm font-medium">{completed}/{total} profiles</span>
        </div>
        <progress className="progress progress-primary w-full" value={progress} max={100} />
      </div>

      {/* Profiles table */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-base-content/60 uppercase tracking-wide mb-3">Profiles</h2>
        {run.profiles.length === 0 ? (
          <div className="text-base-content/40 text-sm text-center py-8">No profiles in this run.</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-base-300/50">
            <table className="table w-full text-sm">
              <thead>
                <tr className="border-base-300/50 text-base-content/50 text-xs uppercase tracking-wide">
                  <th>Name</th>
                  <th>Title</th>
                  <th>Company</th>
                  <th>State</th>
                  <th>Step</th>
                  <th>Next at</th>
                </tr>
              </thead>
              <tbody>
                {run.profiles.map((p) => (
                  <tr key={p.id} className="border-base-300/30 hover:bg-base-200/50">
                    <td className="font-medium">
                      {p.linkedin_url ? (
                        <a href={p.linkedin_url} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
                          {p.full_name ?? "—"}
                        </a>
                      ) : (p.full_name ?? "—")}
                    </td>
                    <td className="text-base-content/60 max-w-[180px] truncate">{p.title ?? "—"}</td>
                    <td className="text-base-content/60">{p.company ?? "—"}</td>
                    <td>
                      <span className={`badge badge-sm ${PROFILE_STATE_BADGE[p.state]}`}>{p.state}</span>
                    </td>
                    <td className="text-base-content/50 text-xs">{p.current_step}</td>
                    <td className="text-base-content/40 text-xs">
                      {p.next_step_at ? new Date(p.next_step_at).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Logs */}
      <div>
        <h2 className="text-sm font-semibold text-base-content/60 uppercase tracking-wide mb-3">Logs</h2>
        {run.logs.length === 0 ? (
          <div className="text-base-content/40 text-sm text-center py-8">No logs yet.</div>
        ) : (
          <div className="bg-base-200 border border-base-300/50 rounded-lg overflow-hidden">
            <div className="font-mono text-xs divide-y divide-base-300/30">
              {run.logs.map((log) => (
                <div key={log.id} className="flex items-start gap-3 px-4 py-2">
                  <span className="text-base-content/30 shrink-0 pt-0.5">
                    {new Date(log.created_at).toLocaleTimeString()}
                  </span>
                  <span className={`uppercase shrink-0 font-medium ${LOG_LEVEL_COLOR[log.level]}`}>
                    {log.level}
                  </span>
                  {log.target_name && (
                    <span className="text-base-content/50 shrink-0">[{log.target_name}]</span>
                  )}
                  <span className="text-base-content/70">{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
