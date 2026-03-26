import Head from "next/head";
import { useState, useEffect, useCallback } from "react";
import { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import {
  RiArrowLeftLine,
  RiAddLine,
  RiDeleteBinLine,
  RiPlayLine,
  RiPauseLine,
  RiStopLine,
  RiEyeLine,
  RiLinkedinBoxLine,
  RiMessage2Line,
  RiTimeLine,
  RiArrowRightLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
} from "react-icons/ri";

// ─── Types ────────────────────────────────────────────────────────────────────

type StepType = "visit" | "connect" | "message" | "delay";

interface Step {
  id: string;
  step_order: number;
  step_type: StepType;
  template_id: string | null;
  template_name: string | null;
  template_ids: string[];
  template_names: string[];
  delay_seconds: number;
  connect_note: string | null;
  message_body: string | null;
}

interface WorkflowData {
  id: string;
  name: string;
  description: string | null;
  steps: Step[];
  active_run: {
    id: string;
    status: string;
    list_name: string;
    account_name: string;
  } | null;
}

interface Stats {
  total_prospects: number;
  active_prospects: number;
  completed_prospects: number;
  failed_prospects: number;
  connections_sent: number;
  connections_accepted: number;
  acceptance_rate: number;
  messages_sent: number;
  active_run: {
    id: string;
    status: string;
    list_name: string;
    account_name: string;
  } | null;
}

interface Prospect {
  id: string;
  target_id: string;
  full_name: string | null;
  title: string | null;
  company: string | null;
  linkedin_url: string;
  state: string;
  current_step: number;
  step_type: string | null;
  next_step_at: string | null;
  error_message: string | null;
  degree: number | null;
  connection_requested_at: string | null;
  connected_at: string | null;
  message_sent_at: string | null;
}

interface List {
  id: string;
  name: string;
  target_count?: number;
}

interface Account {
  id: string;
  name: string;
  is_authenticated: number;
  daily_connection_limit: number;
  daily_message_limit: number;
  connections_today: number;
  messages_today: number;
}

interface Template {
  id: string;
  name: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STEP_ICONS: Record<string, React.ReactNode> = {
  visit: <RiEyeLine size={15} />,
  connect: <RiLinkedinBoxLine size={15} />,
  message: <RiMessage2Line size={15} />,
  delay: <RiTimeLine size={15} />,
};

const STEP_LABELS: Record<string, string> = {
  visit: "Visit Profile",
  connect: "Send Connection",
  message: "Send Message",
};

const STEP_COLORS: Record<string, string> = {
  visit: "bg-info/10 text-info border-info/20",
  connect: "bg-primary/10 text-primary border-primary/20",
  message: "bg-success/10 text-success border-success/20",
};

const VARIABLES = ["{{first_name}}", "{{last_name}}", "{{company}}", "{{title}}"];

const STATE_PILL: Record<string, string> = {
  pending: "bg-base-300 text-base-content/50",
  in_progress: "bg-info/15 text-info",
  completed: "bg-success/15 text-success",
  failed: "bg-error/15 text-error",
  skipped: "bg-base-300/60 text-base-content/30",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatNextAction(next_step_at: string | null, state: string): string {
  if (state === "completed" || state === "failed" || state === "skipped") return "—";
  if (!next_step_at) return "Soon";
  const diff = new Date(next_step_at).getTime() - Date.now();
  if (diff <= 0) return "Now";
  const hours = diff / 3600_000;
  if (hours < 24) return `in ${Math.round(hours)}h`;
  return `in ${Math.round(hours / 24)}d`;
}

// ─── Server-side ──────────────────────────────────────────────────────────────

export const getServerSideProps: GetServerSideProps = async ({ params, query }) => {
  const db = getDb();
  const id = params?.id as string;
  const workflow = db.prepare("SELECT * FROM workflows WHERE id = ?").get(id);
  if (!workflow) return { notFound: true };

  const rawSteps = db
    .prepare(
      `SELECT ws.*, t.name as template_name
       FROM workflow_steps ws
       LEFT JOIN templates t ON t.id = ws.template_id
       WHERE ws.workflow_id = ? ORDER BY ws.step_order`
    )
    .all(id);

  const getStepTemplates = db.prepare(
    `SELECT wst.template_id, t.name FROM workflow_step_templates wst JOIN templates t ON t.id = wst.template_id WHERE wst.step_id = ?`
  );
  const steps = (rawSteps as Array<Record<string, unknown>>).map((s) => {
    const rows = getStepTemplates.all(s.id) as Array<{ template_id: string; name: string }>;
    return { ...s, template_ids: rows.map((r) => r.template_id), template_names: rows.map((r) => r.name) };
  });

  const activeRun = db
    .prepare(
      `SELECT r.id, r.status, l.name as list_name, a.name as account_name
       FROM runs r
       LEFT JOIN lists l ON l.id = r.list_id
       LEFT JOIN accounts a ON a.id = r.account_id
       WHERE r.workflow_id = ? AND r.status IN ('running','paused')
       LIMIT 1`
    )
    .get(id) as { id: string; status: string; list_name: string; account_name: string } | undefined;

  const lists = db
    .prepare(
      `SELECT l.id, l.name, COUNT(lt.target_id) as target_count
       FROM lists l LEFT JOIN list_targets lt ON lt.list_id = l.id
       GROUP BY l.id ORDER BY l.name`
    )
    .all();
  const accounts = db
    .prepare(
      `SELECT a.id, a.name, a.is_authenticated, a.daily_connection_limit, a.daily_message_limit,
         (SELECT COUNT(*) FROM logs l JOIN runs r ON r.id = l.run_id
          WHERE r.account_id = a.id AND l.message LIKE 'Connection request sent%' AND date(l.created_at) = date('now')) as connections_today,
         (SELECT COUNT(*) FROM logs l JOIN runs r ON r.id = l.run_id
          WHERE r.account_id = a.id AND l.message LIKE 'Message sent%' AND date(l.created_at) = date('now')) as messages_today
       FROM accounts a ORDER BY a.name`
    )
    .all();

  const templates = db.prepare("SELECT id, name FROM templates ORDER BY name").all();

  return {
    props: {
      workflow: { ...(workflow as object), steps, active_run: activeRun ?? null },
      lists,
      accounts,
      templates,
      // auto-open wizard if ?setup=1 (redirected from create)
      autoSetup: query.setup === "1",
    },
  };
};

// ─── Wizard ───────────────────────────────────────────────────────────────────

type WizardPage = "prospects" | "steps" | "account" | "summary";

interface WizardStep {
  type: "visit" | "connect" | "message";
  delayDaysBefore: number; // delay before this step (0 for first step)
  connectNote: string;
  messageBody: string;
  templateId: string | null;       // legacy single-template (kept for backwards compat)
  templateIds: string[];            // multi-template pool for A/B
}

function buildWizardSteps(steps: Step[]): WizardStep[] {
  const result: WizardStep[] = [];
  let pendingDelay = 0;
  for (const s of steps) {
    if (s.step_type === "delay") {
      pendingDelay = Math.round(s.delay_seconds / 86400);
    } else {
      result.push({
        type: s.step_type as "visit" | "connect" | "message",
        delayDaysBefore: pendingDelay,
        connectNote: s.connect_note ?? "",
        messageBody: s.message_body ?? "",
        templateId: s.template_id ?? null,
        templateIds: s.template_ids ?? [],
      });
      pendingDelay = 0;
    }
  }
  return result;
}

interface ListTarget {
  id: string;
  full_name: string | null;
  title: string | null;
  company: string | null;
  linkedin_url: string;
}

function Wizard({
  workflowId,
  workflowName: initialWorkflowName,
  initialSteps,
  lists,
  accounts,
  templates,
  onClose,
  onLaunched,
  onRenamed,
}: {
  workflowId: string;
  workflowName: string;
  initialSteps: Step[];
  lists: List[];
  accounts: Account[];
  templates: Template[];
  onClose: () => void;
  onLaunched: () => void;
  onRenamed: (name: string) => void;
}) {
  const [page, setPage] = useState<WizardPage>("prospects");
  const [listId, setListId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [conflicts, setConflicts] = useState<{ total: number; blocked: number } | null>(null);
  const [conflictsLoading, setConflictsLoading] = useState(false);
  const [wizardSteps, setWizardSteps] = useState<WizardStep[]>(() => buildWizardSteps(initialSteps));
  const [configIdx, setConfigIdx] = useState<number | null>(null); // which step is being configured
  const [launching, setLaunching] = useState(false);
  const [saving, setSaving] = useState(false);

  const [listTargets, setListTargets] = useState<ListTarget[]>([]);
  const [selectedTargetIds, setSelectedTargetIds] = useState<Set<string>>(new Set());
  const [prospectMode, setProspectMode] = useState<"all" | "manual">("all");

  // Workflow name editing
  const [workflowName, setWorkflowName] = useState(initialWorkflowName);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(initialWorkflowName);
  const [nameSaving, setNameSaving] = useState(false);

  const selectedList = lists.find((l) => l.id === listId);
  const selectedAccount = accounts.find((a) => a.id === accountId);
  const allBlocked = conflicts !== null && conflicts.blocked > 0 && conflicts.blocked >= conflicts.total;

  async function selectList(id: string) {
    setListId(id);
    setConflicts(null);
    setListTargets([]);
    setSelectedTargetIds(new Set());
    setProspectMode("all");
    if (!id) return;
    setConflictsLoading(true);
    const [conflictsRes, targetsRes] = await Promise.all([
      fetch(`/api/lists/${id}/conflicts`),
      fetch(`/api/lists/${id}`),
    ]);
    if (conflictsRes.ok) setConflicts(await conflictsRes.json());
    if (targetsRes.ok) {
      const data = await targetsRes.json();
      const ts: ListTarget[] = data.targets ?? [];
      setListTargets(ts);
      setSelectedTargetIds(new Set(ts.map((t) => t.id)));
    }
    setConflictsLoading(false);
  }

  async function saveWorkflowName() {
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === workflowName) { setEditingName(false); return; }
    setNameSaving(true);
    const res = await fetch(`/api/workflows/${workflowId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    if (res.ok) {
      setWorkflowName(trimmed);
      onRenamed(trimmed);
      toast.success("Renamed");
    }
    setNameSaving(false);
    setEditingName(false);
  }

  function toggleTarget(id: string) {
    setSelectedTargetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllTargets() {
    if (selectedTargetIds.size === listTargets.length) {
      setSelectedTargetIds(new Set());
    } else {
      setSelectedTargetIds(new Set(listTargets.map((t) => t.id)));
    }
  }

  const hasConnect = wizardSteps.some((s) => s.type === "connect");

  async function addWizardStep(type: "visit" | "connect" | "message") {
    setWizardSteps((prev) => {
      const isFirst = prev.length === 0;
      const newStep: WizardStep = { type, delayDaysBefore: isFirst ? 0 : 1, connectNote: "", messageBody: "", templateId: null, templateIds: [] };

      if (type === "connect") {
        // Insert before the first message step so connect always precedes message
        const firstMsgIdx = prev.findIndex((s) => s.type === "message");
        if (firstMsgIdx !== -1) {
          const inserted = [...prev];
          inserted.splice(firstMsgIdx, 0, newStep);
          return inserted;
        }
      }

      return [...prev, newStep];
    });
  }

  function removeWizardStep(idx: number) {
    setWizardSteps((prev) => prev.filter((_, i) => i !== idx));
    if (configIdx === idx) setConfigIdx(null);
  }

  function updateStep(idx: number, patch: Partial<WizardStep>) {
    setWizardSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  // Save steps to DB (replaces all existing steps for this workflow)
  async function saveStepsToDB() {
    setSaving(true);
    // Delete all existing steps
    const existing = await fetch(`/api/workflows/${workflowId}/steps`);
    const existingSteps: Step[] = existing.ok ? await existing.json() : [];
    await Promise.all(
      existingSteps.map((s) =>
        fetch(`/api/workflows/${workflowId}/steps/${s.id}`, { method: "DELETE" })
      )
    );
    // Recreate in order
    for (const ws of wizardSteps) {
      if (ws.delayDaysBefore > 0) {
        await fetch(`/api/workflows/${workflowId}/steps`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ step_type: "delay", delay_seconds: ws.delayDaysBefore * 86400 }),
        });
      }
      await fetch(`/api/workflows/${workflowId}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step_type: ws.type,
          connect_note: ws.type === "connect" ? (ws.connectNote || null) : null,
          message_body: ws.type === "message" ? (ws.messageBody || null) : null,
          template_id: ws.type === "message" && ws.templateIds.length === 0 ? (ws.templateId ?? null) : null,
          template_ids: ws.type === "message" ? ws.templateIds : [],
        }),
      });
    }
    setSaving(false);
  }

  async function launch() {
    if (wizardSteps.length === 0) { toast.error("Add at least one step"); return; }
    if (selectedTargetIds.size === 0) { toast.error("Select at least one prospect"); return; }
    await saveStepsToDB();
    setLaunching(true);
    const body: Record<string, unknown> = { workflow_id: workflowId, list_id: listId, account_id: accountId };
    if (prospectMode === "manual") body.target_ids = Array.from(selectedTargetIds);
    const runRes = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!runRes.ok) {
      setLaunching(false);
      const err = await runRes.json();
      toast.error(err.message ?? "Failed to start");
      return;
    }
    const { id: runId } = await runRes.json();
    await fetch(`/api/runs/${runId}/start`, { method: "POST" });
    setLaunching(false);
    toast.success("Campaign launched!");
    onLaunched();
  }

  async function saveAndClose() {
    await saveStepsToDB();
    toast.success("Steps saved");
    onClose();
  }

  const pages: WizardPage[] = ["prospects", "steps", "account", "summary"];
  const pageIdx = pages.indexOf(page);

  const prospectsReady = !!listId && !allBlocked && selectedTargetIds.size > 0;

  function canGoTo(p: WizardPage) {
    if (p === "prospects") return true;
    if (p === "steps") return prospectsReady;
    if (p === "account") return prospectsReady && wizardSteps.length > 0;
    if (p === "summary") return prospectsReady && wizardSteps.length > 0 && !!accountId;
    return false;
  }

  const PAGE_LABELS: Record<WizardPage, string> = {
    prospects: "Choose Prospects",
    steps: "Build Steps",
    account: "Choose Account",
    summary: "Summary",
  };

  const PAGE_ICONS: Record<WizardPage, React.ReactNode> = {
    prospects: <RiAddLine size={14} />,
    steps: <RiArrowRightLine size={14} />,
    account: <RiLinkedinBoxLine size={14} />,
    summary: "✓",
  };

  return (
    <div className="fixed inset-0 z-50 bg-base-100 flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-base-300/50 shrink-0">
        <div className="flex items-center gap-3">
          {editingName ? (
            <input
              autoFocus
              className="input input-xs input-bordered bg-base-300/50 font-semibold text-sm w-52"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={saveWorkflowName}
              onKeyDown={(e) => { if (e.key === "Enter") saveWorkflowName(); if (e.key === "Escape") { setEditingName(false); setNameValue(workflowName); } }}
              disabled={nameSaving}
            />
          ) : (
            <button
              className="font-semibold text-sm hover:text-primary transition-colors cursor-pointer"
              onClick={() => { setNameValue(workflowName); setEditingName(true); }}
              title="Click to rename"
            >
              {workflowName}
            </button>
          )}
          <span className="text-base-content/30">·</span>
          <span className="text-sm text-base-content/50">{PAGE_LABELS[page]}</span>
        </div>
        <button
          className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-base-content/50 hover:text-base-content hover:bg-base-300/50 transition-colors"
          onClick={onClose}
          disabled={launching || saving}
        >
          ✕
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left nav */}
        <div className="w-56 shrink-0 border-r border-base-300/50 p-4 flex flex-col gap-1 overflow-y-auto">
          {pages.map((p) => {
            const active = page === p;
            const canNav = canGoTo(p);
            return (
              <button
                key={p}
                onClick={() => canNav && setPage(p)}
                className={`w-full text-left flex items-center gap-3 px-3 py-3 rounded-lg transition-colors ${
                  active
                    ? "bg-primary/10 border border-primary/30"
                    : canNav
                    ? "hover:bg-base-200"
                    : "opacity-30 cursor-not-allowed"
                }`}
              >
                <span
                  className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold ${
                    active ? "bg-primary text-primary-content" : "bg-base-300 text-base-content/50"
                  }`}
                >
                  {PAGE_ICONS[p]}
                </span>
                <div className="min-w-0">
                  <p className={`text-xs font-semibold ${active ? "text-primary" : "text-base-content"}`}>
                    {PAGE_LABELS[p]}
                  </p>
                  {p === "prospects" && selectedList && (
                    <p className="text-xs text-base-content/40 truncate">{selectedList.name}</p>
                  )}
                  {p === "steps" && wizardSteps.length > 0 && (
                    <p className="text-xs text-base-content/40">{wizardSteps.length} step{wizardSteps.length !== 1 ? "s" : ""}</p>
                  )}
                  {p === "account" && selectedAccount && (
                    <p className="text-xs text-base-content/40 truncate">{selectedAccount.name}</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto pt-10 px-10 pb-6">
            <div className="max-w-2xl w-full mx-auto">

              {/* ── Page: Prospects ── */}
              {page === "prospects" && (
                <div>
                  <h2 className="text-xl font-semibold mb-1">Choose your prospects</h2>
                  <p className="text-base-content/50 text-sm mb-6">
                    Select the list of leads you want to run this campaign on.
                  </p>
                  <div className="flex flex-col gap-2 mb-4">
                    {lists.length === 0 ? (
                      <p className="text-sm text-base-content/40">
                        No lists yet.{" "}
                        <Link href="/lists" className="text-primary underline">Create a list first.</Link>
                      </p>
                    ) : lists.map((l) => (
                      <button
                        key={l.id}
                        onClick={() => selectList(String(l.id))}
                        className={`flex items-center gap-4 px-4 py-3 rounded-xl border transition-colors text-left ${
                          listId === String(l.id)
                            ? "bg-primary/10 border-primary/40"
                            : "bg-base-200 border-base-300/50 hover:border-base-300"
                        }`}
                      >
                        <span className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${listId === String(l.id) ? "bg-primary text-primary-content" : "bg-base-300 text-base-content/60"}`}>
                          {l.target_count ?? 0}
                        </span>
                        <div>
                          <p className={`font-medium text-sm ${listId === String(l.id) ? "text-primary" : ""}`}>{l.name}</p>
                          <p className="text-xs text-base-content/40">{l.target_count ?? 0} prospects</p>
                        </div>
                        {listId === String(l.id) && <span className="ml-auto text-primary text-xs font-semibold">Selected</span>}
                      </button>
                    ))}
                  </div>

                  {conflictsLoading && <p className="text-xs text-base-content/40">Checking for conflicts...</p>}
                  {!conflictsLoading && conflicts && conflicts.blocked > 0 && (
                    <div className={`px-4 py-3 rounded-lg text-sm mb-3 ${allBlocked ? "bg-error/10 text-error" : "bg-warning/10 text-warning"}`}>
                      {allBlocked
                        ? `All ${conflicts.total} prospects are already active in another campaign. Choose a different list.`
                        : `${conflicts.blocked} of ${conflicts.total} prospects are already active elsewhere and will be excluded.`}
                    </div>
                  )}
                  {!conflictsLoading && conflicts && conflicts.blocked === 0 && listId && (
                    <p className="text-sm text-success mb-4">All {conflicts.total} prospects are available.</p>
                  )}

                  {/* Who to enroll */}
                  {listId && !conflictsLoading && !allBlocked && listTargets.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs text-base-content/40 mb-2 uppercase tracking-wide">Who to enroll</p>
                      <div className="flex gap-2 mb-4">
                        <button
                          onClick={() => { setProspectMode("all"); setSelectedTargetIds(new Set(listTargets.map((t) => t.id))); }}
                          className={`flex-1 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${prospectMode === "all" ? "bg-primary/10 border-primary/40 text-primary" : "bg-base-200 border-base-300/50 hover:border-base-300 text-base-content/60"}`}
                        >
                          All contacts in list
                          <span className="ml-1 text-xs opacity-60">({listTargets.length})</span>
                        </button>
                        <button
                          onClick={() => setProspectMode("manual")}
                          className={`flex-1 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${prospectMode === "manual" ? "bg-primary/10 border-primary/40 text-primary" : "bg-base-200 border-base-300/50 hover:border-base-300 text-base-content/60"}`}
                        >
                          Manual selection
                          {prospectMode === "manual" && (
                            <span className="ml-1 text-xs opacity-60">({selectedTargetIds.size} selected)</span>
                          )}
                        </button>
                      </div>

                      {prospectMode === "manual" && (
                        <div className="border border-base-300/50 rounded-xl overflow-hidden">
                          <div className="px-4 py-2.5 bg-base-200 border-b border-base-300/50 flex items-center gap-3">
                            <input
                              type="checkbox"
                              className="w-3.5 h-3.5 rounded border border-base-300 bg-base-300/50 accent-primary cursor-pointer"
                              checked={selectedTargetIds.size === listTargets.length && listTargets.length > 0}
                              onChange={toggleAllTargets}
                            />
                            <span className="text-xs text-base-content/50">
                              {selectedTargetIds.size === listTargets.length
                                ? `All ${listTargets.length} selected`
                                : `${selectedTargetIds.size} of ${listTargets.length} selected`}
                            </span>
                          </div>
                          <div className="max-h-64 overflow-y-auto">
                            {listTargets.map((t) => (
                              <label
                                key={t.id}
                                className="flex items-center gap-3 px-4 py-2.5 hover:bg-base-200/60 cursor-pointer border-b border-base-300/30 last:border-0"
                              >
                                <input
                                  type="checkbox"
                                  className="w-3.5 h-3.5 rounded border border-base-300 bg-base-300/50 accent-primary cursor-pointer shrink-0"
                                  checked={selectedTargetIds.has(t.id)}
                                  onChange={() => toggleTarget(t.id)}
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium truncate">{t.full_name ?? "—"}</p>
                                  {(t.title || t.company) && (
                                    <p className="text-xs text-base-content/40 truncate">{[t.title, t.company].filter(Boolean).join(" · ")}</p>
                                  )}
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Page: Steps ── */}
              {page === "steps" && (
                <div>
                  <h2 className="text-xl font-semibold mb-1">Build your campaign steps</h2>
                  <p className="text-base-content/50 text-sm mb-8">
                    Add steps in order. Set delays between them and configure each step's content.
                  </p>

                  {/* Step list */}
                  <div className="space-y-0 mb-6">
                    {wizardSteps.length === 0 && (
                      <div className="text-center py-10 border border-dashed border-base-300/60 rounded-xl text-base-content/30 text-sm">
                        No steps yet. Add your first step below.
                      </div>
                    )}

                    {wizardSteps.map((ws, idx) => (
                      <div key={idx}>
                        {/* Delay connector */}
                        {idx > 0 && (
                          <div className="flex items-center gap-2 py-1 pl-4">
                            <div className="flex flex-col items-center gap-0.5">
                              <div className="w-px h-2 bg-base-300/60" />
                              <RiTimeLine size={12} className="text-base-content/30" />
                              <div className="w-px h-2 bg-base-300/60" />
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-base-content/30">Wait</span>
                              <input
                                type="number"
                                min={0}
                                className="input input-xs input-bordered w-14 bg-base-300/50 text-xs text-center"
                                value={ws.delayDaysBefore}
                                onChange={(e) => updateStep(idx, { delayDaysBefore: Number(e.target.value) })}
                              />
                              <span className="text-xs text-base-content/30">days</span>
                            </div>
                          </div>
                        )}

                        {/* Step card */}
                        <div
                          className={`flex items-center gap-3 border rounded-xl px-4 py-3 cursor-pointer transition-colors ${
                            configIdx === idx
                              ? "bg-base-200 border-primary/40"
                              : "bg-base-200 border-base-300/50 hover:border-base-300"
                          }`}
                          onClick={() => setConfigIdx(configIdx === idx ? null : idx)}
                        >
                          <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${STEP_COLORS[ws.type]}`}>
                            {STEP_ICONS[ws.type]}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{STEP_LABELS[ws.type]}</p>
                            {ws.type === "connect" && ws.connectNote && (
                              <p className="text-xs text-base-content/40 truncate">Note: {ws.connectNote}</p>
                            )}
                            {ws.type === "message" && ws.templateIds.length > 0 && (
                              <p className="text-xs text-base-content/40">{ws.templateIds.length} template{ws.templateIds.length > 1 ? "s" : ""} · random pick</p>
                            )}
                            {ws.type === "message" && ws.templateIds.length === 0 && ws.messageBody && (
                              <p className="text-xs text-base-content/40 truncate">{ws.messageBody}</p>
                            )}
                            {ws.type === "visit" && (
                              <p className="text-xs text-base-content/30">Visits profile, no config needed</p>
                            )}
                          </div>
                          <span className="text-xs text-base-content/30">
                            {configIdx === idx ? "▲ close" : "▼ configure"}
                          </span>
                          <button
                            className="inline-flex items-center p-1.5 rounded-md bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors ml-1"
                            onClick={(e) => { e.stopPropagation(); removeWizardStep(idx); }}
                          >
                            <RiDeleteBinLine size={13} />
                          </button>
                        </div>

                        {/* Inline config panel */}
                        {configIdx === idx && (
                          <div className="border border-t-0 border-primary/20 rounded-b-xl bg-base-200/50 px-5 py-5 mb-1">
                            {ws.type === "visit" && (
                              <p className="text-sm text-base-content/50">
                                Nothing to configure. Linki will visit the profile and they'll see you in "Who viewed my profile".
                              </p>
                            )}

                            {ws.type === "connect" && (
                              <div>
                                <div className="flex items-center gap-3 mb-4">
                                  <input
                                    type="checkbox"
                                    id={`note-${idx}`}
                                    className="w-4 h-4 rounded border border-base-300 bg-base-300/50 accent-primary cursor-pointer"
                                    checked={!!ws.connectNote}
                                    onChange={(e) => updateStep(idx, { connectNote: e.target.checked ? " " : "" })}
                                  />
                                  <label htmlFor={`note-${idx}`} className="text-sm cursor-pointer">
                                    Include a connection note
                                  </label>
                                </div>
                                {!!ws.connectNote && (
                                  <>
                                    <textarea
                                      className="textarea textarea-bordered w-full bg-base-300/50 text-sm h-24 resize-none"
                                      placeholder="Hi {{first_name}}, I'd love to connect..."
                                      value={ws.connectNote.trimStart()}
                                      onChange={(e) => updateStep(idx, { connectNote: e.target.value })}
                                      maxLength={300}
                                    />
                                    <p className="text-xs text-base-content/30 mt-1">{ws.connectNote.length}/300 chars (LinkedIn limit)</p>
                                  </>
                                )}
                              </div>
                            )}

                            {ws.type === "message" && (
                              <div className="space-y-4">
                                {/* Multi-template pool */}
                                {templates.length > 0 && (
                                  <div>
                                    <p className="text-xs text-base-content/40 mb-2">Templates <span className="text-base-content/25">(one picked at random per send)</span></p>
                                    {/* Selected template chips */}
                                    {ws.templateIds.length > 0 && (
                                      <div className="flex flex-wrap gap-1.5 mb-2">
                                        {ws.templateIds.map((tid) => {
                                          const t = templates.find((t) => t.id === tid);
                                          return (
                                            <span key={tid} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-md text-xs font-medium bg-success/10 text-success border border-success/20">
                                              {t?.name ?? tid}
                                              <button
                                                type="button"
                                                onClick={() => updateStep(idx, { templateIds: ws.templateIds.filter((id) => id !== tid) })}
                                                className="ml-0.5 hover:text-error transition-colors"
                                              >×</button>
                                            </span>
                                          );
                                        })}
                                      </div>
                                    )}
                                    {/* Add template dropdown */}
                                    {templates.filter((t) => !ws.templateIds.includes(t.id)).length > 0 && (
                                      <select
                                        className="select select-bordered select-sm bg-base-300/50 text-sm"
                                        value=""
                                        onChange={(e) => {
                                          const tid = e.target.value;
                                          if (tid && !ws.templateIds.includes(tid)) {
                                            updateStep(idx, { templateIds: [...ws.templateIds, tid], messageBody: "" });
                                          }
                                        }}
                                      >
                                        <option value="">+ Add template</option>
                                        {templates
                                          .filter((t) => !ws.templateIds.includes(t.id))
                                          .map((t) => (
                                            <option key={t.id} value={t.id}>{t.name}</option>
                                          ))}
                                      </select>
                                    )}
                                    {ws.templateIds.length > 0 && (
                                      <p className="text-xs text-base-content/25 mt-1.5">Inline message below is ignored when templates are selected.</p>
                                    )}
                                  </div>
                                )}
                                {/* Inline body */}
                                <div className="flex gap-4">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                                      <span className="text-xs text-base-content/40">Insert variable:</span>
                                      {VARIABLES.map((v) => (
                                        <button
                                          key={v}
                                          onClick={() => {
                                            const el = document.querySelector<HTMLTextAreaElement>(`#msg-${idx}`);
                                            const pos = el?.selectionStart ?? ws.messageBody.length;
                                            updateStep(idx, {
                                              messageBody: ws.messageBody.slice(0, pos) + v + ws.messageBody.slice(pos),
                                            });
                                          }}
                                          className="text-xs px-1.5 py-0.5 rounded bg-base-300/60 hover:bg-primary/20 hover:text-primary transition-colors font-mono"
                                        >
                                          {v.replace(/\{\{|\}\}/g, "")}
                                        </button>
                                      ))}
                                    </div>
                                    <textarea
                                      id={`msg-${idx}`}
                                      className={`textarea textarea-bordered w-full bg-base-300/50 text-sm h-32 resize-none font-mono ${ws.templateIds.length > 0 ? "opacity-40 pointer-events-none" : ""}`}
                                      placeholder="Hi {{first_name}}, I noticed..."
                                      value={ws.messageBody}
                                      onChange={(e) => updateStep(idx, { messageBody: e.target.value })}
                                      disabled={ws.templateIds.length > 0}
                                    />
                                    <p className="text-xs text-base-content/30 mt-1">{ws.messageBody.length} chars</p>
                                  </div>
                                  <div className="w-48 shrink-0">
                                    <p className="text-xs text-base-content/40 mb-2">Preview</p>
                                    <div className="bg-base-300/40 border border-base-300/50 rounded-lg p-3 h-32 overflow-y-auto">
                                      <p className="text-xs text-base-content/80 whitespace-pre-wrap break-words">
                                        {ws.messageBody
                                          .replace(/\{\{first_name\}\}/g, "Alex")
                                          .replace(/\{\{last_name\}\}/g, "Johnson")
                                          .replace(/\{\{company\}\}/g, "Acme Corp")
                                          .replace(/\{\{title\}\}/g, "Head of Growth") || (
                                          <span className="text-base-content/20 italic">Preview will appear here...</span>
                                        )}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Add step buttons */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-base-content/30 mr-1">Add step:</span>
                    {(["visit", "connect", "message"] as const).map((type) => {
                      const disabled = type === "connect" && hasConnect;
                      const title = disabled ? "Connection step can only be added once" : undefined;
                      return (
                        <button
                          key={type}
                          onClick={() => !disabled && addWizardStep(type)}
                          title={title}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors text-sm ${
                            disabled
                              ? "border-base-300/20 bg-base-200/40 text-base-content/20 cursor-not-allowed"
                              : "border-base-300/50 bg-base-200 hover:border-base-300 text-base-content/60 hover:text-base-content"
                          }`}
                        >
                          <RiAddLine size={13} />
                          {STEP_LABELS[type]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Page: Account ── */}
              {page === "account" && (
                <div>
                  <h2 className="text-xl font-semibold mb-1">Choose your LinkedIn account</h2>
                  <p className="text-base-content/50 text-sm mb-6">
                    Select the account that will execute this campaign.
                  </p>
                  <div className="flex flex-col gap-2">
                    {accounts.filter((a) => a.is_authenticated).length === 0 ? (
                      <p className="text-sm text-warning">
                        No authenticated accounts.{" "}
                        <Link href="/accounts" className="underline">Authenticate one first.</Link>
                      </p>
                    ) : accounts.filter((a) => a.is_authenticated).map((a) => {
                      const connLeft = a.daily_connection_limit - a.connections_today;
                      const msgLeft = a.daily_message_limit - a.messages_today;
                      return (
                        <button
                          key={a.id}
                          onClick={() => setAccountId(String(a.id))}
                          className={`flex items-center gap-4 px-4 py-3 rounded-xl border transition-colors text-left ${
                            accountId === String(a.id)
                              ? "bg-primary/10 border-primary/40"
                              : "bg-base-200 border-base-300/50 hover:border-base-300"
                          }`}
                        >
                          <span className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${accountId === String(a.id) ? "bg-primary text-primary-content" : "bg-base-300 text-base-content/60"}`}>
                            {a.name.charAt(0).toUpperCase()}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className={`font-medium text-sm ${accountId === String(a.id) ? "text-primary" : ""}`}>{a.name}</p>
                            <p className="text-xs text-base-content/40">{connLeft} connections left today · {msgLeft} messages left today</p>
                          </div>
                          {accountId === String(a.id) && <span className="ml-auto text-primary text-xs font-semibold shrink-0">Selected</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Page: Summary ── */}
              {page === "summary" && (
                <div>
                  <h2 className="text-xl font-semibold mb-1">Ready to launch</h2>
                  <p className="text-base-content/50 text-sm mb-6">Review your campaign before starting.</p>
                  <div className="bg-base-200 border border-base-300/50 rounded-xl p-5 space-y-4 mb-6">
                    <div className="flex justify-between text-sm">
                      <span className="text-base-content/50">Campaign</span>
                      <span className="font-medium">{workflowName}</span>
                    </div>
                    <div className="h-px bg-base-300/50" />
                    <div className="flex justify-between text-sm">
                      <span className="text-base-content/50">Prospects list</span>
                      <div className="text-right">
                        <p className="font-medium">{selectedList?.name}</p>
                        <p className="text-xs text-base-content/40">
                          {selectedTargetIds.size === listTargets.length
                            ? `${selectedTargetIds.size} prospects (all)`
                            : `${selectedTargetIds.size} of ${listTargets.length} selected`}
                        </p>
                      </div>
                    </div>
                    <div className="h-px bg-base-300/50" />
                    <div className="flex justify-between text-sm">
                      <span className="text-base-content/50">Account</span>
                      <span className="font-medium">{selectedAccount?.name}</span>
                    </div>
                    <div className="h-px bg-base-300/50" />
                    <div className="flex justify-between text-sm">
                      <span className="text-base-content/50">Steps</span>
                      <div className="text-right space-y-1">
                        {wizardSteps.map((ws, i) => (
                          <div key={i}>
                            {ws.delayDaysBefore > 0 && (
                              <p className="text-xs text-base-content/30 flex items-center gap-1 justify-end">
                                <RiTimeLine size={10} /> Wait {ws.delayDaysBefore}d
                              </p>
                            )}
                            <p className="font-medium text-sm">{STEP_LABELS[ws.type]}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  {conflicts && conflicts.blocked > 0 && (
                    <p className="text-xs text-warning mb-4">{conflicts.blocked} prospects active elsewhere will be excluded.</p>
                  )}
                  <p className="text-xs text-base-content/40">The campaign starts immediately after you click Launch.</p>
                </div>
              )}
            </div>
          </div>

          {/* Bottom nav */}
          <div className="border-t border-base-300/50 px-10 py-4 flex justify-between items-center shrink-0">
            <div className="flex items-center gap-2">
              <button
                className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-300/50 transition-colors disabled:opacity-40"
                onClick={pageIdx === 0 ? onClose : () => setPage(pages[pageIdx - 1])}
                disabled={launching || saving}
              >
                {pageIdx === 0 ? "Cancel" : "← Back"}
              </button>
              {page === "steps" && wizardSteps.length > 0 && (
                <button
                  className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/40 hover:text-base-content/60 hover:bg-base-300/50 transition-colors disabled:opacity-40"
                  onClick={saveAndClose}
                  disabled={saving}
                >
                  {saving ? <span className="loading loading-spinner loading-xs" /> : "Save steps only"}
                </button>
              )}
            </div>

            {page !== "summary" ? (
              <button
                className="inline-flex items-center px-6 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-40"
                disabled={
                  (page === "prospects" && (!prospectsReady || conflictsLoading)) ||
                  (page === "steps" && wizardSteps.length === 0) ||
                  (page === "account" && !accountId)
                }
                onClick={() => setPage(pages[pageIdx + 1])}
              >
                Next →
              </button>
            ) : (
              <button
                className="inline-flex items-center gap-1.5 px-8 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-40"
                onClick={launch}
                disabled={launching}
              >
                {launching
                  ? <><span className="loading loading-spinner loading-xs" /> Launching...</>
                  : "Launch Campaign"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WorkflowDetailPage({
  workflow: initial,
  lists,
  accounts,
  templates,
  autoSetup,
}: {
  workflow: WorkflowData;
  lists: List[];
  accounts: Account[];
  templates: Template[];
  autoSetup: boolean;
}) {
  const [workflowName, setWorkflowName] = useState(initial.name);
  const [steps, setSteps] = useState<Step[]>(initial.steps);
  const [stats, setStats] = useState<Stats | null>(null);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [prospectsTotal, setProspectsTotal] = useState(0);
  const [prospectsPage, setProspectsPage] = useState(0);
  const PROSPECTS_PAGE_SIZE = 25;
  // selectedStep holds the actual step_order value from DB (not UI action index)
  const [selectedStep, setSelectedStep] = useState<number | "completed" | "failed" | null>(null);
  const [showWizard, setShowWizard] = useState(autoSetup || initial.steps.length === 0);
  const [showStop, setShowStop] = useState(false);
  const router = useRouter();

  // Strip ?setup=1 from URL so refreshing doesn't re-open the wizard
  useEffect(() => {
    if (autoSetup) router.replace(`/workflows/${initial.id}`, undefined, { shallow: true });
  }, []);

  const activeRun = stats?.active_run ?? initial.active_run;
  const isRunning = activeRun?.status === "running";
  const isPaused = activeRun?.status === "paused";
  const isActive = isRunning || isPaused;

  const actionSteps = steps.filter((s) => s.step_type !== "delay");

  const refreshStats = useCallback(async () => {
    const res = await fetch(`/api/workflows/${initial.id}/stats`);
    if (res.ok) setStats(await res.json());
  }, [initial.id]);

  const refreshProspects = useCallback(async () => {
    const params = new URLSearchParams();
    if (selectedStep !== null && selectedStep !== "completed" && selectedStep !== "failed") {
      params.set("step", String(selectedStep));
    }
    if (selectedStep === "completed") params.set("state", "completed");
    if (selectedStep === "failed") params.set("state", "failed");
    params.set("page", String(prospectsPage));
    const res = await fetch(`/api/workflows/${initial.id}/prospects?${params}`);
    if (res.ok) {
      const data = await res.json();
      setProspects(data.prospects);
      setProspectsTotal(data.total);
    }
  }, [initial.id, selectedStep, prospectsPage]);

  const refreshSteps = useCallback(async () => {
    const res = await fetch(`/api/workflows/${initial.id}/steps`);
    if (res.ok) setSteps(await res.json());
  }, [initial.id]);

  // Reset to page 0 when filter changes
  useEffect(() => { setProspectsPage(0); }, [selectedStep]);

  useEffect(() => {
    refreshStats();
    refreshProspects();
  }, [refreshStats, refreshProspects]);

  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => {
      refreshStats();
      refreshProspects();
    }, 5000);
    return () => clearInterval(interval);
  }, [isActive, refreshStats, refreshProspects]);

  async function pauseRun() {
    if (!activeRun) return;
    await fetch(`/api/runs/${activeRun.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "paused" }),
    });
    toast.success("Paused");
    refreshStats();
  }

  async function resumeRun() {
    if (!activeRun) return;
    await fetch(`/api/runs/${activeRun.id}/start`, { method: "POST" });
    toast.success("Resumed");
    refreshStats();
  }

  async function stopRun() {
    if (!activeRun) return;
    await fetch(`/api/runs/${activeRun.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    toast.success("Campaign stopped");
    setShowStop(false);
    refreshStats();
    refreshProspects();
  }

  const displayStats = stats ?? {
    total_prospects: 0,
    active_prospects: 0,
    completed_prospects: 0,
    failed_prospects: 0,
    connections_sent: 0,
    connections_accepted: 0,
    acceptance_rate: 0,
    messages_sent: 0,
    active_run: initial.active_run,
  };

  return (
    <>
    <Head>
      <title>{workflowName} — Campaigns — Linki</title>
      <meta name="robots" content="noindex, nofollow" />
    </Head>
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link href="/workflows" className="w-8 h-8 rounded-lg flex items-center justify-center text-base-content/50 hover:bg-base-200 hover:text-base-content transition-colors shrink-0">
          <RiArrowLeftLine size={16} />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{workflowName}</h1>
            {isRunning && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-primary/15 text-primary">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse inline-block" />
                Running
              </span>
            )}
            {isPaused && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-warning/15 text-warning">
                Paused
              </span>
            )}
            {!isActive && displayStats.total_prospects > 0 && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-base-300 text-base-content/40">
                Idle
              </span>
            )}
            {displayStats.acceptance_rate > 0 && (
              <span className="text-sm text-base-content/50">{displayStats.acceptance_rate}% accepted</span>
            )}
          </div>
          {activeRun && (
            <p className="text-xs text-base-content/40 mt-0.5">
              {activeRun.list_name} · {activeRun.account_name}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <>
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-warning/15 text-warning border border-warning/25 hover:bg-warning/25 transition-colors"
                onClick={pauseRun}
              >
                <RiPauseLine size={14} /> Pause
              </button>
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors"
                onClick={() => setShowStop(true)}
              >
                <RiStopLine size={14} /> Stop
              </button>
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-base-200 text-base-content/70 border border-base-300/60 hover:border-base-300 hover:text-base-content transition-colors"
                onClick={() => setShowWizard(true)}
              >
                <RiAddLine size={14} /> Add contacts
              </button>
            </>
          )}
          {isPaused && (
            <>
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary/15 text-primary border border-primary/25 hover:bg-primary/25 transition-colors"
                onClick={resumeRun}
              >
                <RiPlayLine size={14} /> Resume
              </button>
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors"
                onClick={() => setShowStop(true)}
              >
                <RiStopLine size={14} /> Stop
              </button>
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-base-200 text-base-content/70 border border-base-300/60 hover:border-base-300 hover:text-base-content transition-colors"
                onClick={() => setShowWizard(true)}
              >
                <RiAddLine size={14} /> Add contacts
              </button>
            </>
          )}
          {!isActive && (
            <button
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors"
              onClick={() => setShowWizard(true)}
            >
              <RiAddLine size={14} /> Add Prospects
            </button>
          )}
        </div>
      </div>

      {/* Stats row */}
      {displayStats.total_prospects > 0 && (
        <div className="flex items-center gap-3 mb-6 pl-11">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-base-200 border border-base-300/50">
            <span className="text-lg font-semibold">{displayStats.total_prospects}</span>
            <span className="text-xs text-base-content/50">prospects</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-base-200 border border-base-300/50">
            <span className="text-lg font-semibold text-success">{displayStats.completed_prospects}</span>
            <span className="text-xs text-base-content/50">completed</span>
          </div>
          {displayStats.connections_sent > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-base-200 border border-base-300/50">
              <span className="text-lg font-semibold text-primary">{displayStats.connections_sent}</span>
              <span className="text-xs text-base-content/50">connections sent</span>
            </div>
          )}
          {displayStats.messages_sent > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-base-200 border border-base-300/50">
              <span className="text-lg font-semibold text-info">{displayStats.messages_sent}</span>
              <span className="text-xs text-base-content/50">messages sent</span>
            </div>
          )}
        </div>
      )}

      {/* Main layout */}
      <div className="flex gap-8">
        {/* Sidebar */}
        <div className="w-52 shrink-0">
          {/* All prospects */}
          <button
            onClick={() => setSelectedStep(null)}
            className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors mb-4 flex items-center justify-between ${selectedStep === null ? "bg-primary/10 border border-primary/30 text-primary" : "hover:bg-base-200 text-base-content/60 border border-transparent"}`}
          >
            <span className="font-medium">All prospects</span>
            {displayStats.total_prospects > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-md ${selectedStep === null ? "bg-primary/20 text-primary" : "bg-base-300 text-base-content/40"}`}>
                {displayStats.total_prospects}
              </span>
            )}
          </button>

          {actionSteps.length > 0 && (
            <div>
              <p className="text-xs text-base-content/30 uppercase tracking-widest px-1 mb-3">Pipeline</p>

              {/* Build pipeline — each step clickable, filter by step_order (real DB value) */}
              <div className="flex flex-col">
              {steps.map((step, idx) => {
                const isSelected = selectedStep === step.step_order;
                const isFirst = idx === 0;
                if (step.step_type === "delay") {
                  const days = Math.round(step.delay_seconds / 86400);
                  return (
                    <div key={step.id} className="flex flex-col items-stretch">
                      {/* connector line into delay */}
                      <div className="flex justify-center"><div className="w-px h-3 bg-base-content/20" /></div>
                      <button
                        onClick={() => setSelectedStep(isSelected ? null : step.step_order)}
                        className={`w-full flex items-center gap-2 py-1.5 px-3 rounded-lg transition-colors border ${isSelected ? "bg-warning/10 border-warning/20" : "border-transparent hover:bg-base-200/60"}`}
                      >
                        <div className="flex flex-col items-center gap-0.5 shrink-0">
                          <RiTimeLine size={11} className={isSelected ? "text-warning" : "text-base-content/30"} />
                        </div>
                        <span className={`text-xs ${isSelected ? "text-warning" : "text-base-content/40"}`}>
                          {days > 0 ? `Wait ${days}d` : "Delay"}
                        </span>
                      </button>
                      {/* connector line out of delay */}
                      <div className="flex justify-center"><div className="w-px h-3 bg-base-content/20" /></div>
                    </div>
                  );
                }
                return (
                  <div key={step.id} className="flex flex-col items-stretch">
                    {/* connector between consecutive action steps (no delay in between) */}
                    {!isFirst && steps[idx - 1]?.step_type !== "delay" && (
                      <div className="flex justify-center"><div className="w-px h-4 bg-base-content/20" /></div>
                    )}
                    <button
                      onClick={() => setSelectedStep(isSelected ? null : step.step_order)}
                      className={`w-full text-left px-3 py-3 rounded-xl transition-all flex items-center gap-3 border ${isSelected ? "bg-primary/10 border-primary/30" : "bg-base-200 border-base-300/40 hover:border-base-300/80"}`}
                    >
                      <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs border ${isSelected ? "bg-primary/20 border-primary/40 text-primary" : `${STEP_COLORS[step.step_type]}`}`}>
                        {STEP_ICONS[step.step_type]}
                      </span>
                      <p className={`text-xs font-medium leading-tight ${isSelected ? "text-primary" : "text-base-content"}`}>
                        {STEP_LABELS[step.step_type] ?? step.step_type}
                      </p>
                    </button>
                  </div>
                );
              })}
              </div>

              {/* Outcome filters */}
              {displayStats.total_prospects > 0 && (
                <div className="mt-4 pt-4 border-t border-base-300/30 flex flex-col gap-1.5">
                  <button
                    onClick={() => setSelectedStep(selectedStep === "completed" ? null : "completed")}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs transition-all flex items-center gap-2.5 border ${selectedStep === "completed" ? "text-success bg-success/10 border-success/20" : "text-base-content/50 hover:text-success bg-base-200 border-base-300/40 hover:border-success/20"}`}
                  >
                    <span className="w-2 h-2 rounded-full bg-success shrink-0" />
                    <span className="font-medium">{displayStats.completed_prospects} completed</span>
                  </button>
                  {displayStats.failed_prospects > 0 && (
                    <button
                      onClick={() => setSelectedStep(selectedStep === "failed" ? null : "failed")}
                      className={`w-full text-left px-3 py-2.5 rounded-xl text-xs transition-all flex items-center gap-2.5 border ${selectedStep === "failed" ? "text-error bg-error/10 border-error/20" : "text-base-content/50 hover:text-error bg-base-200 border-base-300/40 hover:border-error/20"}`}
                    >
                      <span className="w-2 h-2 rounded-full bg-error shrink-0" />
                      <span className="font-medium">{displayStats.failed_prospects} failed / skipped</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Prospects table */}
        <div className="flex-1 min-w-0">
          {displayStats.total_prospects === 0 ? (
            <div className="text-center py-20 text-base-content/40 text-sm border border-base-300/50 rounded-lg">
              {steps.length === 0
                ? <span>No steps configured yet. <button className="text-primary underline" onClick={() => setShowWizard(true)}>Set up this campaign.</button></span>
                : <span>No prospects yet. <button className="text-primary underline" onClick={() => setShowWizard(true)}>Add prospects to start.</button></span>}
            </div>
          ) : (
            <div>
              <div className="overflow-x-auto rounded-lg border border-base-300/50">
                <table className="table w-full text-sm">
                  <thead>
                    <tr className="border-base-300/50 text-base-content/50 text-xs uppercase tracking-wide">
                      <th>Name</th>
                      <th>Company</th>
                      <th>Step</th>
                      <th>Status</th>
                      <th>Next Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prospects.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center text-base-content/30 py-8 text-xs">
                          No prospects match this filter.
                        </td>
                      </tr>
                    )}
                    {prospects.map((p) => (
                      <tr
                        key={p.id}
                        className="border-base-300/30 hover:bg-base-200/50 cursor-pointer"
                        onClick={() => window.open(p.linkedin_url, "_blank")}
                      >
                        <td>
                          <p className="font-medium text-sm">{p.full_name ?? "—"}</p>
                          {p.title && <p className="text-xs text-base-content/40 truncate max-w-40">{p.title}</p>}
                        </td>
                        <td className="text-xs text-base-content/60">{p.company ?? "—"}</td>
                        <td className="text-xs text-base-content/60">
                          {p.step_type === "connect" && p.connection_requested_at
                            ? "Awaiting acceptance"
                            : p.step_type ? (STEP_LABELS[p.step_type] ?? p.step_type) : "—"}
                        </td>
                        <td>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${STATE_PILL[p.state] ?? "bg-base-300 text-base-content/50"}`}>
                            {p.state.replace("_", " ")}
                          </span>
                        </td>
                        <td className="text-xs text-base-content/50">
                          {formatNextAction(p.next_step_at, p.state)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {prospectsTotal > PROSPECTS_PAGE_SIZE && (
                <div className="flex items-center justify-between mt-3 text-sm text-base-content/50">
                  <span className="text-xs">{prospectsPage * PROSPECTS_PAGE_SIZE + 1}–{Math.min((prospectsPage + 1) * PROSPECTS_PAGE_SIZE, prospectsTotal)} of {prospectsTotal}</span>
                  <div className="flex items-center gap-1">
                    <button
                      className="inline-flex items-center justify-center w-6 h-6 rounded text-base-content/50 hover:text-base-content hover:bg-base-300/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      onClick={() => setProspectsPage((p) => p - 1)}
                      disabled={prospectsPage === 0}
                    >
                      <RiArrowLeftSLine size={15} />
                    </button>
                    <span className="px-2 text-xs">{prospectsPage + 1} / {Math.ceil(prospectsTotal / PROSPECTS_PAGE_SIZE)}</span>
                    <button
                      className="inline-flex items-center justify-center w-6 h-6 rounded text-base-content/50 hover:text-base-content hover:bg-base-300/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      onClick={() => setProspectsPage((p) => p + 1)}
                      disabled={prospectsPage >= Math.ceil(prospectsTotal / PROSPECTS_PAGE_SIZE) - 1}
                    >
                      <RiArrowRightSLine size={15} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Wizard */}
      {showWizard && (
        <Wizard
          workflowId={initial.id}
          workflowName={workflowName}
          initialSteps={steps}
          lists={lists}
          accounts={accounts}
          templates={templates}
          onClose={() => { setShowWizard(false); refreshSteps(); }}
          onLaunched={() => { setShowWizard(false); refreshSteps(); refreshStats(); refreshProspects(); }}
          onRenamed={setWorkflowName}
        />
      )}

      {/* Stop confirm */}
      {showStop && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-200 border border-base-300/50 max-w-sm">
            <h3 className="font-semibold text-base mb-2">Stop campaign?</h3>
            <p className="text-sm text-base-content/60 mb-4">
              This will mark the campaign as completed. Active prospects stay in their current state.
            </p>
            <div className="modal-action">
              <button className="px-4 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-300 transition-colors" onClick={() => setShowStop(false)}>Cancel</button>
              <button className="px-4 py-1.5 rounded-lg text-sm font-medium bg-error/15 text-error border border-error/25 hover:bg-error/25 transition-colors" onClick={stopRun}>Stop Campaign</button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setShowStop(false)} />
        </div>
      )}
    </div>
    </>
  );
}
