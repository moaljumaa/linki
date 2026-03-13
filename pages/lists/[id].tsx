import Head from "next/head";
import { useState } from "react";
import { GetServerSideProps } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import {
  RiArrowLeftLine, RiDownloadLine, RiExternalLinkLine, RiDeleteBinLine,
  RiArrowLeftSLine, RiArrowRightSLine, RiRefreshLine, RiMailLine, RiReplyLine,
  RiUserAddLine, RiUserFollowLine, RiUserLine,
} from "react-icons/ri";

const PAGE_SIZE = 25;

interface Target {
  id: string;
  linkedin_url: string;
  full_name: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  degree: number | null;
  connection_requested_at: string | null;
  connected_at: string | null;
  message_sent_at: string | null;
  last_replied_at: string | null;
}

interface ListDetail {
  id: string;
  name: string;
  description: string | null;
  sales_nav_url: string | null;
  targets: Target[];
}

interface Account {
  id: string;
  name: string;
  is_authenticated: number;
}

export const getServerSideProps: GetServerSideProps = async ({ params }) => {
  const db = getDb();
  const id = params?.id as string;
  const list = db.prepare("SELECT * FROM lists WHERE id = ?").get(id);
  if (!list) return { notFound: true };
  const targets = db
    .prepare(
      `SELECT t.* FROM targets t
       JOIN list_targets lt ON lt.target_id = t.id
       WHERE lt.list_id = ? ORDER BY t.created_at DESC`
    )
    .all(id);
  const accounts = db.prepare("SELECT id, name, is_authenticated FROM accounts ORDER BY name").all();
  return { props: { list: { ...list, targets }, accounts } };
};

function ConnectionIcon({ t }: { t: Target }) {
  if (t.degree === 1) {
    return (
      <span title="Connected (1st degree)" className="text-success">
        <RiUserFollowLine size={15} />
      </span>
    );
  }
  if (t.connection_requested_at) {
    return (
      <span title="Connection request pending" className="text-warning">
        <RiUserAddLine size={15} />
      </span>
    );
  }
  return (
    <span title={t.degree ? `${t.degree === 2 ? "2nd" : "3rd"} degree` : "Not connected"} className="text-base-content/25">
      <RiUserLine size={15} />
    </span>
  );
}

export default function ListDetailPage({
  list: initialList,
  accounts,
}: {
  list: ListDetail;
  accounts: Account[];
}) {
  const [targets, setTargets] = useState<Target[]>(initialList.targets);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const [showImport, setShowImport] = useState(false);
  const [importForm, setImportForm] = useState({
    sales_nav_url: initialList.sales_nav_url ?? "",
    account_id: "",
  });
  const [importing, setImporting] = useState(false);

  const [showSync, setShowSync] = useState(false);
  const [syncAccountId, setSyncAccountId] = useState("");
  const [syncing, setSyncing] = useState(false);

  const totalPages = Math.ceil(targets.length / PAGE_SIZE);
  const pageTargets = targets.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const allPageSelected = pageTargets.length > 0 && pageTargets.every((t) => selected.has(t.id));

  function toggleAll() {
    if (allPageSelected) {
      setSelected((prev) => { const n = new Set(prev); pageTargets.forEach((t) => n.delete(t.id)); return n; });
    } else {
      setSelected((prev) => { const n = new Set(prev); pageTargets.forEach((t) => n.add(t.id)); return n; });
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    setDeleting(true);
    const res = await fetch(`/api/lists/${initialList.id}/targets`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_ids: [...selected] }),
    });
    setDeleting(false);
    if (!res.ok) { toast.error("Failed to remove leads"); return; }
    const data = await res.json();
    toast.success(`Removed ${data.removed} lead${data.removed !== 1 ? "s" : ""}`);
    setTargets((prev) => prev.filter((t) => !selected.has(t.id)));
    setSelected(new Set());
    setPage((p) => Math.min(p, Math.max(0, Math.ceil((targets.length - selected.size) / PAGE_SIZE) - 1)));
  }

  async function runImport(e: React.FormEvent) {
    e.preventDefault();
    if (!importForm.account_id) { toast.error("Select an account"); return; }
    setImporting(true);
    const res = await fetch(`/api/lists/${initialList.id}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sales_nav_url: importForm.sales_nav_url,
        account_id: importForm.account_id,
      }),
    });
    setImporting(false);
    const data = await res.json();
    if (!res.ok) { toast.error(data.error ?? "Import failed"); return; }
    toast.success(`Imported ${data.imported} leads (${data.skipped} already existed)`);
    setShowImport(false);
    const listRes = await fetch(`/api/lists/${initialList.id}`);
    const listData = await listRes.json();
    setTargets(listData.targets);
    setPage(0);
    setSelected(new Set());
  }

  async function runSync(e: React.FormEvent) {
    e.preventDefault();
    if (!syncAccountId) { toast.error("Select an account"); return; }
    setSyncing(true);
    const res = await fetch(`/api/lists/${initialList.id}/sync-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: syncAccountId }),
    });
    setSyncing(false);
    const data = await res.json();
    if (!res.ok) { toast.error(data.error ?? "Sync failed"); return; }
    toast.success(`Synced ${data.updated} leads`);
    setShowSync(false);
    const listRes = await fetch(`/api/lists/${initialList.id}`);
    const listData = await listRes.json();
    setTargets(listData.targets);
  }

  return (
    <>
    <Head>
      <title>{initialList.name} — Lists — Linki</title>
      <meta name="robots" content="noindex, nofollow" />
    </Head>
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/lists" className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-base-content/50 hover:text-base-content hover:bg-base-300/50 transition-colors">
          <RiArrowLeftLine size={16} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">{initialList.name}</h1>
          {initialList.description && (
            <p className="text-base-content/50 text-sm mt-0.5">{initialList.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-base-300 text-base-content/60">{targets.length} leads</span>
          {selected.size > 0 && (
            <button
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors"
              onClick={deleteSelected}
              disabled={deleting}
            >
              <RiDeleteBinLine size={14} />
              {deleting ? "Removing..." : `Remove ${selected.size}`}
            </button>
          )}
          {initialList.sales_nav_url && (
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-base-content/60 hover:text-base-content hover:bg-base-300/50 transition-colors" onClick={() => setShowSync(true)}>
              <RiRefreshLine size={15} /> Sync Status
            </button>
          )}
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors" onClick={() => setShowImport(true)}>
            <RiDownloadLine size={15} /> Import
          </button>
        </div>
      </div>

      {targets.length === 0 ? (
        <div className="text-center py-16 text-base-content/40 text-sm">
          No leads yet. Import from a Sales Navigator list URL.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-base-300/50">
            <table className="table w-full text-sm">
              <thead>
                <tr className="border-base-300/50 text-base-content/50 text-xs uppercase tracking-wide">
                  <th className="w-8">
                    <input type="checkbox" className="w-3.5 h-3.5 rounded border border-base-300 bg-base-300/50 accent-primary cursor-pointer" checked={allPageSelected} onChange={toggleAll} />
                  </th>
                  <th>Name</th>
                  <th>Title</th>
                  <th>Company</th>
                  <th>Location</th>
                  <th className="w-20"></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pageTargets.map((t) => (
                  <tr
                    key={t.id}
                    className={`border-base-300/30 hover:bg-base-200/50 cursor-pointer ${selected.has(t.id) ? "bg-primary/5" : ""}`}
                    onClick={() => toggleOne(t.id)}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="w-3.5 h-3.5 rounded border border-base-300 bg-base-300/50 accent-primary cursor-pointer" checked={selected.has(t.id)} onChange={() => toggleOne(t.id)} />
                    </td>
                    <td className="font-medium">{t.full_name ?? "—"}</td>
                    <td className="text-base-content/60 max-w-50 truncate">{t.title ?? "—"}</td>
                    <td className="text-base-content/60">{t.company ?? "—"}</td>
                    <td className="text-base-content/40 text-xs">{t.location ?? "—"}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <ConnectionIcon t={t} />
                        {t.message_sent_at && (
                          <span title="Message sent" className="text-info">
                            <RiMailLine size={14} />
                          </span>
                        )}
                        {t.last_replied_at && (
                          <span title="Replied" className="text-success">
                            <RiReplyLine size={14} />
                          </span>
                        )}
                      </div>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {t.linkedin_url && (
                        <a href={t.linkedin_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center p-1 rounded text-base-content/40 hover:text-base-content transition-colors">
                          <RiExternalLinkLine size={13} />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-3 text-sm text-base-content/50">
              <span>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, targets.length)} of {targets.length}</span>
              <div className="flex items-center gap-1">
                <button className="inline-flex items-center justify-center w-6 h-6 rounded text-base-content/50 hover:text-base-content hover:bg-base-300/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed" onClick={() => setPage((p) => p - 1)} disabled={page === 0}>
                  <RiArrowLeftSLine size={15} />
                </button>
                <span className="px-2">{page + 1} / {totalPages}</span>
                <button className="inline-flex items-center justify-center w-6 h-6 rounded text-base-content/50 hover:text-base-content hover:bg-base-300/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages - 1}>
                  <RiArrowRightSLine size={15} />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Import modal */}
      {showImport && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-200 border border-base-300/50 max-w-md">
            <h3 className="font-semibold text-base mb-1">Import from Sales Navigator</h3>
            <p className="text-base-content/50 text-xs mb-4">
              Paste a Sales Navigator people list URL. The selected account must be authenticated.
            </p>
            <form onSubmit={runImport} className="flex flex-col gap-3">
              <div>
                <label className="label text-xs text-base-content/50 pb-1">Sales Navigator URL</label>
                <input
                  className="input input-bordered input-sm w-full bg-base-300/50 font-mono text-xs"
                  placeholder="https://www.linkedin.com/sales/lists/people/..."
                  value={importForm.sales_nav_url}
                  onChange={(e) => setImportForm({ ...importForm, sales_nav_url: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label text-xs text-base-content/50 pb-1">Account to use</label>
                <select
                  className="w-full px-3 py-1.5 rounded-lg text-sm bg-base-300 border border-base-300/80 text-base-content focus:outline-none focus:border-primary/50 cursor-pointer"
                  value={importForm.account_id}
                  onChange={(e) => setImportForm({ ...importForm, account_id: e.target.value })}
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
              <div className="modal-action mt-1">
                <button type="button" className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-300/50 transition-colors" onClick={() => setShowImport(false)} disabled={importing}>Cancel</button>
                <button type="submit" className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50" disabled={importing}>
                  {importing ? <><span className="loading loading-spinner loading-xs" /> Importing...</> : "Start Import"}
                </button>
              </div>
            </form>
          </div>
          <div className="modal-backdrop" onClick={() => !importing && setShowImport(false)} />
        </div>
      )}

      {/* Sync Status modal — no URL needed, uses saved list URL */}
      {showSync && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-200 border border-base-300/50 max-w-sm">
            <h3 className="font-semibold text-base mb-1">Sync Connection Status</h3>
            <p className="text-base-content/50 text-xs mb-4">
              Re-fetches the Sales Navigator list to check who accepted your connection requests.
            </p>
            <form onSubmit={runSync} className="flex flex-col gap-3">
              <div>
                <label className="label text-xs text-base-content/50 pb-1">Account to use</label>
                <select
                  className="w-full px-3 py-1.5 rounded-lg text-sm bg-base-300 border border-base-300/80 text-base-content focus:outline-none focus:border-primary/50 cursor-pointer"
                  value={syncAccountId}
                  onChange={(e) => setSyncAccountId(e.target.value)}
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
              <div className="modal-action mt-1">
                <button type="button" className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-300/50 transition-colors" onClick={() => setShowSync(false)} disabled={syncing}>Cancel</button>
                <button type="submit" className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50" disabled={syncing}>
                  {syncing ? <><span className="loading loading-spinner loading-xs" /> Syncing...</> : "Sync Now"}
                </button>
              </div>
            </form>
          </div>
          <div className="modal-backdrop" onClick={() => !syncing && setShowSync(false)} />
        </div>
      )}
    </div>
    </>
  );
}
