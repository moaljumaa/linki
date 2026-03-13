import Head from "next/head";
import { useState } from "react";
import { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import {
  RiAddLine,
  RiDeleteBinLine,
  RiArrowRightLine,
  RiPlayLine,
  RiPauseLine,
  RiTimeLine,
  RiEyeLine,
  RiLinkedinBoxLine,
  RiMessage2Line,
  RiRocketLine,
  RiTeamLine,
  RiUserStarLine,
  RiMailSendLine,
  RiSuitcaseLine,
  RiGlobalLine,
  RiMegaphoneLine,
  RiShakeHandsLine,
  RiLightbulbLine,
  RiCrosshairLine,
} from "react-icons/ri";

interface WorkflowCard {
  id: string;
  name: string;
  description: string | null;
  step_count: number;
  action_step_count: number;
  total_prospects: number;
  completed_prospects: number;
  connections_sent: number;
  connections_accepted: number;
  active_run_id: string | null;
  active_status: string | null;
  created_at: string;
  step_types: string;
}

const CARD_COLORS = [
  { bg: "bg-blue-500/10", border: "border-blue-500/20", icon: "text-blue-400" },
  { bg: "bg-violet-500/10", border: "border-violet-500/20", icon: "text-violet-400" },
  { bg: "bg-emerald-500/10", border: "border-emerald-500/20", icon: "text-emerald-400" },
  { bg: "bg-orange-500/10", border: "border-orange-500/20", icon: "text-orange-400" },
  { bg: "bg-pink-500/10", border: "border-pink-500/20", icon: "text-pink-400" },
  { bg: "bg-cyan-500/10", border: "border-cyan-500/20", icon: "text-cyan-400" },
  { bg: "bg-amber-500/10", border: "border-amber-500/20", icon: "text-amber-400" },
  { bg: "bg-rose-500/10", border: "border-rose-500/20", icon: "text-rose-400" },
];

const CARD_ICONS = [
  RiRocketLine, RiTeamLine, RiUserStarLine, RiMailSendLine,
  RiSuitcaseLine, RiGlobalLine, RiMegaphoneLine, RiShakeHandsLine,
  RiLightbulbLine, RiCrosshairLine,
];

const STEP_ICON: Record<string, React.ElementType> = {
  visit: RiEyeLine,
  connect: RiLinkedinBoxLine,
  message: RiMessage2Line,
  delay: RiTimeLine,
};
const STEP_LABEL: Record<string, string> = {
  visit: "Visit",
  connect: "Connect",
  message: "Message",
};

export const getServerSideProps: GetServerSideProps = async () => {
  const db = getDb();

  // Steps subquery — isolated to avoid row multiplication when joined with runs
  const stepRows = db.prepare(
    `SELECT workflow_id,
       GROUP_CONCAT(step_type ORDER BY step_order) as step_types,
       COUNT(*) as step_count,
       SUM(CASE WHEN step_type != 'delay' THEN 1 ELSE 0 END) as action_step_count
     FROM workflow_steps
     GROUP BY workflow_id`
  ).all() as { workflow_id: string; step_types: string; step_count: number; action_step_count: number }[];

  const stepMap = Object.fromEntries(stepRows.map(s => [s.workflow_id, s]));

  // Prospects/runs subquery — separate from steps to avoid GROUP_CONCAT multiplication
  const prospectRows = db.prepare(
    `SELECT r.workflow_id,
       COUNT(DISTINCT rp.id) as total_prospects,
       SUM(CASE WHEN rp.state = 'completed' THEN 1 ELSE 0 END) as completed_prospects,
       COUNT(DISTINCT CASE WHEN t.connection_requested_at IS NOT NULL THEN rp.target_id END) as connections_sent,
       COUNT(DISTINCT CASE WHEN t.connected_at IS NOT NULL THEN rp.target_id END) as connections_accepted,
       MAX(CASE WHEN r.status = 'running' THEN r.id ELSE NULL END) as active_run_id,
       MAX(CASE WHEN r.status IN ('running','paused') THEN r.status ELSE NULL END) as active_status
     FROM runs r
     LEFT JOIN run_profiles rp ON rp.run_id = r.id
     LEFT JOIN targets t ON t.id = rp.target_id
     GROUP BY r.workflow_id`
  ).all() as {
    workflow_id: string;
    total_prospects: number;
    completed_prospects: number;
    connections_sent: number;
    connections_accepted: number;
    active_run_id: string | null;
    active_status: string | null;
  }[];

  const prospectMap = Object.fromEntries(prospectRows.map(r => [r.workflow_id, r]));

  const workflows = db.prepare(
    "SELECT id, name, description, created_at FROM workflows ORDER BY created_at DESC"
  ).all() as { id: string; name: string; description: string | null; created_at: string }[];

  const merged: WorkflowCard[] = workflows.map(w => ({
    ...w,
    step_count: stepMap[w.id]?.step_count ?? 0,
    action_step_count: stepMap[w.id]?.action_step_count ?? 0,
    step_types: stepMap[w.id]?.step_types ?? "",
    total_prospects: prospectMap[w.id]?.total_prospects ?? 0,
    completed_prospects: prospectMap[w.id]?.completed_prospects ?? 0,
    connections_sent: prospectMap[w.id]?.connections_sent ?? 0,
    connections_accepted: prospectMap[w.id]?.connections_accepted ?? 0,
    active_run_id: prospectMap[w.id]?.active_run_id ?? null,
    active_status: prospectMap[w.id]?.active_status ?? null,
  }));

  return { props: { initialWorkflows: merged } };
};

export default function WorkflowsPage({ initialWorkflows }: { initialWorkflows: WorkflowCard[] }) {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowCard[]>(initialWorkflows);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const [loading, setLoading] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  async function createWorkflow(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (!res.ok) { toast.error("Failed to create campaign"); return; }
    const { id } = await res.json();
    router.push(`/workflows/${id}?setup=1`);
  }

  async function deleteWorkflow(id: string) {
    await fetch(`/api/workflows/${id}`, { method: "DELETE" });
    toast.success("Campaign deleted");
    setWorkflows((prev) => prev.filter((w) => w.id !== id));
    setDeleteId(null);
  }

  async function pauseRun(workflowId: string, runId: string) {
    await fetch(`/api/runs/${runId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "paused" }) });
    toast.success("Paused");
    setWorkflows((prev) => prev.map((w) => w.id === workflowId ? { ...w, active_status: "paused" } : w));
  }

  async function resumeRun(workflowId: string, runId: string) {
    await fetch(`/api/runs/${runId}/start`, { method: "POST" });
    toast.success("Resumed");
    setWorkflows((prev) => prev.map((w) => w.id === workflowId ? { ...w, active_status: "running" } : w));
  }

  return (
    <>
    <Head>
      <title>Campaigns — Linki</title>
      <meta name="description" content="Manage your LinkedIn outreach campaigns and sequences." />
      <meta name="robots" content="noindex, nofollow" />
    </Head>
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Campaigns</h1>
          <p className="text-base-content/50 text-sm mt-0.5">Your outreach sequences</p>
        </div>
        <button
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors"
          onClick={() => setShowModal(true)}
        >
          <RiAddLine size={15} /> New Campaign
        </button>
      </div>

      {workflows.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-base-300/60 rounded-xl text-base-content/30 text-sm">
          No campaigns yet. Create one to start your outreach.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {workflows.map((w) => {
            const colorIdx = w.id.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
            const style = CARD_COLORS[colorIdx % CARD_COLORS.length];
            const Icon = CARD_ICONS[colorIdx % CARD_ICONS.length];
            const stepTypes = w.step_types ? w.step_types.split(",") : [];
            // Collapse duplicate adjacent step types, skip delays (shown implicitly via arrows)
            const actionSteps: string[] = [];
            for (const t of stepTypes) {
              if (t === "delay") continue;
              if (actionSteps[actionSteps.length - 1] !== t) actionSteps.push(t);
            }
            const acceptanceRate = w.connections_sent > 0
              ? Math.round((w.connections_accepted / w.connections_sent) * 100)
              : null;
            const progress = w.total_prospects > 0
              ? Math.round((w.completed_prospects / w.total_prospects) * 100)
              : 0;
            const isRunning = w.active_status === "running";
            const isPaused = w.active_status === "paused";

            return (
              <div
                key={w.id}
                className="bg-base-200 border border-base-300/50 rounded-xl p-5 cursor-pointer hover:border-base-300 transition-all hover:shadow-sm flex flex-col gap-4"
                onClick={() => router.push(`/workflows/${w.id}`)}
              >
                {/* Header: icon + name + status */}
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${style.bg} ${style.border}`}>
                    <Icon size={18} className={style.icon} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-sm truncate">{w.name}</span>
                      {isRunning && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-success/15 text-success shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse inline-block" />
                          Active
                        </span>
                      )}
                      {isPaused && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-warning/15 text-warning shrink-0">
                          Paused
                        </span>
                      )}
                    </div>
                    {/* Step sequence */}
                    {actionSteps.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        {actionSteps.map((type, i) => {
                          const StepIcon = STEP_ICON[type] ?? RiEyeLine;
                          return (
                            <span key={i} className="flex items-center gap-1">
                              {i > 0 && <RiArrowRightLine size={9} className="text-base-content/25" />}
                              <span className="inline-flex items-center gap-1 text-xs text-base-content/40">
                                <StepIcon size={11} />
                                {STEP_LABEL[type] ?? type}
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {actionSteps.length === 0 && (
                      <p className="text-xs text-base-content/30">No steps configured</p>
                    )}
                  </div>
                </div>

                {/* Progress */}
                {w.total_prospects > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs text-base-content/50">
                      <span>{w.completed_prospects} / {w.total_prospects} prospects done</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-base-300/60 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                    </div>
                    {(w.connections_sent > 0 || acceptanceRate !== null) && (
                      <div className="flex items-center gap-3 text-xs text-base-content/35 mt-0.5">
                        {w.connections_sent > 0 && <span>{w.connections_sent} connected</span>}
                        {acceptanceRate !== null && <span className="text-success">{acceptanceRate}% accepted</span>}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-base-content/30">No prospects enrolled yet</p>
                )}

                {/* Footer */}
                <div
                  className="flex items-center justify-between pt-1 border-t border-base-300/30"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-xs text-base-content/30">
                    {w.action_step_count} step{w.action_step_count !== 1 ? "s" : ""}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {isRunning && w.active_run_id && (
                      <button
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-warning/10 text-warning border border-warning/20 hover:bg-warning/20 transition-colors"
                        onClick={() => pauseRun(w.id, w.active_run_id!)}
                      >
                        <RiPauseLine size={11} /> Pause
                      </button>
                    )}
                    {isPaused && w.active_run_id && (
                      <button
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
                        onClick={() => resumeRun(w.id, w.active_run_id!)}
                      >
                        <RiPlayLine size={11} /> Resume
                      </button>
                    )}
                    <button
                      className="inline-flex items-center p-1.5 rounded-md text-xs bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors"
                      onClick={() => setDeleteId(w.id)}
                    >
                      <RiDeleteBinLine size={12} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New campaign modal */}
      {showModal && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-200 border border-base-300/50 max-w-md">
            <h3 className="font-semibold text-base mb-4">New Campaign</h3>
            <form onSubmit={createWorkflow} className="flex flex-col gap-3">
              <div>
                <label className="label text-xs text-base-content/50 pb-1">Campaign name</label>
                <input
                  className="input input-bordered input-sm w-full bg-base-300/50"
                  placeholder="e.g. SaaS Founders Q1"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="label text-xs text-base-content/50 pb-1">Description (optional)</label>
                <input
                  className="input input-bordered input-sm w-full bg-base-300/50"
                  placeholder="e.g. Visit → Connect → Message after 2 days"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="modal-action mt-2">
                <button type="button" className="px-4 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-300 transition-colors" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50" disabled={loading}>
                  {loading ? <span className="loading loading-spinner loading-xs" /> : "Create"}
                </button>
              </div>
            </form>
          </div>
          <div className="modal-backdrop" onClick={() => setShowModal(false)} />
        </div>
      )}

      {/* Delete confirm */}
      {deleteId !== null && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-200 border border-base-300/50 max-w-sm">
            <h3 className="font-semibold text-base mb-2">Delete campaign?</h3>
            <p className="text-sm text-base-content/60 mb-4">
              This will permanently delete the campaign and all its history. Cannot be undone.
            </p>
            <div className="modal-action">
              <button className="px-4 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-300 transition-colors" onClick={() => setDeleteId(null)}>Cancel</button>
              <button className="px-4 py-1.5 rounded-lg text-sm font-medium bg-error/15 text-error border border-error/25 hover:bg-error/25 transition-colors" onClick={() => deleteWorkflow(deleteId)}>Delete</button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setDeleteId(null)} />
        </div>
      )}
    </div>
    </>
  );
}
