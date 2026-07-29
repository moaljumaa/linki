import Head from "next/head";
import { useState, useEffect, useRef } from "react";
import { GetServerSideProps } from "next";
import Link from "next/link";
import { useRouter } from "next/router";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import {
  RiArrowLeftLine, RiDownloadLine, RiExternalLinkLine, RiDeleteBinLine,
  RiArrowLeftSLine, RiArrowRightSLine, RiRefreshLine, RiReplyLine,
  RiUserAddLine, RiUserFollowLine, RiUserLine, RiSparklingLine,
  RiMessage2Line, RiMailCheckLine, RiMailLine, RiAtLine,
  RiArrowRightLine, RiSearchLine, RiPlayLine, RiHistoryLine,
} from "react-icons/ri";
import FilterBar, { ActiveFilter, applyFiltersClient } from "@/components/ui/FilterBar";

const PAGE_SIZE = 25;

interface Target {
  id: string;
  linkedin_url: string | null;
  full_name: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  degree: number | null;
  connection_requested_at: string | null;
  connected_at: string | null;
  message_sent_at: string | null;
  last_replied_at: string | null;
  email: string | null;
  email_status: string | null;
  apollo_enriched_at: string | null;
}

interface ListDetail {
  id: string;
  name: string;
  description: string | null;
  sales_nav_url: string | null;
  targets: Target[];
}

interface RunHistoryItem {
  id: string;
  status: string;
  workflow_name: string | null;
  account_name: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  total_profiles: number;
  completed_profiles: number;
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
  const allLists = db.prepare("SELECT id, name FROM lists WHERE id != ? ORDER BY name").all(id);
  const runHistory = db
    .prepare(
      `SELECT r.id, r.status, r.created_at, r.started_at, r.completed_at,
              w.name as workflow_name,
              a.name as account_name,
              COUNT(DISTINCT rp.id) as total_profiles,
              COUNT(DISTINCT CASE WHEN NOT EXISTS (
                SELECT 1 FROM run_profile_tracks rt2
                WHERE rt2.run_profile_id = rp.id AND rt2.state NOT IN ('completed', 'failed', 'skipped')
              ) AND EXISTS (
                SELECT 1 FROM run_profile_tracks rt3
                WHERE rt3.run_profile_id = rp.id AND rt3.state = 'completed'
              ) THEN rp.id END) as completed_profiles
       FROM runs r
       LEFT JOIN workflows w ON w.id = r.workflow_id
       LEFT JOIN accounts a ON a.id = r.account_id
       LEFT JOIN run_profiles rp ON rp.run_id = r.id
       WHERE r.list_id = ?
       GROUP BY r.id
       ORDER BY r.created_at DESC`
    )
    .all(id) as RunHistoryItem[];
  return { props: { list: { ...list, targets }, accounts, allLists, runHistory } };
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
  allLists,
  runHistory,
}: {
  list: ListDetail;
  accounts: Account[];
  allLists: { id: string; name: string }[];
  runHistory: RunHistoryItem[];
}) {
  const router = useRouter();
  const [targets, setTargets] = useState<Target[]>(initialList.targets);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ActiveFilter[]>([]);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allFilteredSelected, setAllFilteredSelected] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [showImport, setShowImport] = useState(false);
  const [importSource, setImportSource] = useState<"pick" | "sales_nav" | "csv">("pick");
  const [importForm, setImportForm] = useState({
    sales_nav_url: initialList.sales_nav_url ?? "",
    account_id: "",
  });
  const [importing, setImporting] = useState(false);

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResult, setCsvResult] = useState<{ imported: number; updated: number; skipped: number; errors: string[] } | null>(null);
  const [importJob, setImportJob] = useState<{
    id: string; status: string; phase: string | null;
    page: number; total_pages: number; count: number; total: number;
    imported: number; skipped: number; error: string | null;
    scheduled_for?: string | null; batch_index?: number;
    dailyCap?: number;
    plan?: { total: number; importedSoFar: number; remaining: number; exceedsCap: boolean; dailyCap: number };
    batches?: Array<{ status: string; scheduled_for: string | null; batch_index: number }>;
  } | null>(null);
  const importPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [showSync, setShowSync] = useState(false);
  const [syncAccountId, setSyncAccountId] = useState("");
  const [syncing, setSyncing] = useState(false);

  const [apolloConfigured, setApolloConfigured] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [showApolloConfirm, setShowApolloConfirm] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [destListId, setDestListId] = useState("");

  useEffect(() => {
    fetch("/api/integrations")
      .then((r) => r.json())
      .then((rows: { key: string; configured: boolean }[]) => {
        setApolloConfigured(rows.some((r) => r.key === "apollo" && r.configured));
      })
      .catch(() => {});
  }, []);

  // Resume polling if there's already a running import (e.g. after page refresh)
  useEffect(() => {
    fetch(`/api/lists/${initialList.id}/import-status`)
      .then((r) => r.json())
      .then((job) => {
        if (job.status && job.status !== 'idle' && job.status !== 'done' && job.status !== 'canceled') {
          setImportJob(job);
          setImporting(true);
          startImportPoll();
        }
      })
      .catch(() => {});
    return () => { if (importPollRef.current) clearInterval(importPollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredTargets = applyFiltersClient(
    search.trim()
      ? targets.filter((t) =>
          [t.full_name, t.company, t.title].some((v) =>
            v?.toLowerCase().includes(search.trim().toLowerCase())
          )
        )
      : targets,
    filters
  );

  const totalPages = Math.ceil(filteredTargets.length / PAGE_SIZE);
  const pageTargets = filteredTargets.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const allPageSelected = pageTargets.length > 0 && pageTargets.every((t) => selected.has(t.id));

  function toggleAll() {
    if (allFilteredSelected) {
      setAllFilteredSelected(false);
      setSelected(new Set());
    } else if (allPageSelected) {
      setAllFilteredSelected(false);
      setSelected((prev) => { const n = new Set(prev); pageTargets.forEach((t) => n.delete(t.id)); return n; });
    } else {
      setAllFilteredSelected(false);
      setSelected((prev) => { const n = new Set(prev); pageTargets.forEach((t) => n.add(t.id)); return n; });
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  const effectiveSelectedIds = allFilteredSelected
    ? filteredTargets.map((t) => t.id)
    : [...selected];
  const effectiveSelectedCount = allFilteredSelected ? filteredTargets.length : selected.size;

  async function deleteSelected() {
    if (effectiveSelectedCount === 0) return;
    setDeleting(true);
    const res = await fetch(`/api/lists/${initialList.id}/targets`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_ids: effectiveSelectedIds }),
    });
    setDeleting(false);
    if (!res.ok) { toast.error("Failed to remove leads"); return; }
    const data = await res.json();
    toast.success(`Removed ${data.removed} lead${data.removed !== 1 ? "s" : ""}`);
    const removedSet = new Set(effectiveSelectedIds);
    setTargets((prev) => prev.filter((t) => !removedSet.has(t.id)));
    setSelected(new Set());
    setAllFilteredSelected(false);
    setPage(0);
  }

  async function removeFromList() {
    if (effectiveSelectedCount === 0) return;
    const res = await fetch(`/api/lists/${initialList.id}/targets`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_ids: effectiveSelectedIds }),
    });
    if (!res.ok) { toast.error("Failed to remove from list"); return; }
    const data = await res.json();
    toast.success(`Removed ${data.removed} from this list`);
    const removedSet = new Set(effectiveSelectedIds);
    setTargets((prev) => prev.filter((t) => !removedSet.has(t.id)));
    setSelected(new Set());
    setAllFilteredSelected(false);
    setPage(0);
  }

  async function moveToList() {
    if (!destListId || effectiveSelectedCount === 0) return;
    const res = await fetch(`/api/lists/${initialList.id}/move-targets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_ids: effectiveSelectedIds, destination_list_id: destListId }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error ?? "Move failed"); return; }
    const destName = allLists.find((l) => l.id === destListId)?.name ?? "list";
    toast.success(`Moved ${data.moved} lead${data.moved !== 1 ? "s" : ""} to ${destName}`);
    const movedSet = new Set(effectiveSelectedIds);
    setTargets((prev) => prev.filter((t) => !movedSet.has(t.id)));
    setSelected(new Set());
    setAllFilteredSelected(false);
    setShowMoveModal(false);
    setDestListId("");
    setPage(0);
  }

  function stopImportPoll() {
    if (importPollRef.current) { clearInterval(importPollRef.current); importPollRef.current = null; }
  }

  function startImportPoll() {
    stopImportPoll();
    let lastImported = -1;
    const today = new Date().toISOString().slice(0, 10);
    importPollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/lists/${initialList.id}/import-status`);
        const job = await r.json();
        if (job.status === 'idle') { stopImportPoll(); setImporting(false); return; }
        setImportJob(job);

        // Refresh the table whenever the imported-so-far count moves
        const importedSoFar = job.plan?.importedSoFar ?? job.imported ?? 0;
        if (importedSoFar !== lastImported) {
          lastImported = importedSoFar;
          const listData = await fetch(`/api/lists/${initialList.id}`).then((x) => x.json());
          setTargets(listData.targets);
        }

        if (job.status === 'error') {
          stopImportPoll(); setImporting(false);
          toast.error(job.error ?? "Import failed");
          return;
        }
        // Keep the active spinner only while something runs (or is due today).
        const activeNow = (job.batches ?? []).some(
          (b: { status: string; scheduled_for: string | null }) =>
            b.status === 'running' || (b.status === 'scheduled' && (b.scheduled_for ?? today) <= today)
        );
        setImporting(activeNow);
        if (!activeNow) stopImportPoll(); // remainder (if any) is scheduled for a future day
      } catch { /* ignore network hiccups */ }
    }, 3000);
  }

  async function runImport(e: React.FormEvent) {
    e.preventDefault();
    if (!importForm.account_id) { toast.error("Select an account"); return; }
    setImporting(true);
    setImportJob(null);
    const res = await fetch(`/api/lists/${initialList.id}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sales_nav_url: importForm.sales_nav_url,
        account_id: importForm.account_id,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setImporting(false);
      toast.error(data.error ?? "Import failed");
      return;
    }
    toast.success("Import queued");
    // Close modal, show inline progress banner, start polling
    setShowImport(false);
    setImportSource("pick");
    startImportPoll();
  }

  function closeImportModal() {
    setShowImport(false);
    setImportSource("pick");
    setCsvFile(null);
    setCsvResult(null);
  }

  function downloadCsvTemplate() {
    window.location.href = `/api/lists/${initialList.id}/csv-template`;
  }

  async function runCsvImport(e: React.FormEvent) {
    e.preventDefault();
    if (!csvFile) { toast.error("Choose a CSV file"); return; }
    setCsvImporting(true);
    setCsvResult(null);
    try {
      const csv = await csvFile.text();
      const res = await fetch(`/api/lists/${initialList.id}/import-csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Import failed"); return; }
      setCsvResult(data);
      const created = data.imported + data.updated;
      if (created > 0) {
        toast.success(`Imported ${data.imported} new, updated ${data.updated}${data.skipped > 0 ? `, ${data.skipped} already in list` : ""}`);
      } else if (data.errors.length === 0) {
        toast.message("No new contacts — all rows were already in this list");
      }
      const listRes = await fetch(`/api/lists/${initialList.id}`);
      const listData = await listRes.json();
      setTargets(listData.targets);
    } finally {
      setCsvImporting(false);
    }
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

  async function enrichWithApollo() {
    setShowApolloConfirm(false);
    setEnriching(true);
    const body = effectiveSelectedCount > 0 ? { target_ids: effectiveSelectedIds } : {};
    const res = await fetch(`/api/lists/${initialList.id}/apollo-enrich`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setEnriching(false);
    const data = await res.json();
    if (!res.ok) { toast.error(data.error ?? "Enrichment failed"); return; }
    toast.success(`Enriched ${data.enriched} leads${data.notFound > 0 ? `, ${data.notFound} not found` : ""}${data.skipped > 0 ? `, ${data.skipped} skipped` : ""}`);
    // Refresh targets
    const listRes = await fetch(`/api/lists/${initialList.id}`);
    const listData = await listRes.json();
    setTargets(listData.targets);
    setSelected(new Set());
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
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-base-300 text-base-content/60">
            {filteredTargets.length !== targets.length
              ? `${filteredTargets.length} / ${targets.length}`
              : `${targets.length}`} leads
          </span>
          {initialList.sales_nav_url && (
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-base-content/60 hover:text-base-content hover:bg-base-300/50 transition-colors" onClick={() => setShowSync(true)}>
              <RiRefreshLine size={15} /> Sync Status
            </button>
          )}
          {apolloConfigured && (
            <button
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-base-content/60 hover:text-base-content hover:bg-base-300/50 transition-colors disabled:opacity-40"
              onClick={() => setShowApolloConfirm(true)}
              disabled={enriching}
              title={effectiveSelectedCount > 0 ? `Enrich ${effectiveSelectedCount} selected contacts` : "Enrich all unenriched contacts"}
            >
              {enriching ? <span className="loading loading-spinner loading-xs" /> : <RiSparklingLine size={15} />}
              {enriching ? "Enriching..." : effectiveSelectedCount > 0 ? `Enrich ${effectiveSelectedCount}` : "Enrich"}
            </button>
          )}
          <button
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50"
            onClick={() => { setImportSource("pick"); setShowImport(true); }}
            disabled={importing}
          >
            <RiDownloadLine size={15} /> {importing ? "Importing…" : "Import"}
          </button>
        </div>
      </div>

      {/* Search + filter bar */}
      {targets.length > 0 && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/30 pointer-events-none">
              <RiSearchLine size={13} />
            </span>
            <input
              type="text"
              className="w-52 bg-base-200 border border-base-300/50 rounded-lg pl-8 pr-3 py-1.5 text-sm text-base-content placeholder:text-base-content/30 focus:outline-none focus:border-primary/40"
              placeholder="Search name, company…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            />
          </div>
          <div className="w-px h-4 bg-base-300/60" />
          <FilterBar
            filters={filters}
            onChange={(f) => { setFilters(f); setPage(0); }}
          />
        </div>
      )}

      {/* Import progress banner */}
      {/* Plan banner — shown whenever a list is being imported in batches over days */}
      {importJob?.plan?.exceedsCap && (importing || (importJob.plan.remaining > 0)) && (
        <div className="mb-4 p-3 rounded-lg bg-warning/10 border border-warning/20 text-xs text-warning">
          This list has <strong>{importJob.plan.total.toLocaleString()}</strong> contacts — over the{" "}
          <strong>{importJob.plan.dailyCap.toLocaleString()}/day</strong> limit, so it&apos;s imported in batches across days.{" "}
          {importJob.plan.importedSoFar.toLocaleString()} imported, {importJob.plan.remaining.toLocaleString()} remaining (see Lists → Import jobs for the schedule).
        </div>
      )}
      {importing && importJob && (() => {
        const scheduled = importJob.status === 'scheduled';
        const pct = importJob.total > 0 ? Math.round((importJob.count / importJob.total) * 100) : 0;
        const label = scheduled ? 'Queued — starting shortly…' :
          importJob.phase === 'visiting' ? 'Visiting profiles…' :
          importJob.phase === 'enriching' ? 'Resolving profile URLs…' :
          'Scraping leads…';
        return (
          <div className="mb-4 p-4 rounded-lg bg-primary/10 border border-primary/20">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="loading loading-spinner loading-xs text-primary" />
                <span className="text-sm font-medium text-primary">{label}</span>
              </div>
              {!scheduled && <span className="text-xs text-base-content/40 tabular-nums">{pct}%</span>}
            </div>
            {!scheduled && (
              <div className="w-full bg-base-300 rounded-full h-1.5">
                <div
                  className="bg-primary h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
            <p className="text-xs text-base-content/40 mt-2">
              This runs in the background — you can leave this page and come back.
            </p>
          </div>
        );
      })()}
      {importing && !importJob && (
        <div className="mb-4 p-4 rounded-lg bg-primary/10 border border-primary/20 flex items-center gap-2">
          <span className="loading loading-spinner loading-xs text-primary" />
          <span className="text-sm font-medium text-primary">Starting import…</span>
        </div>
      )}

      {targets.length === 0 && !importing ? (
        <div className="text-center py-16 text-base-content/40 text-sm">
          No leads yet. Import from a Sales Navigator list URL.
        </div>
      ) : filteredTargets.length === 0 && !importing ? (
        <div className="text-center py-16 text-base-content/40 text-sm">
          No leads match the current filters.
        </div>
      ) : targets.length === 0 && importing ? null : (
        <>
          {/* Bulk action bar — fixed height so table never shifts */}
          <div className="relative mb-2" style={{ minHeight: "2.25rem" }}>
            {effectiveSelectedCount > 0 ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-base-200 border border-base-300/50 rounded-lg">
                  <span className="text-xs text-base-content/50 flex-1">{effectiveSelectedCount} selected</span>
                  {allLists.length > 0 && (
                    <button
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
                      onClick={() => setShowMoveModal(true)}
                    >
                      <RiArrowRightLine size={12} /> Move to list
                    </button>
                  )}
                  <button
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors"
                    onClick={removeFromList}
                    disabled={deleting}
                  >
                    <RiDeleteBinLine size={12} /> Remove from list
                  </button>
                  <button
                    className="text-xs text-base-content/30 hover:text-base-content/60 transition-colors px-1"
                    onClick={() => { setSelected(new Set()); setAllFilteredSelected(false); }}
                  >
                    Cancel
                  </button>
                </div>
                {/* Select-all-filtered banner */}
                {!allFilteredSelected && allPageSelected && filteredTargets.length > PAGE_SIZE && (
                  <div className="flex items-center gap-2 px-3 py-1 bg-primary/5 border border-primary/15 rounded-lg">
                    <span className="text-xs text-base-content/50 flex-1">
                      Only the {pageTargets.length} leads on this page are selected.
                    </span>
                    <button
                      className="text-xs text-primary hover:underline"
                      onClick={() => setAllFilteredSelected(true)}
                    >
                      Select all {filteredTargets.length} leads
                    </button>
                  </div>
                )}
                {allFilteredSelected && (
                  <div className="flex items-center gap-2 px-3 py-1 bg-primary/5 border border-primary/15 rounded-lg">
                    <span className="text-xs text-base-content/50 flex-1">
                      All {filteredTargets.length} leads are selected.
                    </span>
                    <button
                      className="text-xs text-primary hover:underline"
                      onClick={() => { setAllFilteredSelected(false); setSelected(new Set()); }}
                    >
                      Clear selection
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
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
                    onClick={() => router.push(`/contacts/${t.id}`)}
                    className={`border-base-300/30 hover:bg-base-200/50 cursor-pointer ${selected.has(t.id) ? "bg-primary/5" : ""}`}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="w-3.5 h-3.5 rounded border border-base-300 bg-base-300/50 accent-primary cursor-pointer"
                        checked={selected.has(t.id)}
                        onChange={() => toggleOne(t.id)}
                      />
                    </td>
                    <td className="font-medium">{t.full_name ?? "—"}</td>
                    <td className="text-base-content/60 max-w-50 truncate">{t.title ?? "—"}</td>
                    <td className="text-base-content/60">{t.company ?? "—"}</td>
                    <td className="text-base-content/40 text-xs">{t.location ?? "—"}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <ConnectionIcon t={t} />
                        {t.message_sent_at && (
                          <span title={`LinkedIn message sent ${t.message_sent_at.slice(0, 10)}`} className="text-info">
                            <RiMessage2Line size={14} />
                          </span>
                        )}
                        {t.last_replied_at && (
                          <span title={`Replied ${t.last_replied_at.slice(0, 10)}`} className="text-success">
                            <RiReplyLine size={14} />
                          </span>
                        )}
                        {t.email && t.email_status === "verified" && (
                          <span title={`Verified email: ${t.email}`} className="text-success">
                            <RiMailCheckLine size={14} />
                          </span>
                        )}
                        {t.email && t.email_status !== "verified" && (
                          <span title={`Email (${t.email_status ?? "unverified"}): ${t.email}`} className="text-warning">
                            <RiAtLine size={14} />
                          </span>
                        )}
                        {t.apollo_enriched_at && !t.email && (
                          <span title="Apollo enriched — no email found" className="text-base-content/20">
                            <RiMailLine size={14} />
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
              <span>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filteredTargets.length)} of {filteredTargets.length}</span>
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

      {/* Campaign history */}
      {runHistory.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <RiHistoryLine size={14} className="text-base-content/40" />
            <h2 className="text-sm font-medium text-base-content/60 uppercase tracking-wide">Campaign History</h2>
          </div>
          <div className="overflow-x-auto rounded-lg border border-base-300/50">
            <table className="table w-full text-sm">
              <thead>
                <tr className="border-base-300/50 text-base-content/50 text-xs uppercase tracking-wide">
                  <th>Campaign</th>
                  <th>Account</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {runHistory.map((r) => {
                  const pct = r.total_profiles > 0 ? Math.round((r.completed_profiles / r.total_profiles) * 100) : 0;
                  const statusColors: Record<string, string> = {
                    running: "text-success",
                    paused: "text-warning",
                    completed: "text-base-content/40",
                    failed: "text-error",
                    pending: "text-base-content/30",
                  };
                  return (
                    <tr key={r.id} className="border-base-300/30">
                      <td className="font-medium">{r.workflow_name ?? "—"}</td>
                      <td className="text-base-content/50 text-xs">{r.account_name ?? "—"}</td>
                      <td>
                        <span className={`inline-flex items-center gap-1 text-xs font-medium ${statusColors[r.status] ?? "text-base-content/40"}`}>
                          {r.status === 'running' && <RiPlayLine size={11} />}
                          {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                        </span>
                      </td>
                      <td>
                        {r.total_profiles > 0 ? (
                          <div className="flex items-center gap-2">
                            <div className="w-16 bg-base-300 rounded-full h-1">
                              <div className="bg-primary h-1 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-base-content/40 tabular-nums">{r.completed_profiles}/{r.total_profiles}</span>
                          </div>
                        ) : (
                          <span className="text-base-content/20 text-xs">—</span>
                        )}
                      </td>
                      <td className="text-base-content/40 text-xs">{r.started_at ? new Date(r.started_at).toLocaleDateString() : new Date(r.created_at).toLocaleDateString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Import modal — source picker → Sales Nav form or CSV wizard */}
      {showImport && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-200 border border-base-300/50 max-w-md">

            {/* Step 1: pick source */}
            {importSource === "pick" && (
              <>
                <h3 className="font-semibold text-base mb-1">Import leads</h3>
                <p className="text-base-content/50 text-xs mb-4">Choose where these leads are coming from.</p>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    className="flex items-start gap-3 p-3 rounded-lg border border-base-300/60 hover:border-primary/50 hover:bg-base-300/30 transition-colors text-left"
                    onClick={() => setImportSource("sales_nav")}
                  >
                    <RiSearchLine size={18} className="text-primary mt-0.5" />
                    <span>
                      <span className="block text-sm font-medium">Sales Navigator search</span>
                      <span className="block text-xs text-base-content/50 mt-0.5">Paste a Sales Nav list/search URL — Linki scrapes it using a connected LinkedIn account.</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="flex items-start gap-3 p-3 rounded-lg border border-base-300/60 hover:border-primary/50 hover:bg-base-300/30 transition-colors text-left"
                    onClick={() => setImportSource("csv")}
                  >
                    <RiDownloadLine size={18} className="text-primary mt-0.5" />
                    <span>
                      <span className="block text-sm font-medium">CSV file</span>
                      <span className="block text-xs text-base-content/50 mt-0.5">Upload leads you already have — from another export, or emails scraped from websites.</span>
                    </span>
                  </button>
                </div>
                <div className="modal-action mt-4">
                  <button type="button" className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-300/50 transition-colors" onClick={closeImportModal}>Cancel</button>
                </div>
              </>
            )}

            {/* Step 2a: Sales Navigator form (existing flow) */}
            {importSource === "sales_nav" && (
              <>
                <h3 className="font-semibold text-base mb-1">Import from Sales Navigator</h3>
                <p className="text-base-content/50 text-xs mb-3">
                  Paste a Sales Navigator people list URL. The selected account must be authenticated.
                </p>
                <div className="bg-base-300/40 border border-base-300/60 rounded-lg p-3 mb-4 space-y-1.5 text-xs text-base-content/50">
                  <p className="font-medium text-base-content/70">What gets fetched and when</p>
                  <p><span className="text-base-content/60">Now —</span> Basic profile data only (name, title, company, location). One page load per 25 contacts with ~90s gaps.</p>
                  <p><span className="text-base-content/60">When a run starts —</span> LinkedIn URL resolved per contact right before first action.</p>
                  <p><span className="text-base-content/60">Before message —</span> Full Sales Nav profile (headline, positions) fetched for AI context.</p>
                  <p><span className="text-base-content/60">Before email —</span> Apollo enrichment runs to get email address + company data.</p>
                </div>
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
                    <button type="button" className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-300/50 transition-colors" onClick={() => setImportSource("pick")} disabled={importing}>Back</button>
                    <button type="submit" className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50" disabled={importing}>
                      {importing ? <><span className="loading loading-spinner loading-xs" /> Importing...</> : "Start Import"}
                    </button>
                  </div>
                </form>
              </>
            )}

            {/* Step 2b: CSV import */}
            {importSource === "csv" && (
              <>
                <h3 className="font-semibold text-base mb-1">Import from CSV</h3>
                <p className="text-base-content/50 text-xs mb-3">
                  One template for everything — leads you already have, whether that&apos;s a LinkedIn export, an email list, or both.
                </p>

                <div className="bg-base-300/40 border border-base-300/60 rounded-lg p-3 mb-4 space-y-1.5 text-xs text-base-content/50">
                  <p className="font-medium text-base-content/70">Rules</p>
                  <p>• Each row needs a <span className="text-base-content/60">linkedin_url</span> and/or an <span className="text-base-content/60">email</span> — fill in whichever you have, or both.</p>
                  <p>• <span className="text-base-content/60">linkedin_url</span> must be a real linkedin.com/in/ profile URL — used for connect/message/visit steps.</p>
                  <p>• <span className="text-base-content/60">sales_nav_url</span> is optional — speeds up enrichment and InMail if you have it.</p>
                  <p>• <span className="text-base-content/60">email</span> can be personal or generic (info@, contact@…) — used for email steps.</p>
                  <p>• Rows missing both are skipped and reported as errors.</p>
                  <p>• first_name, last_name, title, company, location, city, country, phone, headline, summary, notes are all optional.</p>
                </div>

                <form onSubmit={runCsvImport} className="flex flex-col gap-3">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 self-start text-xs font-medium text-primary hover:underline"
                    onClick={downloadCsvTemplate}
                  >
                    <RiDownloadLine size={13} /> Download template
                  </button>
                  <div>
                    <label className="label text-xs text-base-content/50 pb-1">CSV file</label>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className="file-input file-input-bordered file-input-sm w-full bg-base-300/50"
                      onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
                      required
                    />
                  </div>

                  {csvResult && (
                    <div className="bg-base-300/40 border border-base-300/60 rounded-lg p-3 text-xs space-y-1">
                      <p><span className="text-success font-medium">{csvResult.imported}</span> new, <span className="text-info font-medium">{csvResult.updated}</span> updated, <span className="text-base-content/50">{csvResult.skipped} already in list</span></p>
                      {csvResult.errors.length > 0 && (
                        <div className="text-error/80 max-h-24 overflow-y-auto">
                          {csvResult.errors.slice(0, 20).map((err, i) => <p key={i}>{err}</p>)}
                          {csvResult.errors.length > 20 && <p>…and {csvResult.errors.length - 20} more</p>}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="modal-action mt-1">
                    <button type="button" className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-300/50 transition-colors" onClick={() => setImportSource("pick")} disabled={csvImporting}>Back</button>
                    {csvResult ? (
                      <button type="button" className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors" onClick={closeImportModal}>Done</button>
                    ) : (
                      <button type="submit" className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50" disabled={csvImporting}>
                        {csvImporting ? <><span className="loading loading-spinner loading-xs" /> Importing...</> : "Import CSV"}
                      </button>
                    )}
                  </div>
                </form>
              </>
            )}
          </div>
          <div className="modal-backdrop" onClick={() => !importing && !csvImporting && closeImportModal()} />
        </div>
      )}

      {/* Apollo enrich confirm modal */}
      {showApolloConfirm && (() => {
        const effectiveSet = new Set(effectiveSelectedIds);
        const pool = effectiveSelectedCount > 0
          ? targets.filter((t) => effectiveSet.has(t.id) && !t.email)
          : targets.filter((t) => !t.apollo_enriched_at && !t.email);
        const alreadyHaveEmail = effectiveSelectedCount > 0 ? targets.filter((t) => effectiveSet.has(t.id) && t.email).length : 0;
        return (
          <div className="modal modal-open">
            <div className="modal-box bg-base-200 border border-base-300/50 max-w-sm">
              <div className="flex items-center gap-2 mb-3">
                <RiSparklingLine size={16} className="text-primary" />
                <h3 className="font-semibold text-base">Apollo Enrichment</h3>
              </div>
              <p className="text-base-content/60 text-sm mb-4 leading-relaxed">
                This will look up each contact on Apollo to find their email, seniority, and company data.
                Each lookup costs <span className="text-base-content font-medium">1 Apollo credit</span>.
              </p>
              <div className="rounded-lg bg-base-300/50 border border-base-300/50 p-3 mb-4 flex flex-col gap-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-base-content/50">Contacts to enrich</span>
                  <span className="font-medium">{pool.length}</span>
                </div>
                {alreadyHaveEmail > 0 && (
                  <div className="flex justify-between">
                    <span className="text-base-content/50">Skipped (email already found)</span>
                    <span className="text-success">{alreadyHaveEmail}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-base-300/50 pt-1.5 mt-0.5">
                  <span className="text-base-content/50">Credits used</span>
                  <span className="font-medium text-warning">{pool.length}</span>
                </div>
              </div>
              {pool.length === 0 ? (
                <p className="text-sm text-base-content/40 mb-4">No contacts to enrich — all selected contacts already have an email.</p>
              ) : null}
              <div className="flex items-center justify-end gap-2">
                <button
                  className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-300/50 transition-colors"
                  onClick={() => setShowApolloConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-40"
                  onClick={enrichWithApollo}
                  disabled={pool.length === 0}
                >
                  <RiSparklingLine size={14} />
                  Use {pool.length} credit{pool.length !== 1 ? "s" : ""}
                </button>
              </div>
            </div>
            <div className="modal-backdrop" onClick={() => setShowApolloConfirm(false)} />
          </div>
        );
      })()}

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

      {/* Move to list modal */}
      {showMoveModal && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-200 border border-base-300/50 max-w-sm">
            <h3 className="font-semibold text-base mb-1">Move to another list</h3>
            <p className="text-base-content/50 text-xs mb-4">
              {effectiveSelectedCount} lead{effectiveSelectedCount !== 1 ? "s" : ""} will be removed from <span className="text-base-content/70">{initialList.name}</span> and added to the selected list.
            </p>
            <select
              className="w-full px-3 py-1.5 rounded-lg text-sm bg-base-300 border border-base-300/80 text-base-content focus:outline-none focus:border-primary/50 cursor-pointer mb-4"
              value={destListId}
              onChange={(e) => setDestListId(e.target.value)}
            >
              <option value="">Select destination list…</option>
              {allLists.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            <div className="flex items-center justify-end gap-2">
              <button
                className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-300/50 transition-colors"
                onClick={() => { setShowMoveModal(false); setDestListId(""); }}
              >
                Cancel
              </button>
              <button
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-40"
                onClick={moveToList}
                disabled={!destListId}
              >
                <RiArrowRightLine size={14} /> Move {effectiveSelectedCount}
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => { setShowMoveModal(false); setDestListId(""); }} />
        </div>
      )}
    </div>
    </>
  );
}
