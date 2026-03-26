import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";
import { getSessionPage, saveSessionState, getSessionContext } from "@/lib/linkedin/session";
import { visitProfile } from "@/lib/linkedin/visit";
import { sendConnectionRequest, WeeklyLimitError, AlreadyConnectedError, PendingInviteError } from "@/lib/linkedin/connect";
import { sendMessage } from "@/lib/linkedin/message";
import { shouldSyncInbox, syncAccountInbox } from "@/lib/linkedin/inbox";

// Initial wait before first acceptance check (6h)
const CONNECTION_RECHECK_HOURS = 6;
// Max days to wait for acceptance before giving up
const CONNECTION_MAX_WAIT_DAYS = 7;
// Delay between profiles (seconds)
const PROFILE_DELAY_MIN = 8;
const PROFILE_DELAY_MAX = 20;
// Poll interval (ms)
const POLL_INTERVAL_MS = 30_000;

interface AccountLimits {
  daily_connection_limit: number;
  daily_message_limit: number;
  active_hours_start: number;
  active_hours_end: number;
  timezone: string;
  working_days: string;
}

function getLocalParts(tz: string, date = new Date()): { hour: number; minute: number; isoWeekday: number } {
  const safeZone = (() => { try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return tz; } catch { return "UTC"; } })();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone,
    hour: "numeric", minute: "numeric", weekday: "short", hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  const hour = parseInt(get("hour"), 10) % 24;
  const minute = parseInt(get("minute"), 10);
  const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { hour, minute, isoWeekday: weekdayMap[get("weekday")] ?? 1 };
}

function isWithinSchedule(account: AccountLimits): boolean {
  const { hour, minute, isoWeekday } = getLocalParts(account.timezone || "UTC");
  const allowedDays = (account.working_days || "1,2,3,4,5").split(",").map(Number);
  if (!allowedDays.includes(isoWeekday)) return false;
  const frac = hour + minute / 60;
  return frac >= (account.active_hours_start ?? 9) && frac < (account.active_hours_end ?? 18);
}

function randomSlotInActiveWindow(account: AccountLimits, targetDate?: Date): string {
  const start = account.active_hours_start ?? 9;
  const end = account.active_hours_end ?? 18;
  const base = targetDate ? new Date(targetDate) : new Date();
  const startMs = new Date(base.getFullYear(), base.getMonth(), base.getDate(), start, 0, 0).getTime();
  const endMs   = new Date(base.getFullYear(), base.getMonth(), base.getDate(), end,   0, 0).getTime();
  return new Date(startMs + Math.random() * (endMs - startMs)).toISOString();
}

function rescheduleToTomorrow(account: AccountLimits): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return randomSlotInActiveWindow(account, tomorrow);
}

function nextScheduledSlot(account: AccountLimits): string {
  const tz = account.timezone || "UTC";
  const allowedDays = (account.working_days || "1,2,3,4,5").split(",").map(Number);
  const end = account.active_hours_end ?? 18;
  const { hour: nowHour, minute: nowMin, isoWeekday: nowDay } = getLocalParts(tz);
  const nowFrac = nowHour + nowMin / 60;
  if (allowedDays.includes(nowDay) && nowFrac < end - 0.25) {
    const remaining = (end - nowFrac) * 3600_000;
    return new Date(Date.now() + Math.random() * remaining).toISOString();
  }
  const candidate = new Date();
  for (let i = 1; i <= 14; i++) {
    candidate.setDate(candidate.getDate() + 1);
    const { isoWeekday } = getLocalParts(tz, candidate);
    if (allowedDays.includes(isoWeekday)) return randomSlotInActiveWindow(account, candidate);
  }
  return new Date(Date.now() + 86_400_000).toISOString();
}

interface WorkflowStep {
  id: string;
  step_order: number;
  step_type: "visit" | "connect" | "message" | "delay";
  template_id: string | null;
  delay_seconds: number;
  connect_note: string | null;
  message_body: string | null;
}

interface RunProfile {
  id: string;
  run_id: string;
  target_id: string;
  state: string;
  current_step: number;
  next_step_at: string | null;
  error_message: string | null;
}

interface Target {
  id: string;
  linkedin_url: string;
  sales_nav_url: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  degree: number | null;
  connection_requested_at: string | null;
  connected_at: string | null;
}

interface Template { id: string; body: string; }

// ─── helpers ────────────────────────────────────────────────────────────────

function log(db: ReturnType<typeof getDb>, runId: string, targetId: string | null, level: "info" | "warn" | "error", message: string) {
  db.prepare("INSERT INTO logs (id, run_id, target_id, level, message) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), runId, targetId, level, message);
  console.log(`[runner] [${level}] run=${runId} target=${targetId ?? "-"} ${message}`);
}

function renderTemplate(body: string, target: Target): string {
  return body
    .replace(/\{\{first_name\}\}/gi, target.first_name ?? target.full_name?.split(" ")[0] ?? "")
    .replace(/\{\{last_name\}\}/gi,  target.last_name ?? target.full_name?.split(" ").slice(1).join(" ") ?? "")
    .replace(/\{\{full_name\}\}/gi,  target.full_name ?? "")
    .replace(/\{\{company\}\}/gi,    target.company ?? "")
    .replace(/\{\{title\}\}/gi,      target.title ?? "")
    .replace(/\{\{location\}\}/gi,   target.location ?? "")
    .trim();
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function randomDelay(minSec: number, maxSec: number) { return sleep((minSec + Math.random() * (maxSec - minSec)) * 1000); }
function nowIso() { return new Date().toISOString(); }
function addHours(h: number) { return new Date(Date.now() + h * 3600_000).toISOString(); }
function hoursSince(isoStr: string) { return (Date.now() - new Date(isoStr).getTime()) / 3600_000; }

// ─── URL resolution ──────────────────────────────────────────────────────────

async function resolveLinkedinUrl(db: ReturnType<typeof getDb>, target: Target, accountId: string): Promise<string> {
  if (target.linkedin_url?.includes("/in/")) return target.linkedin_url;
  const salesNavUrl = target.sales_nav_url ?? target.linkedin_url;
  if (!salesNavUrl) throw new Error(`${target.full_name ?? target.id} has no Sales Nav URL to resolve from`);
  const leadMatch = salesNavUrl.match(/\/sales\/lead\/(.+)/);
  if (!leadMatch) throw new Error(`${target.full_name ?? target.id} has no Sales Nav lead URL — cannot resolve LinkedIn URL`);

  const page = await getSessionPage(accountId);
  let profileJson: Record<string, unknown> | null = null;
  try {
    page.on("response", async (response) => {
      if (response.url().includes("salesApiProfiles/") && response.status() === 200 && !profileJson) {
        try { profileJson = await response.json() as Record<string, unknown>; } catch { /* ignore */ }
      }
    });
    await page.goto(`https://www.linkedin.com/sales/lead/${leadMatch[1]}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(10000);
  } finally {
    await page.close();
  }

  const p = profileJson as Record<string, unknown> | null;
  const flagshipUrl = typeof p?.flagshipProfileUrl === "string" ? p.flagshipProfileUrl : null;
  if (!flagshipUrl) throw new Error(`Could not resolve LinkedIn URL for ${target.full_name ?? target.id}`);
  const linkedinUrl = flagshipUrl.endsWith("/") ? flagshipUrl : flagshipUrl + "/";
  db.prepare(`UPDATE targets SET linkedin_url = ?, linkedin_member_urn = COALESCE(linkedin_member_urn, ?), headline = COALESCE(headline, ?), summary = COALESCE(summary, ?) WHERE id = ?`).run(
    linkedinUrl,
    typeof p?.objectUrn === "string" ? p.objectUrn : null,
    typeof p?.headline === "string" ? p.headline : null,
    typeof p?.summary === "string" ? p.summary : null,
    target.id
  );
  return linkedinUrl;
}

async function getLinkedinUrl(db: ReturnType<typeof getDb>, target: Target, accountId: string): Promise<string> {
  if (target.linkedin_url?.includes("/in/")) return target.linkedin_url;
  return resolveLinkedinUrl(db, target, accountId);
}

// ─── connection status check ─────────────────────────────────────────────────

async function checkConnectionStatusOnProfile(accountId: string, linkedinUrl: string): Promise<"connected" | "pending" | "unknown"> {
  const page = await getSessionPage(accountId);
  try {
    await page.goto(linkedinUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    try {
      const moreBtn = page.locator('button[aria-label="More"]').last();
      if (await moreBtn.isVisible({ timeout: 2000 })) {
        await moreBtn.click();
        await page.waitForTimeout(800);
      }
    } catch { /* menu may not exist */ }
    const result = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      const is1st = /·\s*1st(\s+degree)?\s*[·|\n]/i.test(bodyText) || /·\s*1º\s*[·|\n]/i.test(bodyText);
      const hasPending = /\bPending\b/i.test(bodyText);
      return { is1st, hasPending };
    });
    if (result.is1st && !result.hasPending) return "connected";
    if (result.hasPending) return "pending";
    return "unknown";
  } finally {
    await page.close();
  }
}

// ─── step execution ──────────────────────────────────────────────────────────

function advanceStep(db: ReturnType<typeof getDb>, rp: RunProfile, steps: WorkflowStep[], currentIndex: number) {
  const nextIndex = currentIndex + 1;
  if (nextIndex >= steps.length) {
    db.prepare("UPDATE run_profiles SET state = 'completed', current_step = ?, last_step_at = datetime('now'), next_step_at = NULL WHERE id = ?").run(nextIndex, rp.id);
  } else {
    const nextStep = steps[nextIndex];
    const nextAt = nextStep.delay_seconds > 0 ? new Date(Date.now() + nextStep.delay_seconds * 1000).toISOString() : null;
    db.prepare("UPDATE run_profiles SET current_step = ?, last_step_at = datetime('now'), next_step_at = ? WHERE id = ?").run(nextIndex, nextAt, rp.id);
  }
}

async function executeStep(
  db: ReturnType<typeof getDb>,
  runId: string,
  rp: RunProfile,
  target: Target,
  steps: WorkflowStep[],
  accountId: string,
  accountLimits: AccountLimits
): Promise<void> {
  const stepIndex = rp.current_step;
  if (stepIndex >= steps.length) {
    db.prepare("UPDATE run_profiles SET state = 'completed', last_step_at = datetime('now') WHERE id = ?").run(rp.id);
    return;
  }

  // Auto-unenroll if lead has replied
  const replyCheck = db.prepare("SELECT last_replied_at FROM targets WHERE id = ?").get(target.id) as { last_replied_at: string | null };
  if (replyCheck?.last_replied_at) {
    log(db, runId, target.id, "info", `${target.full_name ?? target.linkedin_url} replied — unenrolling from workflow`);
    db.prepare("UPDATE run_profiles SET state = 'skipped', error_message = 'Lead replied' WHERE id = ?").run(rp.id);
    return;
  }

  const step = steps[stepIndex];
  const name = target.full_name ?? target.linkedin_url;

  try {
    if (step.step_type === "delay") {
      advanceStep(db, rp, steps, stepIndex);
      log(db, runId, target.id, "info", `Delay step passed for ${name}`);
      return;
    }

    if (step.step_type === "visit") {
      db.prepare("UPDATE run_profiles SET last_step_at = datetime('now') WHERE id = ?").run(rp.id);
      log(db, runId, target.id, "info", `Visiting ${name}`);
      const linkedinUrl = await getLinkedinUrl(db, target, accountId);
      const page = await getSessionPage(accountId);
      try { await visitProfile(page, linkedinUrl); } finally { await page.close(); }
      await saveSessionState(accountId);
      advanceStep(db, rp, steps, stepIndex);
      log(db, runId, target.id, "info", `Visited ${name}`);

    } else if (step.step_type === "connect") {
      // Check working schedule
      if (!isWithinSchedule(accountLimits)) {
        const nextSlot = nextScheduledSlot(accountLimits);
        log(db, runId, target.id, "info", `Outside working schedule — rescheduling ${name} to ${nextSlot}`);
        db.prepare("UPDATE run_profiles SET next_step_at = ? WHERE id = ?").run(nextSlot, rp.id);
        return;
      }

      // Skip if already connected
      const freshTarget = db.prepare("SELECT * FROM targets WHERE id = ?").get(target.id) as Target;
      if (freshTarget.degree === 1) {
        if (!freshTarget.connected_at) db.prepare("UPDATE targets SET connected_at = ? WHERE id = ?").run(nowIso(), target.id);
        log(db, runId, target.id, "info", `${name} already connected — skipping connect step`);
        advanceStep(db, rp, steps, stepIndex);
        return;
      }

      // If request already sent, check acceptance
      if (freshTarget.connection_requested_at) {
        const hoursSinceRequest = hoursSince(freshTarget.connection_requested_at);
        if (hoursSinceRequest / 24 > CONNECTION_MAX_WAIT_DAYS) {
          log(db, runId, target.id, "warn", `${name} did not accept after ${CONNECTION_MAX_WAIT_DAYS} days — skipping`);
          db.prepare("UPDATE run_profiles SET state = 'skipped' WHERE id = ?").run(rp.id);
          return;
        }
        log(db, runId, target.id, "info", `Checking acceptance status for ${name}`);
        const linkedinUrl = await getLinkedinUrl(db, target, accountId);
        const status = await checkConnectionStatusOnProfile(accountId, linkedinUrl);
        await saveSessionState(accountId);
        if (status === "connected") {
          db.prepare("UPDATE targets SET degree = 1, connected_at = ? WHERE id = ?").run(nowIso(), target.id);
          log(db, runId, target.id, "info", `${name} accepted connection — advancing`);
          advanceStep(db, rp, steps, stepIndex);
          return;
        }
        const recheckHours = Math.min(96, Math.max(CONNECTION_RECHECK_HOURS, hoursSinceRequest));
        log(db, runId, target.id, "info", `${name} not yet connected (status: ${status}) — rechecking in ${recheckHours}h`);
        db.prepare("UPDATE run_profiles SET next_step_at = ? WHERE id = ?").run(addHours(recheckHours), rp.id);
        return;
      }

      // Send connection request
      db.prepare("UPDATE run_profiles SET last_step_at = datetime('now') WHERE id = ?").run(rp.id);
      log(db, runId, target.id, "info", `Sending connection request to ${name}`);
      const linkedinUrl = await getLinkedinUrl(db, target, accountId);
      const page = await getSessionPage(accountId);
      try { await sendConnectionRequest(page, linkedinUrl); } finally { await page.close(); }
      await saveSessionState(accountId);
      db.prepare("UPDATE targets SET connection_requested_at = ? WHERE id = ?").run(nowIso(), target.id);
      db.prepare("UPDATE run_profiles SET next_step_at = ? WHERE id = ?").run(addHours(CONNECTION_RECHECK_HOURS), rp.id);
      log(db, runId, target.id, "info", `Connection request sent to ${name} — will recheck in ${CONNECTION_RECHECK_HOURS}h`);

    } else if (step.step_type === "message") {
      // Check working schedule
      if (!isWithinSchedule(accountLimits)) {
        const nextSlot = nextScheduledSlot(accountLimits);
        log(db, runId, target.id, "info", `Outside working schedule — rescheduling ${name} to ${nextSlot}`);
        db.prepare("UPDATE run_profiles SET next_step_at = ? WHERE id = ?").run(nextSlot, rp.id);
        return;
      }

      // Check connection before messaging
      const freshTarget = db.prepare("SELECT * FROM targets WHERE id = ?").get(target.id) as Target;
      if (freshTarget.degree !== 1) {
        const requested = freshTarget.connection_requested_at;
        if (requested && hoursSince(requested) / 24 > CONNECTION_MAX_WAIT_DAYS) {
          log(db, runId, target.id, "warn", `${name} never accepted — skipping message step`);
          db.prepare("UPDATE run_profiles SET state = 'skipped' WHERE id = ?").run(rp.id);
          return;
        }
        log(db, runId, target.id, "info", `${name} not yet connected — rescheduling message in ${CONNECTION_RECHECK_HOURS}h`);
        db.prepare("UPDATE run_profiles SET next_step_at = ? WHERE id = ?").run(addHours(CONNECTION_RECHECK_HOURS), rp.id);
        return;
      }

      // Resolve message text
      let messageText = "";
      const multiTemplateIds = (db.prepare("SELECT template_id FROM workflow_step_templates WHERE step_id = ?").all(step.id) as Array<{ template_id: string }>).map(r => r.template_id);
      if (multiTemplateIds.length > 0) {
        const randomId = multiTemplateIds[Math.floor(Math.random() * multiTemplateIds.length)];
        const tmpl = db.prepare("SELECT * FROM templates WHERE id = ?").get(randomId) as Template | undefined;
        if (tmpl) messageText = renderTemplate(tmpl.body, freshTarget);
      } else if (step.template_id) {
        const tmpl = db.prepare("SELECT * FROM templates WHERE id = ?").get(step.template_id) as Template | undefined;
        if (tmpl) messageText = renderTemplate(tmpl.body, freshTarget);
      }
      if (!messageText && step.message_body) messageText = renderTemplate(step.message_body, freshTarget);
      if (!messageText) {
        log(db, runId, target.id, "warn", `No message body for message step — skipping ${name}`);
        advanceStep(db, rp, steps, stepIndex);
        return;
      }

      db.prepare("UPDATE run_profiles SET last_step_at = datetime('now') WHERE id = ?").run(rp.id);
      log(db, runId, target.id, "info", `Sending message to ${name}`);
      const page = await getSessionPage(accountId);
      try {
        if (!target.full_name) throw new Error(`Target ${target.id} has no full_name — cannot search messaging`);
        await sendMessage(page, target.full_name, messageText);
      } finally {
        await page.close();
      }
      await saveSessionState(accountId);
      db.prepare("UPDATE targets SET message_sent_at = ? WHERE id = ?").run(nowIso(), target.id);
      advanceStep(db, rp, steps, stepIndex);
      log(db, runId, target.id, "info", `Message sent to ${name}`);
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof WeeklyLimitError) {
      log(db, runId, target.id, "error", `Weekly connection limit reached — pausing run`);
      db.prepare("UPDATE runs SET status = 'paused' WHERE id = ?").run(runId);
      return;
    }
    if (err instanceof AlreadyConnectedError) {
      log(db, runId, target.id, "info", `${name} already connected — advancing`);
      db.prepare("UPDATE targets SET degree = 1, connected_at = COALESCE(connected_at, ?) WHERE id = ?").run(nowIso(), target.id);
      advanceStep(db, rp, steps, stepIndex);
      return;
    }
    if (err instanceof PendingInviteError) {
      log(db, runId, target.id, "info", `${name} invite already pending — will recheck`);
      if (!target.connection_requested_at) db.prepare("UPDATE targets SET connection_requested_at = ? WHERE id = ?").run(nowIso(), target.id);
      db.prepare("UPDATE run_profiles SET next_step_at = ? WHERE id = ?").run(addHours(CONNECTION_RECHECK_HOURS), rp.id);
      return;
    }
    log(db, runId, target.id, "error", `Error on ${name}: ${msg}`);
    db.prepare("UPDATE run_profiles SET state = 'failed', error_message = ? WHERE id = ?").run(msg, rp.id);
  }
}

// ─── global loop ─────────────────────────────────────────────────────────────

// Survives HMR re-initialization within the same Node process
const g = global as typeof global & { __linkiGlobalRunnerStarted?: boolean };

export function ensureGlobalRunnerStarted(): void {
  if (g.__linkiGlobalRunnerStarted) return;
  g.__linkiGlobalRunnerStarted = true;
  globalLoop().catch(err => console.error("[runner] Global loop crashed:", err));
}

async function globalLoop(): Promise<void> {
  console.log("[runner] Global loop started");
  const db = getDb();

  while (true) {
    try {
      await tick(db);
    } catch (err) {
      console.error("[runner] Tick error:", err instanceof Error ? err.message : err);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function tick(db: ReturnType<typeof getDb>): Promise<void> {
  // Load all running runs with their account limits
  const activeRuns = db.prepare(`
    SELECT r.id as run_id, r.workflow_id, r.account_id,
           a.daily_connection_limit, a.daily_message_limit,
           a.active_hours_start, a.active_hours_end, a.timezone, a.working_days
    FROM runs r
    JOIN accounts a ON a.id = r.account_id
    WHERE r.status = 'running'
  `).all() as Array<{ run_id: string; workflow_id: string; account_id: string } & AccountLimits>;

  if (activeRuns.length === 0) return;

  console.log(`[runner] Tick — ${activeRuns.length} active run(s)`);

  // Sync inbox for each unique account (at most every 15 min)
  const seenAccounts = new Set<string>();
  for (const run of activeRuns) {
    if (seenAccounts.has(run.account_id)) continue;
    seenAccounts.add(run.account_id);
    if (shouldSyncInbox(run.account_id)) {
      try {
        console.log(`[runner] Starting inbox sync for account ${run.account_id}`);
        const ctx = await getSessionContext(run.account_id);
        const replies = await syncAccountInbox(ctx, run.account_id);
        console.log(`[runner] Inbox sync complete — ${replies} replies`);
        if (replies > 0) {
          for (const r of activeRuns.filter(x => x.account_id === run.account_id)) {
            log(db, r.run_id, null, "info", `Inbox sync: ${replies} new repl${replies === 1 ? "y" : "ies"} detected`);
          }
        }
      } catch (e) {
        console.warn("[runner] Inbox sync error:", e instanceof Error ? e.message : e);
      }
    }
  }

  // Auto-complete runs where all profiles are done
  for (const run of activeRuns) {
    const remaining = (db.prepare(
      "SELECT COUNT(*) as c FROM run_profiles WHERE run_id = ? AND state NOT IN ('completed', 'failed', 'skipped')"
    ).get(run.run_id) as { c: number }).c;
    if (remaining === 0) {
      db.prepare("UPDATE runs SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(run.run_id);
      log(db, run.run_id, null, "info", "All profiles processed — run completed");
    }
  }

  // Re-load active runs after potential completions
  const stillActive = db.prepare(`
    SELECT r.id as run_id, r.workflow_id, r.account_id,
           a.daily_connection_limit, a.daily_message_limit,
           a.active_hours_start, a.active_hours_end, a.timezone, a.working_days
    FROM runs r
    JOIN accounts a ON a.id = r.account_id
    WHERE r.status = 'running'
  `).all() as Array<{ run_id: string; workflow_id: string; account_id: string } & AccountLimits>;

  if (stillActive.length === 0) return;

  // Build a lookup: account_id → limits (all runs on same account share limits)
  const accountLimitsMap = new Map<string, AccountLimits>();
  for (const run of stillActive) {
    if (!accountLimitsMap.has(run.account_id)) accountLimitsMap.set(run.account_id, run);
  }

  // Count actions already done today per account
  const connectsSentToday = new Map<string, number>();
  const messagesSentToday = new Map<string, number>();
  for (const [accountId] of accountLimitsMap) {
    const c = (db.prepare(
      `SELECT COUNT(*) as c FROM logs WHERE run_id IN (SELECT id FROM runs WHERE account_id = ?)
       AND message LIKE 'Connection request sent%' AND date(created_at) = date('now')`
    ).get(accountId) as { c: number }).c;
    const m = (db.prepare(
      `SELECT COUNT(*) as c FROM logs WHERE run_id IN (SELECT id FROM runs WHERE account_id = ?)
       AND message LIKE 'Message sent%' AND date(created_at) = date('now')`
    ).get(accountId) as { c: number }).c;
    connectsSentToday.set(accountId, c);
    messagesSentToday.set(accountId, m);
  }

  // Collect ALL due profiles across all active runs, oldest-due first
  const runIds = stillActive.map(r => r.run_id);
  const placeholders = runIds.map(() => "?").join(",");
  const dueProfiles = db.prepare(
    `SELECT rp.*, r.account_id, r.workflow_id
     FROM run_profiles rp
     JOIN runs r ON r.id = rp.run_id
     WHERE rp.run_id IN (${placeholders})
       AND rp.state = 'in_progress'
       AND (rp.next_step_at IS NULL OR datetime(rp.next_step_at) <= datetime('now'))
     ORDER BY rp.next_step_at ASC`
  ).all(...runIds) as Array<RunProfile & { account_id: string; workflow_id: string }>;

  // Also enroll new pending profiles (up to today's remaining slots per account)
  for (const run of stillActive) {
    const limits = accountLimitsMap.get(run.account_id)!;
    const connectsLeft = Math.max(0, (limits.daily_connection_limit ?? 20) - (connectsSentToday.get(run.account_id) ?? 0));
    // Count already-scheduled in_progress for this account today
    const scheduledToday = (db.prepare(
      `SELECT COUNT(*) as c FROM run_profiles rp
       JOIN runs r ON r.id = rp.run_id
       WHERE r.account_id = ? AND rp.state = 'in_progress'
       AND date(datetime(rp.next_step_at)) = date('now')`
    ).get(run.account_id) as { c: number }).c;
    const slotsLeft = Math.max(0, connectsLeft - scheduledToday);
    if (slotsLeft <= 0) continue;

    const pending = db.prepare(
      "SELECT * FROM run_profiles WHERE run_id = ? AND state = 'pending' ORDER BY id LIMIT ?"
    ).all(run.run_id, Math.min(slotsLeft, 5)) as RunProfile[];

    for (const rp of pending) {
      const claimed = db.prepare("UPDATE run_profiles SET state = 'in_progress' WHERE id = ? AND state = 'pending'").run(rp.id);
      if (claimed.changes === 0) continue;
      const slot = (() => {
        const limits = accountLimitsMap.get(run.account_id)!;
        const { hour, minute } = getLocalParts(limits.timezone || "UTC");
        const end = limits.active_hours_end ?? 18;
        const nowFrac = hour + minute / 60;
        if (nowFrac >= end - 0.25) return rescheduleToTomorrow(limits);
        const endMs = new Date().setHours(end, 0, 0, 0);
        return new Date(Date.now() + Math.random() * (endMs - Date.now())).toISOString();
      })();
      db.prepare("UPDATE run_profiles SET next_step_at = ? WHERE id = ?").run(slot, rp.id);
      const tgt = db.prepare("SELECT full_name, linkedin_url FROM targets WHERE id = ?").get(rp.target_id) as { full_name: string | null; linkedin_url: string } | undefined;
      log(db, run.run_id, rp.target_id, "info", `Scheduled ${tgt?.full_name ?? tgt?.linkedin_url ?? rp.target_id} within active window`);
    }
  }

  if (dueProfiles.length === 0) return;

  // Separate by step type to apply limits correctly
  // Load steps for each workflow (cached by workflow_id)
  const stepsCache = new Map<string, WorkflowStep[]>();
  const getSteps = (workflowId: string): WorkflowStep[] => {
    if (!stepsCache.has(workflowId)) {
      stepsCache.set(workflowId, db.prepare("SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order").all(workflowId) as WorkflowStep[]);
    }
    return stepsCache.get(workflowId)!;
  };

  // For connect/message steps, apply daily limits and reschedule overflow
  // visits and delays have no daily limits — always execute
  const toExecute: Array<RunProfile & { account_id: string; workflow_id: string }> = [];
  const toReschedule: Array<RunProfile & { account_id: string }> = [];

  // Track how many connects/messages we're planning to execute this tick (per account)
  const connectsPlanned = new Map<string, number>(Array.from(accountLimitsMap.keys()).map(id => [id, 0]));
  const messagesPlanned = new Map<string, number>(Array.from(accountLimitsMap.keys()).map(id => [id, 0]));

  for (const rp of dueProfiles) {
    const steps = getSteps(rp.workflow_id);
    const stepIndex = rp.current_step;
    if (stepIndex >= steps.length) { toExecute.push(rp); continue; } // will be marked completed
    const step = steps[stepIndex];
    const limits = accountLimitsMap.get(rp.account_id)!;

    if (step.step_type === "connect") {
      const sentToday = connectsSentToday.get(rp.account_id) ?? 0;
      const planned = connectsPlanned.get(rp.account_id) ?? 0;
      if (sentToday + planned >= (limits.daily_connection_limit ?? 20)) {
        toReschedule.push(rp);
      } else {
        connectsPlanned.set(rp.account_id, planned + 1);
        toExecute.push(rp);
      }
    } else if (step.step_type === "message") {
      const sentToday = messagesSentToday.get(rp.account_id) ?? 0;
      const planned = messagesPlanned.get(rp.account_id) ?? 0;
      if (sentToday + planned >= (limits.daily_message_limit ?? 50)) {
        toReschedule.push(rp);
      } else {
        messagesPlanned.set(rp.account_id, planned + 1);
        toExecute.push(rp);
      }
    } else {
      // visit, delay — no limit
      toExecute.push(rp);
    }
  }

  // Reschedule overflow to tomorrow
  for (const rp of toReschedule) {
    const limits = accountLimitsMap.get(rp.account_id)!;
    const slot = rescheduleToTomorrow(limits);
    db.prepare("UPDATE run_profiles SET next_step_at = ? WHERE id = ?").run(slot, rp.id);
    // find run_id for logging
    log(db, rp.run_id, rp.target_id, "info", `Daily limit reached — rescheduled to ${slot}`);
  }

  // Execute what's left
  for (const rp of toExecute) {
    const steps = getSteps(rp.workflow_id);
    const limits = accountLimitsMap.get(rp.account_id)!;

    // Re-check run is still running before each profile
    const runStatus = db.prepare("SELECT status FROM runs WHERE id = ?").get(rp.run_id) as { status: string } | undefined;
    if (!runStatus || runStatus.status !== "running") continue;

    await executeStep(db, rp.run_id, rp, db.prepare("SELECT * FROM targets WHERE id = ?").get(rp.target_id) as Target, steps, rp.account_id, limits);
    await randomDelay(PROFILE_DELAY_MIN, PROFILE_DELAY_MAX);
  }
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Called when a run is started or resumed via the UI.
 * Just marks the run as running — the global loop picks it up on the next tick.
 */
export function startRun(runId: string): void {
  const db = getDb();
  db.prepare("UPDATE runs SET status = 'running', started_at = COALESCE(started_at, datetime('now')) WHERE id = ?").run(runId);
  console.log(`[runner] Run ${runId} marked running — global loop will pick it up`);
}
