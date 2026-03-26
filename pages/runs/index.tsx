import Head from "next/head";
import { useState } from "react";
import { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import { RiAddLine, RiDeleteBinLine } from "react-icons/ri";

interface Run {
  id: string;
  workflow_name: string;
  list_name: string;
  account_name: string;
  status: "pending" | "running" | "paused" | "completed" | "failed";
  total_profiles: number;
  completed_profiles: number;
  created_at: string;
}

interface Workflow { id: string; name: string; }
interface List { id: string; name: string; }
interface Account { id: string; name: string; is_authenticated: number; }

const STATUS_PILL: Record<string, string> = {
  pending: "bg-base-300 text-base-content/40",
  running: "bg-info/15 text-info",
  paused: "bg-warning/15 text-warning",
  completed: "bg-success/15 text-success",
  failed: "bg-error/15 text-error",
};

export const getServerSideProps: GetServerSideProps = async () => {
  const db = getDb();
  const runs = db
    .prepare(
      `SELECT r.*,
              w.name as workflow_name,
              l.name as list_name,
              a.name as account_name,
              COUNT(rp.id) as total_profiles,
              SUM(CASE WHEN rp.state = 'completed' THEN 1 ELSE 0 END) as completed_profiles
       FROM runs r
       LEFT JOIN workflows w ON w.id = r.workflow_id
       LEFT JOIN lists l ON l.id = r.list_id
       LEFT JOIN accounts a ON a.id = r.account_id
       LEFT JOIN run_profiles rp ON rp.run_id = r.id
       GROUP BY r.id
       ORDER BY r.created_at DESC`
    )
    .all();
  const workflows = db.prepare("SELECT id, name FROM workflows ORDER BY name").all();
  const lists = db.prepare("SELECT id, name FROM lists ORDER BY name").all();
  const accounts = db.prepare("SELECT id, name, is_authenticated FROM accounts ORDER BY name").all();
  return { props: { initialRuns: runs, workflows, lists, accounts } };
};

export default function RunsPage({
  initialRuns,
  workflows,
  lists,
  accounts,
}: {
  initialRuns: Run[];
  workflows: Workflow[];
  lists: List[];
  accounts: Account[];
}) {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[]>(initialRuns);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ workflow_id: "", list_id: "", account_id: "" });
  const [loading, setLoading] = useState(false);

  async function refresh() {
    const res = await fetch("/api/runs");
    setRuns(await res.json());
  }

  async function createRun(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow_id: form.workflow_id,
        list_id: form.list_id,
        account_id: form.account_id,
      }),
    });
    setLoading(false);
    const data = await res.json();
    if (!res.ok) { toast.error(data.error ?? "Failed to create run"); return; }
    toast.success("Run created");
    setShowModal(false);
    setForm({ workflow_id: "", list_id: "", account_id: "" });
    refresh();
  }

  async function deleteRun(id: string) {
    if (!confirm("Delete this run?")) return;
    await fetch(`/api/runs/${id}`, { method: "DELETE" });
    toast.success("Run deleted");
    setRuns((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <>
    <Head>
      <title>Runs — Linki</title>
      <meta name="description" content="Workflow execution history and status." />
      <meta name="robots" content="noindex, nofollow" />
    </Head>
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Runs</h1>
          <p className="text-base-content/50 text-sm mt-0.5">Workflow executions against lead lists</p>
        </div>
        <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors" onClick={() => setShowModal(true)}>
          <RiAddLine size={15} /> New Run
        </button>
      </div>

      {runs.length === 0 ? (
        <div className="text-center py-16 text-base-content/40 text-sm">
          No runs yet. Create a run to start automating outreach.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-base-300/50">
          <table className="table w-full text-sm">
            <thead>
              <tr className="border-base-300/50 text-base-content/50 text-xs uppercase tracking-wide">
                <th>Workflow</th>
                <th>List</th>
                <th>Account</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr
                  key={r.id}
                  className="border-base-300/30 hover:bg-base-200/50 cursor-pointer"
                  onClick={() => router.push(`/runs/${r.id}`)}
                >
                  <td className="font-medium">{r.workflow_name ?? "—"}</td>
                  <td className="text-base-content/60">{r.list_name ?? "—"}</td>
                  <td className="text-base-content/60">{r.account_name ?? "—"}</td>
                  <td>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_PILL[r.status]}`}>{r.status}</span>
                  </td>
                  <td className="text-base-content/50 text-xs">
                    {r.completed_profiles ?? 0}/{r.total_profiles ?? 0}
                  </td>
                  <td className="text-base-content/40 text-xs">
                    {new Date(r.created_at).toLocaleDateString()}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        className="inline-flex items-center px-2 py-1 rounded-md text-xs bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors"
                        onClick={() => deleteRun(r.id)}
                      >
                        <RiDeleteBinLine size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-200 border border-base-300/50 max-w-md">
            <h3 className="font-semibold text-base mb-4">New Run</h3>
            <form onSubmit={createRun} className="flex flex-col gap-3">
              <div>
                <label className="label text-xs text-base-content/50 pb-1">Workflow</label>
                <select
                  className="w-full px-3 py-1.5 rounded-lg text-sm bg-base-300 border border-base-300/80 text-base-content focus:outline-none focus:border-primary/50 cursor-pointer"
                  value={form.workflow_id}
                  onChange={(e) => setForm({ ...form, workflow_id: e.target.value })}
                  required
                >
                  <option value="">Select workflow...</option>
                  {workflows.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label text-xs text-base-content/50 pb-1">List</label>
                <select
                  className="w-full px-3 py-1.5 rounded-lg text-sm bg-base-300 border border-base-300/80 text-base-content focus:outline-none focus:border-primary/50 cursor-pointer"
                  value={form.list_id}
                  onChange={(e) => setForm({ ...form, list_id: e.target.value })}
                  required
                >
                  <option value="">Select list...</option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label text-xs text-base-content/50 pb-1">Account</label>
                <select
                  className="w-full px-3 py-1.5 rounded-lg text-sm bg-base-300 border border-base-300/80 text-base-content focus:outline-none focus:border-primary/50 cursor-pointer"
                  value={form.account_id}
                  onChange={(e) => setForm({ ...form, account_id: e.target.value })}
                  required
                >
                  <option value="">Select account...</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id} disabled={!a.is_authenticated}>
                      {a.name} {!a.is_authenticated ? "(not authenticated)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="modal-action mt-2">
                <button type="button" className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-300/50 transition-colors" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50" disabled={loading}>
                  {loading ? <span className="loading loading-spinner loading-xs" /> : "Create Run"}
                </button>
              </div>
            </form>
          </div>
          <div className="modal-backdrop" onClick={() => setShowModal(false)} />
        </div>
      )}
    </div>
    </>
  );
}
