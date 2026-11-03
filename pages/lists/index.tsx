import Head from "next/head";
import { useState, useEffect, useRef } from "react";
import { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import { RiAddLine, RiDeleteBinLine, RiCloseLine, RiCalendarLine } from "react-icons/ri";

interface List {
  id: string;
  name: string;
  description: string | null;
  target_count: number;
  created_at: string;
  active_run_id: string | null;
  active_run_status: string | null;
  active_workflow_name: string | null;
}

interface ImportJob {
  id: string;
  list_id: string;
  list_name?: string;
  status: string;
  phase: string | null;
  page: number;
  total_pages: number;
  count: number;
  total: number;
  imported: number;
  scheduled_for: string | null;
  start_page: number;
  batch_index: number;
  started_at: string;
  finished_at: string | null;
}

export const getServerSideProps: GetServerSideProps = async () => {
  const db = getDb();
  const lists = db
    .prepare(
      `SELECT l.*, COUNT(lt.target_id) as target_count,
              ar.id as active_run_id,
              ar.status as active_run_status,
              w.name as active_workflow_name
       FROM lists l
       LEFT JOIN list_targets lt ON lt.list_id = l.id
       LEFT JOIN runs ar ON ar.list_id = l.id AND ar.status IN ('running', 'paused')
       LEFT JOIN workflows w ON w.id = ar.workflow_id
       GROUP BY l.id
       ORDER BY l.created_at DESC`
    )
    .all();
  return { props: { initialLists: lists } };
};

export default function ListsPage({ initialLists }: { initialLists: List[] }) {
  const router = useRouter();
  const [lists, setLists] = useState<List[]>(initialLists);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [dailyCap, setDailyCap] = useState(1500);
  const [importedToday, setImportedToday] = useState(0);
  const prevRunningRef = useRef(0);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const r = await fetch("/api/imports");
        const data = await r.json();
        if (!alive) return;
        setJobs(data.jobs ?? []);
        setDailyCap(data.dailyCap ?? 1500);
        setImportedToday(data.importedToday ?? 0);
        // A batch just finished → refresh list counts
        const running = (data.jobs ?? []).filter((j: ImportJob) => j.status === "running").length;
        if (running < prevRunningRef.current) {
          fetch("/api/lists").then((lr) => lr.json()).then((d) => { if (alive) setLists(d); }).catch(() => {});
        }
        prevRunningRef.current = running;
      } catch { /* ignore */ }
    }
    poll();
    const id = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  async function cancelImport(id: string) {
    if (!confirm("Cancel this import? A running batch stops at its next page.")) return;
    await fetch(`/api/imports/${id}/cancel`, { method: "POST" });
    toast.success("Import canceled");
  }

  const activeJobs = jobs.filter((j) => j.status === "running" || j.status === "scheduled");
  const runningByList: Record<string, ImportJob> = {};
  for (const j of jobs) if (j.status === "running") runningByList[j.list_id] = j;

  async function refresh() {
    const res = await fetch("/api/lists");
    setLists(await res.json());
  }

  async function createList(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (!res.ok) { toast.error("Failed to create list"); return; }
    toast.success("List created");
    setShowModal(false);
    setForm({ name: "", description: "" });
    refresh();
  }

  async function deleteList(id: string) {
    if (!confirm("Delete this list and all its leads?")) return;
    await fetch(`/api/lists/${id}`, { method: "DELETE" });
    toast.success("List deleted");
    setLists((prev) => prev.filter((l) => l.id !== id));
  }

  return (
    <>
    <Head>
      <title>Lists — Linki</title>
      <meta name="description" content="Lead lists imported from LinkedIn Sales Navigator." />
      <meta name="robots" content="noindex, nofollow" />
    </Head>
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Lists</h1>
          <p className="text-base-content/50 text-sm mt-0.5">Lead lists imported from Sales Navigator</p>
        </div>
        <button data-tour="lists-new" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors" onClick={() => setShowModal(true)}>
          <RiAddLine size={15} /> New List
        </button>
      </div>

      {/* Import jobs panel */}
      {activeJobs.length > 0 && (
        <div className="mb-6 rounded-lg border border-base-300/50 bg-base-200/40 p-4" data-tour="lists-jobs">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Import jobs</h2>
            <span className="text-xs text-base-content/50">
              {importedToday} / {dailyCap} contacts imported today
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {activeJobs.map((j) => {
              const pct = j.total > 0 ? Math.round((j.count / j.total) * 100) : 0;
              const scheduled = j.status === "scheduled";
              return (
                <div key={j.id} className="flex items-center gap-3 rounded-md bg-base-300/30 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{j.list_name ?? "—"}</span>
                      {j.batch_index > 1 && (
                        <span className="text-xs text-base-content/40">batch {j.batch_index}</span>
                      )}
                      {scheduled ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-warning/15 text-warning">
                          <RiCalendarLine size={11} /> Scheduled {j.scheduled_for}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-info/15 text-info">
                          <span className="loading loading-spinner" style={{ width: 9, height: 9 }} /> Scraping {pct}%
                        </span>
                      )}
                    </div>
                    {!scheduled && (
                      <div className="mt-1.5 w-full bg-base-300 rounded-full h-1">
                        <div className="bg-primary h-1 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                    <span className="text-xs text-base-content/40">
                      {scheduled
                        ? `Resumes at page ${j.start_page} — capped at ${dailyCap}/day`
                        : `${j.count} / ${j.total} this batch`}
                    </span>
                  </div>
                  <button
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors shrink-0"
                    onClick={() => cancelImport(j.id)}
                  >
                    <RiCloseLine size={12} /> Cancel
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {lists.length === 0 ? (
        <div className="text-center py-16 text-base-content/40 text-sm">
          No lists yet. Create one and import leads from Sales Navigator.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-base-300/50">
          <table className="table w-full text-sm">
            <thead>
              <tr className="border-base-300/50 text-base-content/50 text-xs uppercase tracking-wide">
                <th>Name</th>
                <th>Leads</th>
                <th>Campaign</th>
                <th>Import</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lists.map((l) => (
                <tr
                  key={l.id}
                  className="border-base-300/30 hover:bg-base-200/50 cursor-pointer"
                  onClick={() => router.push(`/lists/${l.id}`)}
                >
                  <td>
                    <span className="font-medium">{l.name}</span>
                    {l.description && (
                      <p className="text-base-content/40 text-xs mt-0.5">{l.description}</p>
                    )}
                  </td>
                  <td>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-base-300 text-base-content/60">{l.target_count}</span>
                  </td>
                  <td>
                    {l.active_run_id ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-base-content/60">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${l.active_run_status === 'running' ? 'bg-success animate-pulse' : 'bg-warning'}`} />
                        {l.active_workflow_name ?? 'Active'}
                      </span>
                    ) : (
                      <span className="text-base-content/20 text-xs">—</span>
                    )}
                  </td>
                  <td className="min-w-35">
                    {runningByList[l.id] ? (() => {
                      const job = runningByList[l.id];
                      const pct = job.total > 0 ? Math.round((job.count / job.total) * 100) : 0;
                      const label = job.phase === 'visiting' ? 'Visiting' : job.phase === 'enriching' ? 'Resolving' : 'Scraping';
                      return (
                        <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1.5">
                            <span className="loading loading-spinner loading-xs text-primary" style={{ width: 10, height: 10 }} />
                            <span className="text-xs text-primary font-medium">{label} {pct}%</span>
                          </div>
                          <div className="w-full bg-base-300 rounded-full h-1">
                            <div className="bg-primary h-1 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-base-content/40">{job.count} / {job.total}</span>
                        </div>
                      );
                    })() : (
                      <span className="text-base-content/20 text-xs">—</span>
                    )}
                  </td>
                  <td className="text-base-content/40 text-xs">
                    {new Date(l.created_at).toLocaleDateString()}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        className="inline-flex items-center px-2 py-1 rounded-md text-xs bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors"
                        onClick={() => deleteList(l.id)}
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
            <h3 className="font-semibold text-base mb-4">New List</h3>
            <form onSubmit={createList} className="flex flex-col gap-3">
              <div>
                <label className="label text-xs text-base-content/50 pb-1">List name</label>
                <input
                  className="input input-bordered input-sm w-full bg-base-300/50"
                  placeholder="e.g. Q1 SaaS Founders"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label text-xs text-base-content/50 pb-1">Description (optional)</label>
                <input
                  className="input input-bordered input-sm w-full bg-base-300/50"
                  placeholder="e.g. Founders from Sales Nav search"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="modal-action mt-2">
                <button type="button" className="btn btn-ghost btn-sm text-base-content/60" onClick={() => setShowModal(false)}>
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
    </div>
    </>
  );
}
