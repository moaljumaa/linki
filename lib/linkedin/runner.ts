import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";
import { getSessionPage, saveSessionState, getSessionContext } from "@/lib/linkedin/session";
import { visitProfile } from "@/lib/linkedin/visit";
import { sendConnectionRequest, WeeklyLimitError, AlreadyConnectedError, PendingInviteError } from "@/lib/linkedin/connect";
import { sendMessage } from "@/lib/linkedin/message";
import { shouldSyncInbox, syncAccountInbox } from "@/lib/linkedin/inbox";

// How long to wait before re-checking if a connection request was accepted (24h)
const CONNECTION_RECHECK_HOURS = 24;
// Max days to wait for acceptance before giving up
const CONNECTION_MAX_WAIT_DAYS = 7;
// Delay between profiles (seconds)
const PROFILE_DELAY_MIN = 8;
const PROFILE_DELAY_MAX = 20;
// Poll interval when runner is idle (waiting for next_step_at)
const POLL_INTERVAL_MS = 30_000;

interface AccountLimits {
  daily_connection_limit: number;
  daily_message_limit: number;
  active_hours_start: number;
  active_hours_end: number;
  timezone: string;        // IANA tz name e.g. "America/New_York"
  working_days: string;    // CSV of ISO weekday numbers: "1,2,3,4,5" (Mon=1, Sun=7)
}

/**
 * Returns an ISO timestamp for a random moment within the account's active
 * window on a given target date (defaults to today if within window, else tomorrow).
 *
 * This is used to spread actions throughout the day instead of bursting them
 * all at once, which looks far more human to LinkedIn's detection systems.
 */
function randomSlotInActiveWindow(account: AccountLimits, targetDate?: Date): string {
  const start = account.active_hours_start ?? 9;
  const end = account.active_hours_end ?? 18;
  const base = targetDate ? new Date(targetDate) : new Date();

  // Always work in local time — pick a random minute within [start, end)
  const startMs = new Date(
    base.getFullYear(), base.getMonth(), base.getDate(), start, 0, 0
  ).getTime();
  const endMs = new Date(
    base.getFullYear(), base.getMonth(), base.getDate(), end, 0, 0
  ).getTime();

  const randomMs = startMs + Math.random() * (endMs - startMs);
  return new Date(randomMs).toISOString();
}

/**
 * Schedule an action for tomorrow in a random slot within the active window.
 * Used when a daily limit is reached.
 */
function rescheduleToTomorrow(account: AccountLimits): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return randomSlotInActiveWindow(account, tomorrow);
}

/**
 * Schedule an action for today in a random slot within the active window.
 * If we're already past the window end, schedules for tomorrow instead.
 * Used to stagger initial action scheduling across the day.
 */
function scheduleWithinToday(account: AccountLimits): string {
  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;
  const end = account.active_hours_end ?? 18;

  if (currentHour >= end - 0.25) {
    // Less than 15 min left in window — push to tomorrow
    return rescheduleToTomorrow(account);
  }

  // Pick a random slot from now until end of window
  const endMs = new Date(
    now.getFullYear(), now.getMonth(), now.getDate(), end, 0, 0
  ).getTime();
  const randomMs = now.getTime() + Math.random() * (endMs - now.getTime());
  return new Date(randomMs).toISOString();
}

/**
 * Returns the current hour + fractional minutes in the account's configured timezone.
 * Uses Intl.DateTimeFormat to extract local hour/minute/weekday without any library.
 */
function getLocalParts(tz: string, date = new Date()): { hour: number; minute: number; isoWeekday: number } {
  const safeZone = (() => { try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return tz; } catch { return "UTC"; } })();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone,
    hour: "numeric", minute: "numeric", weekday: "short", hour12: false,
  }).formatToParts(date);

  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  const hour = parseInt(get("hour"), 10) % 24; // "24" can appear for midnight in some runtimes
  const minute = parseInt(get("minute"), 10);
  const weekdayStr = get("weekday"); // "Mon", "Tue", ...
  const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const isoWeekday = weekdayMap[weekdayStr] ?? 1;
  return { hour, minute, isoWeekday };
}

/**
 * Returns true if right now (in the account's timezone) is within the configured
 * working days and active hours window.
 */
function isWithinSchedule(account: AccountLimits): boolean {
  const tz = account.timezone || "UTC";
  const allowedDays = (account.working_days || "1,2,3,4,5").split(",").map(Number);
  const { hour, minute, isoWeekday } = getLocalParts(tz);
  if (!allowedDays.includes(isoWeekday)) return false;
  const fractionalHour = hour + minute / 60;
  return fractionalHour >= (account.active_hours_start ?? 9) && fractionalHour < (account.active_hours_end ?? 18);
}

/**
 * Finds the next ISO timestamp that falls within the account's working schedule.
 * Walks forward day by day from now until it finds a valid working day,
 * then picks a random minute within that day's active window.
 * Caps search at 14 days to avoid infinite loop on misconfigured accounts.
 */
function nextScheduledSlot(account: AccountLimits): string {
  const tz = account.timezone || "UTC";
  const allowedDays = (account.working_days || "1,2,3,4,5").split(",").map(Number);
  const start = account.active_hours_start ?? 9;
  const end = account.active_hours_end ?? 18;

  const candidate = new Date();
  // If we're currently within today's window, schedule from now forward in today's window
  const { hour: nowHour, minute: nowMin, isoWeekday: nowDay } = getLocalParts(tz, candidate);
  const nowFrac = nowHour + nowMin / 60;

  if (allowedDays.includes(nowDay) && nowFrac < end - 0.25) {
    // Still time today
    const todayEndMs = (() => {
      const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(candidate);
      const y = p.find(x => x.type === "year")?.value;
      const m = p.find(x => x.type === "month")?.value;
      const d = p.find(x => x.type === "day")?.value;
      // Build end-of-window as a local midnight-anchored timestamp
      // We approximate by adding hours to now
      return candidate.getTime() + (end - nowFrac) * 3600_000;
    })();
    const randomMs = candidate.getTime() + Math.random() * (todayEndMs - candidate.getTime());
    return new Date(randomMs).toISOString();
  }

  // Advance to the next working day
  for (let i = 1; i <= 14; i++) {
    candidate.setDate(candidate.getDate() + 1);
    const { isoWeekday } = getLocalParts(tz, candidate);
    if (allowedDays.includes(isoWeekday)) {
      return randomSlotInActiveWindow(account, candidate);
    }
  }

  // Fallback: 24h from now
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
  target_id: string;
  state: string;
  current_step: number;
  next_step_at: string | null;
  error_message: string | null;
}

interface Target {
  id: string;
  linkedin_url: string;       // real /in/ URL after re-import; may still be Sales Nav URL for old records
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

interface Template {
  id: string;
  body: string;
}

/**
 * Resolves the real /in/ URL for a target that only has a Sales Nav URL.
 * Navigates to the Sales Nav profile page and intercepts the salesApiProfiles response
 * which contains flagshipProfileUrl. Updates the target in DB and returns the URL.
 */
async function resolveLinkedinUrl(db: ReturnType<typeof getDb>, target: Target, accountId: string): Promise<string> {
  if (target.linkedin_url?.includes("/in/")) return target.linkedin_url;

  const salesNavUrl = target.sales_nav_url ?? target.linkedin_url;
  if (!salesNavUrl) throw new Error(`${target.full_name ?? target.id} has no Sales Nav URL to resolve from`);

  const leadMatch = salesNavUrl.match(/\/sales\/lead\/(.+)/);
  if (!leadMatch) throw new Error(`${target.full_name ?? target.id} has no Sales Nav lead URL — cannot resolve LinkedIn URL`);
  const leadPath = leadMatch[1];

  const page = await getSessionPage(accountId);
  let profileJson: Record<string, unknown> | null = null;

  try {
    // Register listener BEFORE goto so we don't miss the response
    page.on("response", async (response) => {
      if (response.url().includes("salesApiProfiles/") && response.status() === 200 && !profileJson) {
        try {
          profileJson = await response.json() as Record<string, unknown>;
        } catch { /* ignore */ }
      }
    });

    await page.goto(`https://www.linkedin.com/sales/lead/${leadPath}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    // Wait up to 10s — datacenter IPs need more time for the auth dance + API response
    await page.waitForTimeout(10000);
  } finally {
    await page.close();
  }

  const p = profileJson as Record<string, unknown> | null;
  const flagshipUrl = typeof p?.flagshipProfileUrl === "string" ? p.flagshipProfileUrl : null;
  if (!flagshipUrl) throw new Error(`Could not resolve LinkedIn URL for ${target.full_name ?? target.id}`);

  // Normalize: ensure trailing slash
  const linkedinUrl = flagshipUrl.endsWith("/") ? flagshipUrl : flagshipUrl + "/";

  // Persist linkedin_url plus any extra enrichment data we got for free
  db.prepare(`
    UPDATE targets SET
      linkedin_url = ?,
      linkedin_member_urn = COALESCE(linkedin_member_urn, ?),
      headline = COALESCE(headline, ?),
      summary = COALESCE(summary, ?)
    WHERE id = ?
  `).run(
    linkedinUrl,
    typeof p?.objectUrn === "string" ? p.objectUrn : null,
    typeof p?.headline === "string" ? p.headline : null,
    typeof p?.summary === "string" ? p.summary : null,
    target.id
  );

  return linkedinUrl;
}

/** Returns the real /in/ profile URL. Resolves it lazily if only a Sales Nav URL is available. */
async function getLinkedinUrl(db: ReturnType<typeof getDb>, target: Target, accountId: string): Promise<string> {
  if (target.linkedin_url?.includes("/in/")) return target.linkedin_url;
  return resolveLinkedinUrl(db, target, accountId);
}

function log(db: ReturnType<typeof getDb>, runId: string, targetId: string | null, level: "info" | "warn" | "error", message: string) {
  db.prepare(
    "INSERT INTO logs (id, run_id, target_id, level, message) VALUES (?, ?, ?, ?, ?)"
  ).run(randomUUID(), runId, targetId, level, message);
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomDelay(minSec: number, maxSec: number) {
  return sleep((minSec + Math.random() * (maxSec - minSec)) * 1000);
}

function nowIso() {
  return new Date().toISOString();
}

function addHours(h: number): string {
  return new Date(Date.now() + h * 3600_000).toISOString();
}

function hoursSince(isoStr: string): number {
  return (Date.now() - new Date(isoStr).getTime()) / 3600_000;
}

// Survives Turbopack/HMR module re-initialization within the same Node process
const g = global as typeof global & { __linkiActiveRuns?: Set<string> };
if (!g.__linkiActiveRuns) g.__linkiActiveRuns = new Set();
const activeRuns = g.__linkiActiveRuns;

export async function startRun(runId: string): Promise<void> {
  if (activeRuns.has(runId)) {
    console.log(`[runner] Run ${runId} already active — skipping`);
    return;
  }
  activeRuns.add(runId);
  const db = getDb();

  const run = db.prepare(
    `SELECT r.*, a.id as account_id, a.daily_connection_limit, a.daily_message_limit,
            a.active_hours_start, a.active_hours_end, a.timezone, a.working_days
     FROM runs r
     JOIN accounts a ON a.id = r.account_id
     WHERE r.id = ?`
  ).get(runId) as { account_id: string; workflow_id: string; list_id: string; status: string } & AccountLimits | undefined;

  if (!run) {
    console.error(`[runner] Run ${runId} not found`);
    activeRuns.delete(runId);
    return;
  }

  const steps = db.prepare(
    "SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order"
  ).all(run.workflow_id) as WorkflowStep[];

  if (steps.length === 0) {
    db.prepare("UPDATE runs SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(runId);
    log(db, runId, null, "warn", "Workflow has no steps — run completed immediately");
    activeRuns.delete(runId);
    return;
  }

  // Create run_profiles for all targets in the list (if not already created)
  const targets = db.prepare(
    `SELECT t.* FROM targets t
     JOIN list_targets lt ON lt.target_id = t.id
     WHERE lt.list_id = ?`
  ).all(run.list_id) as Target[];

  const insertProfile = db.prepare(
    "INSERT OR IGNORE INTO run_profiles (id, run_id, target_id, state, current_step) VALUES (?, ?, ?, 'pending', 0)"
  );
  db.transaction(() => {
    for (const t of targets) insertProfile.run(randomUUID(), runId, t.id);
  })();

  log(db, runId, null, "info", `Run started — ${targets.length} targets, ${steps.length} steps`);

  // Main loop
  try {
    while (true) {
      // Re-read run status each iteration
      const currentRun = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string } | undefined;
      if (!currentRun || currentRun.status !== "running") {
        log(db, runId, null, "info", `Run ${currentRun?.status ?? "deleted"} — stopping runner`);
        break;
      }

      console.log(`[runner] Poll iteration — run=${runId}`);

      // Sync inbox every 15 min to detect replies and auto-unenroll leads
      if (shouldSyncInbox(run.account_id)) {
        try {
          console.log(`[runner] Starting inbox sync for account ${run.account_id}`);
          const ctx = await getSessionContext(run.account_id);
          const replies = await syncAccountInbox(ctx, run.account_id);
          console.log(`[runner] Inbox sync complete — ${replies} replies`);
          if (replies > 0) log(db, runId, null, "info", `Inbox sync: ${replies} new repl${replies === 1 ? "y" : "ies"} detected`);
        } catch (e) {
          console.warn("[runner] Inbox sync error:", e instanceof Error ? e.message : e);
        }
      }

      // Check if all profiles are done
      const remaining = db.prepare(
        "SELECT COUNT(*) as c FROM run_profiles WHERE run_id = ? AND state NOT IN ('completed', 'failed', 'skipped')"
      ).get(runId) as { c: number };

      if (remaining.c === 0) {
        db.prepare("UPDATE runs SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(runId);
        log(db, runId, null, "info", "All profiles processed — run completed");
        break;
      }

      // Process in_progress profiles that are due
      const dueProfiles = db.prepare(
        `SELECT * FROM run_profiles
         WHERE run_id = ? AND state = 'in_progress'
         AND (next_step_at IS NULL OR datetime(next_step_at) <= datetime('now'))
         ORDER BY id LIMIT 10`
      ).all(runId) as RunProfile[];

      for (const rp of dueProfiles) {
        const target = db.prepare("SELECT * FROM targets WHERE id = ?").get(rp.target_id) as Target;
        if (!target) continue;

        // Check run still running before each profile
        const statusCheck = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string };
        if (statusCheck.status !== "running") return;

        await executeStep(db, runId, rp, target, steps, run.account_id, run);
        await randomDelay(PROFILE_DELAY_MIN, PROFILE_DELAY_MAX);
      }

      // Start new pending profiles — but only up to the daily connection limit.
      // We count how many profiles are already scheduled/active today to avoid
      // queuing more work than the account can legally do in one day.
      if (dueProfiles.length === 0) {
        const dailyLimit = run.daily_connection_limit ?? 20;

        // Profiles already claimed today (in_progress with next_step_at today, or processed today)
        const scheduledToday = (db.prepare(
          `SELECT COUNT(*) as c FROM run_profiles
           WHERE run_id = ? AND state = 'in_progress'
           AND date(datetime(next_step_at)) = date('now')`
        ).get(runId) as { c: number }).c;

        const slotsLeft = Math.max(0, dailyLimit - scheduledToday);
        if (slotsLeft === 0) {
          // Daily capacity exhausted — nothing to schedule, just poll
          await sleep(POLL_INTERVAL_MS);
          continue;
        }

        const pendingProfiles = db.prepare(
          "SELECT * FROM run_profiles WHERE run_id = ? AND state = 'pending' ORDER BY id LIMIT ?"
        ).all(runId, Math.min(slotsLeft, 5)) as RunProfile[];

        for (const rp of pendingProfiles) {
          const target = db.prepare("SELECT * FROM targets WHERE id = ?").get(rp.target_id) as Target;
          if (!target) continue;

          const statusCheck = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string };
          if (statusCheck.status !== "running") return;

          const claimed = db.prepare(
            "UPDATE run_profiles SET state = 'in_progress' WHERE id = ? AND state = 'pending'"
          ).run(rp.id);
          if (claimed.changes === 0) continue; // another runner claimed it
          // Stagger: assign a random slot in today's active window so pending profiles
          // don't all fire back-to-back the moment the runner picks them up.
          db.prepare("UPDATE run_profiles SET next_step_at = ? WHERE id = ?").run(
            scheduleWithinToday(run), rp.id
          );
          log(db, runId, target.id, "info", `Scheduled ${target.full_name ?? target.linkedin_url} within active window`);
        }
      }

      // If nothing was processed this iteration, wait before polling again
      if (dueProfiles.length === 0) {
        await sleep(POLL_INTERVAL_MS);
      }
    }
  } finally {
    activeRuns.delete(runId);
    db.prepare("UPDATE runs SET runner_pid = NULL WHERE id = ?").run(runId);
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
    // All steps done for this profile
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
      // Pure timing gate — just advance to the next step now that the wait is over
      advanceStep(db, rp, steps, stepIndex);
      log(db, runId, target.id, "info", `Delay step passed for ${name}`);
      return;
    }

    if (step.step_type === "visit") {
      db.prepare("UPDATE run_profiles SET last_step_at = datetime('now') WHERE id = ?").run(rp.id);
      log(db, runId, target.id, "info", `Visiting ${name}`);
      const linkedinUrl = await getLinkedinUrl(db, target, accountId);
      const page = await getSessionPage(accountId);
      try {
        await visitProfile(page, linkedinUrl);
      } finally {
        await page.close();
      }
      await saveSessionState(accountId);
      advanceStep(db, rp, steps, stepIndex);
      log(db, runId, target.id, "info", `Visited ${name}`);

    } else if (step.step_type === "connect") {
      // Check working schedule before acting
      if (!isWithinSchedule(accountLimits)) {
        const nextSlot = nextScheduledSlot(accountLimits);
        log(db, runId, target.id, "info", `Outside working schedule — rescheduling ${name} to ${nextSlot}`);
        db.prepare("UPDATE run_profiles SET next_step_at = ? WHERE id = ?").run(nextSlot, rp.id);
        return;
      }

      // Check daily connection limit before acting
      const sentToday = (db.prepare(
        `SELECT COUNT(*) as c FROM logs WHERE run_id IN (SELECT id FROM runs WHERE account_id = ?)
         AND message LIKE 'Connection request sent%' AND date(created_at) = date('now')`
      ).get(accountId) as { c: number }).c;
      if (sentToday >= (accountLimits.daily_connection_limit ?? 20)) {
        const nextSlot = rescheduleToTomorrow(accountLimits);
        log(db, runId, target.id, "info", `Daily connection limit reached (${sentToday}) — rescheduling ${name} to ${nextSlot}`);
        db.prepare("UPDATE run_profiles SET next_step_at = ? WHERE id = ?").run(nextSlot, rp.id);
        return;
      }

      // Skip if already connected
      const freshTarget = db.prepare("SELECT * FROM targets WHERE id = ?").get(target.id) as Target;
      if (freshTarget.degree === 1) {
        if (!freshTarget.connected_at) {
          db.prepare("UPDATE targets SET connected_at = ? WHERE id = ?").run(nowIso(), target.id);
        }
        log(db, runId, target.id, "info", `${name} already connected — skipping connect step`);
        advanceStep(db, rp, steps, stepIndex);
        return;
      }
      // Skip if request already sent and still waiting
      if (freshTarget.connection_requested_at) {
        const daysSince = hoursSince(freshTarget.connection_requested_at) / 24;
        if (daysSince > CONNECTION_MAX_WAIT_DAYS) {
          log(db, runId, target.id, "warn", `${name} did not accept after ${CONNECTION_MAX_WAIT_DAYS} days — skipping`);
          db.prepare("UPDATE run_profiles SET state = 'skipped' WHERE id = ?").run(rp.id);
          return;
        }
        // Still pending — reschedule check
        log(db, runId, target.id, "info", `${name} request still pending — will recheck in ${CONNECTION_RECHECK_HOURS}h`);
        db.prepare("UPDATE run_profiles SET next_step_at = ? WHERE id = ?").run(addHours(CONNECTION_RECHECK_HOURS), rp.id);
        return;
      }

      db.prepare("UPDATE run_profiles SET last_step_at = datetime('now') WHERE id = ?").run(rp.id);
      log(db, runId, target.id, "info", `Sending connection request to ${name}`);
      const linkedinUrl = await getLinkedinUrl(db, target, accountId);
      const page = await getSessionPage(accountId);
      try {
        await sendConnectionRequest(page, linkedinUrl);
      } finally {
        await page.close();
      }
      await saveSessionState(accountId);

      // Record that we sent the request
      db.prepare("UPDATE targets SET connection_requested_at = ? WHERE id = ?").run(nowIso(), target.id);
      // Reschedule to check for acceptance
      db.prepare("UPDATE run_profiles SET next_step_at = ? WHERE id = ?").run(addHours(CONNECTION_RECHECK_HOURS), rp.id);
      log(db, runId, target.id, "info", `Connection request sent to ${name} — will recheck in ${CONNECTION_RECHECK_HOURS}h`);

    } else if (step.step_type === "message") {
      // Check working schedule before acting
      if (!isWithinSchedule(accountLimits)) {
        const nextSlot = nextScheduledSlot(accountLimits);
        log(db, runId, target.id, "info", `Outside working schedule — rescheduling ${name} to ${nextSlot}`);
        db.prepare("UPDATE run_profiles SET next_step_at = ? WHERE id = ?").run(nextSlot, rp.id);
        return;
      }

      // Check daily message limit before acting
      const sentMsgsToday = (db.prepare(
        `SELECT COUNT(*) as c FROM logs WHERE run_id IN (SELECT id FROM runs WHERE account_id = ?)
         AND message LIKE 'Message sent%' AND date(created_at) = date('now')`
      ).get(accountId) as { c: number }).c;
      if (sentMsgsToday >= (accountLimits.daily_message_limit ?? 50)) {
        const nextSlot = rescheduleToTomorrow(accountLimits);
        log(db, runId, target.id, "info", `Daily message limit reached (${sentMsgsToday}) — rescheduling ${name} to ${nextSlot}`);
        db.prepare("UPDATE run_profiles SET next_step_at = ? WHERE id = ?").run(nextSlot, rp.id);
        return;
      }

      // Check connection before messaging
      const freshTarget = db.prepare("SELECT * FROM targets WHERE id = ?").get(target.id) as Target;
      if (freshTarget.degree !== 1) {
        // Not connected — reschedule to check later
        const requested = freshTarget.connection_requested_at;
        if (requested) {
          const daysSince = hoursSince(requested) / 24;
          if (daysSince > CONNECTION_MAX_WAIT_DAYS) {
            log(db, runId, target.id, "warn", `${name} never accepted — skipping message step`);
            db.prepare("UPDATE run_profiles SET state = 'skipped' WHERE id = ?").run(rp.id);
            return;
          }
        }
        log(db, runId, target.id, "info", `${name} not yet connected — rescheduling message in ${CONNECTION_RECHECK_HOURS}h`);
        db.prepare("UPDATE run_profiles SET next_step_at = ? WHERE id = ?").run(addHours(CONNECTION_RECHECK_HOURS), rp.id);
        return;
      }

      // Get message text — prefer template, fall back to inline message_body
      let messageText = "";
      if (step.template_id) {
        const tmpl = db.prepare("SELECT * FROM templates WHERE id = ?").get(step.template_id) as Template | undefined;
        if (tmpl) messageText = renderTemplate(tmpl.body, freshTarget);
      }
      if (!messageText && step.message_body) {
        messageText = renderTemplate(step.message_body, freshTarget);
      }
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
      log(db, runId, target.id, "info", `${name} invite already pending — advancing step`);
      if (!target.connection_requested_at) {
        db.prepare("UPDATE targets SET connection_requested_at = ? WHERE id = ?").run(nowIso(), target.id);
      }
      db.prepare("UPDATE run_profiles SET next_step_at = ? WHERE id = ?").run(addHours(CONNECTION_RECHECK_HOURS), rp.id);
      return;
    }

    log(db, runId, target.id, "error", `Error on ${name}: ${msg}`);
    db.prepare("UPDATE run_profiles SET state = 'failed', error_message = ? WHERE id = ?").run(msg, rp.id);
  }
}

function advanceStep(
  db: ReturnType<typeof getDb>,
  rp: RunProfile,
  steps: WorkflowStep[],
  currentIndex: number
) {
  const nextIndex = currentIndex + 1;
  if (nextIndex >= steps.length) {
    db.prepare(
      "UPDATE run_profiles SET state = 'completed', current_step = ?, last_step_at = datetime('now'), next_step_at = NULL WHERE id = ?"
    ).run(nextIndex, rp.id);
  } else {
    const nextStep = steps[nextIndex];
    const nextAt = nextStep.delay_seconds > 0
      ? new Date(Date.now() + nextStep.delay_seconds * 1000).toISOString()
      : null;
    db.prepare(
      "UPDATE run_profiles SET current_step = ?, last_step_at = datetime('now'), next_step_at = ? WHERE id = ?"
    ).run(nextIndex, nextAt, rp.id);
  }
}
