import type { Page } from "playwright";
import { getDb } from "@/lib/db";
import { getSessionPage, saveSessionState, markNeedsReauth } from "@/lib/linkedin/session";

/**
 * Accepted-connection sync via the authoritative Voyager connections API.
 *
 * Replaces the old absence-inference (scroll the SENT list, treat a vanished
 * invite as "accepted"). That was measurably wrong: of 1,600 contacts it had
 * marked degree=1, only 325 were genuinely connected — 1,275 were phantoms
 * (invites that expired/withdrew/were ignored, not accepted). See docs §19.
 *
 * Sources — all proved against prod (Jul 2026), NO scrolling:
 *  - DATA: GET /voyager/api/relationships/dash/connections
 *          ?decorationId=…ConnectionListWithProfile-16&q=search
 *          &sortType=RECENTLY_ADDED&start=N&count=100
 *      → data["*elements"] (newest-first) + included[]: Connection { createdAt(ms),
 *        connectedMember } and Profile { publicIdentifier (vanity), entityUrn }.
 *      The API paginates to the end (30 pages for ~2947) in ~60s. It does NOT
 *      expose a grand total.
 *  - TOTAL (checksum): the connections PAGE header "<N> connections" <p>. Read
 *    once per full pass via a single navigation (NO scroll). A full pass is
 *    "verified complete" only when unique-pulled == declared total (matched ±0
 *    in prod). Presence in the list = 100% proof of a 1st-degree connection.
 *
 * Behaviour:
 *  - First run (boundary NULL) → FULL pass: page to the end, stamp degree=1 +
 *    connected_at from createdAt for every matched contact. If the pass is
 *    checksum-verified complete, ALSO un-mark phantom degree=1 contacts whose
 *    vanity is absent from the authoritative list (resets degree/connected_at).
 *  - Later runs → incremental: page from start=0 and STOP at the first
 *    connection older than the stored boundary (minus a 24h overlap margin).
 *    Incremental/incomplete passes are ADD-ONLY — they never un-mark (a partial
 *    pull must not wipe real accepts). Un-marking happens ONLY on a verified
 *    full pass.
 *  - Reuses the runner's shared browser (getSessionPage) — never a 2nd browser.
 */

const ACCEPTED_SYNC_INTERVAL_MS = 8 * 60 * 60 * 1000; // 8h — 3x per day
const PAGE_SIZE = 100;
const MAX_PAGES = 60; // safety cap (60 * 100 = 6000)
const OVERLAP_MARGIN_MS = 24 * 60 * 60 * 1000; // re-check a day of overlap (idempotent)
const DECORATION = "com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-16";

export function shouldSyncAccepted(accountId: string): boolean {
  const db = getDb();
  const row = db.prepare("SELECT accepted_sync_at FROM accounts WHERE id = ?").get(accountId) as
    | { accepted_sync_at: string | null }
    | undefined;
  if (!row?.accepted_sync_at) return true;
  return Date.now() - new Date(row.accepted_sync_at).getTime() >= ACCEPTED_SYNC_INTERVAL_MS;
}

interface ApiConnection {
  vanity: string | null;
  createdAt: number; // epoch ms
}

export async function syncAcceptedConnections(accountId: string): Promise<number> {
  const db = getDb();
  const page = await getSessionPage(accountId);
  let stamped = 0;

  try {
    const boundaryRow = db.prepare("SELECT connections_synced_through_ms FROM accounts WHERE id = ?").get(accountId) as
      | { connections_synced_through_ms: number | null }
      | undefined;
    const boundary = boundaryRow?.connections_synced_through_ms ?? null;
    const isFullPass = boundary === null;
    const stopBefore = boundary === null ? null : boundary - OVERLAP_MARGIN_MS;

    // Read the declared total from the connections PAGE header (single nav, NO
    // scroll). This is also our login-wall check and the completeness checksum.
    await page.goto("https://www.linkedin.com/mynetwork/invite-connect/connections/", {
      waitUntil: "domcontentloaded",
      timeout: 35000,
    });
    await page.waitForTimeout(3500 + Math.random() * 1500);
    if (/\/login|\/authwall|\/checkpoint|\/uas\//.test(page.url())) {
      console.warn(`[sync-accepted] Session looks logged out (${page.url()}) — skipping`);
      return 0;
    }
    const declaredTotal = await page.evaluate(() => {
      const m = document.body.innerText.match(/([\d.,]+)\s+connections?/i);
      return m ? parseInt(m[1].replace(/[.,]/g, ""), 10) : null;
    });

    const findByVanity = db.prepare(
      `SELECT id, full_name, connected_at, degree FROM targets
       WHERE linkedin_url LIKE ? AND connection_requested_at IS NOT NULL`
    );
    const stampAccepted = db.prepare(
      "UPDATE targets SET degree = 1, connected_at = COALESCE(connected_at, ?) WHERE id = ?"
    );

    const seenVanities = new Set<string>(); // full-pass phantom check
    let uniquePulled = 0;
    let newestSeen: number | null = null;
    let reachedBoundary = false;

    for (let pageIdx = 0; pageIdx < MAX_PAGES; pageIdx++) {
      const conns = await fetchConnectionsPage(page, pageIdx * PAGE_SIZE, PAGE_SIZE);
      if (conns === null) {
        console.warn(`[sync-accepted] connections API failed at start=${pageIdx * PAGE_SIZE} — stopping`);
        break;
      }
      if (conns.length === 0) break; // end of list

      for (const c of conns) {
        uniquePulled++;
        if (c.vanity) seenVanities.add(c.vanity);
        if (newestSeen === null || c.createdAt > newestSeen) newestSeen = c.createdAt;

        // Incremental early-exit (list is newest-first).
        if (stopBefore !== null && c.createdAt < stopBefore) {
          reachedBoundary = true;
          break;
        }
        if (!c.vanity) continue;

        for (const m of findByVanity.all(`%/in/${c.vanity}/%`) as Array<{
          id: string; full_name: string | null; connected_at: string | null; degree: number | null;
        }>) {
          if (m.degree === 1 && m.connected_at) continue; // already correct
          stampAccepted.run(msToSqlite(c.createdAt), m.id);
          console.log(`[sync-accepted] Accepted: ${m.full_name ?? c.vanity}`);
          stamped++;
        }
      }

      if (reachedBoundary) break;
      await page.waitForTimeout(900 + Math.random() * 700); // gentle, API-only
    }

    // Completeness checksum: a full pass is trustworthy only if what we pulled
    // matches LinkedIn's own declared total (±5 slack for live churn).
    const verifiedComplete =
      isFullPass && declaredTotal !== null && Math.abs(uniquePulled - declaredTotal) <= 5;

    // Correction: ONLY on a verified-complete full pass, un-mark phantom
    // degree=1 contacts (present nowhere in the authoritative list). Never on an
    // incremental/incomplete pass — a partial pull must not wipe real accepts.
    let unmarked = 0;
    if (verifiedComplete) {
      const deg1 = db.prepare(
        "SELECT id, full_name, linkedin_url FROM targets WHERE degree = 1 AND linkedin_url LIKE '%/in/%'"
      ).all() as Array<{ id: string; full_name: string | null; linkedin_url: string }>;
      const unmark = db.prepare("UPDATE targets SET degree = NULL, connected_at = NULL WHERE id = ?");
      const tx = db.transaction((rows: typeof deg1) => {
        for (const t of rows) {
          const mm = t.linkedin_url.match(/\/in\/([^/?#]+)/);
          const v = mm ? decodeURIComponent(mm[1]).toLowerCase() : null;
          if (!v || !seenVanities.has(v)) {
            unmark.run(t.id);
            unmarked++;
          }
        }
      });
      tx(deg1);
      console.log(`[sync-accepted] Verified full pass (pulled ${uniquePulled} == declared ${declaredTotal}). Un-marked ${unmarked} phantom degree=1.`);
    } else if (isFullPass) {
      console.warn(`[sync-accepted] Full pass NOT verified complete (pulled ${uniquePulled}, declared ${declaredTotal}) — add-only, no un-marking.`);
    }

    // Advance the boundary to the newest connection seen this run.
    if (newestSeen !== null) {
      db.prepare("UPDATE accounts SET connections_synced_through_ms = ? WHERE id = ?").run(newestSeen, accountId);
    }
    // Store the declared total for visibility (Settings shows LinkedIn's count).
    if (declaredTotal !== null) {
      db.prepare("UPDATE accounts SET li_connections = ? WHERE id = ?").run(declaredTotal, accountId);
    }
    console.log(`[sync-accepted] Stamped ${stamped} accepted, un-marked ${unmarked} phantom (boundary=${newestSeen}).`);
  } finally {
    // B5 safety: only persist the session if still on a valid page.
    let url = "";
    try { url = page.url(); } catch { /* gone */ }
    try { await page.close(); } catch { /* ignore */ }
    if (/\/login|\/authwall|\/checkpoint|\/uas\//.test(url)) {
      console.warn(`[sync-accepted] Ended on a wall (${url}) — not persisting; flagging re-auth`);
      try { await markNeedsReauth(accountId); } catch { /* ignore */ }
    } else {
      try { await saveSessionState(accountId); } catch { /* ignore */ }
    }
    db.prepare("UPDATE accounts SET accepted_sync_at = datetime('now') WHERE id = ?").run(accountId);
  }

  return stamped;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function msToSqlite(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

async function fetchConnectionsPage(page: Page, start: number, count: number): Promise<ApiConnection[] | null> {
  return page.evaluate(
    async ({ start, count, decoration }): Promise<ApiConnection[] | null> => {
      const cookies = document.cookie.split("; ").reduce((a: Record<string, string>, c) => {
        const i = c.indexOf("=");
        if (i > 0) a[c.slice(0, i)] = c.slice(i + 1);
        return a;
      }, {});
      const csrf = (cookies["JSESSIONID"] || "").replace(/"/g, "");
      const url =
        `https://www.linkedin.com/voyager/api/relationships/dash/connections` +
        `?decorationId=${decoration}&count=${count}&q=search&sortType=RECENTLY_ADDED&start=${start}`;
      let json: {
        included?: Array<{
          $type?: string;
          entityUrn?: string;
          createdAt?: number;
          connectedMember?: string;
          publicIdentifier?: string;
        }>;
      };
      try {
        const r = await fetch(url, {
          headers: {
            "csrf-token": csrf,
            "accept": "application/vnd.linkedin.normalized+json+2.1",
            "x-restli-protocol-version": "2.0.0",
            "x-li-lang": "en_US",
          },
          credentials: "include",
        });
        if (!r.ok) return null;
        json = await r.json();
      } catch {
        return null;
      }

      const included = json.included || [];
      const vanityByUrn: Record<string, string> = {};
      for (const x of included) {
        if ((x.$type || "").includes("identity.profile.Profile") && x.entityUrn && x.publicIdentifier) {
          vanityByUrn[x.entityUrn] = x.publicIdentifier;
        }
      }
      const out: ApiConnection[] = [];
      for (const x of included) {
        if ((x.$type || "").includes("relationships.Connection") && typeof x.createdAt === "number") {
          const memberUrn = x.connectedMember || null;
          out.push({
            createdAt: x.createdAt,
            vanity: memberUrn ? vanityByUrn[memberUrn] ?? null : null,
          });
        }
      }
      out.sort((a, b) => b.createdAt - a.createdAt);
      return out;
    },
    { start, count, decoration: DECORATION }
  );
}
