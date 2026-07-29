/**
 * Profile enrichment via Sales Navigator profile page intercept.
 *
 * Strategy: navigate to the lead's sales_nav_url. Sales Nav automatically
 * fires a salesApiProfiles call that returns the full profile — headline,
 * all positions with descriptions, degree, flagshipProfileUrl, summary.
 * We intercept that response instead of making extra API calls.
 *
 * Weight: ~5-8s per profile (one real browser page load). Run fire-and-forget
 * after import — do not await in API routes.
 */
import type { BrowserContext } from "playwright";
import { getDb } from "@/lib/db";

interface EnrichedPosition {
  title: string;
  companyName: string;
  current: boolean;
  startedOn?: { year?: number; month?: number };
  endedOn?: { year?: number; month?: number };
  description?: string;
}

interface SalesNavProfileData {
  entityUrn?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  headline?: string;
  summary?: string;
  location?: string;
  degree?: number;
  flagshipProfileUrl?: string;
  objectUrn?: string;
  positions?: EnrichedPosition[];
  skills?: Array<{ name?: string }>;
}

interface InterceptedResponse {
  data?: SalesNavProfileData;
  [key: string]: unknown;
}

export async function enrichProfile(
  ctx: BrowserContext,
  target: { id: string; sales_nav_url: string; full_name: string }
): Promise<boolean> {
  const db = getDb();
  const page = await ctx.newPage();

  try {
    // Box it so the async response listener can mutate it (TS can't narrow across async callbacks)
    const box: { data: SalesNavProfileData | null } = { data: null };

    // Intercept the salesApiProfiles call that Sales Nav fires automatically on profile load.
    // Two calls fire per page load:
    //   1st — flat object with entityUrn, headline, positions, flagshipProfileUrl (what we want)
    //   2nd — flat object with educations, skills, numOfConnections (supplementary)
    // Both are flat — no .data wrapper. Accept the first one that has entityUrn.
    page.on("response", async (resp) => {
      if (box.data) return;
      if (!resp.url().includes("salesApiProfiles")) return;
      if (resp.status() !== 200) return;
      try {
        const json = await resp.json() as Record<string, unknown>;
        if ("entityUrn" in json && "firstName" in json) {
          box.data = json as unknown as SalesNavProfileData;
        }
      } catch { /* ignore */ }
    });

    await page.goto(target.sales_nav_url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(8000);

    const intercepted = box.data;
    if (!intercepted) {
      console.log(`[enrich] No profile data intercepted for ${target.full_name} — skipping`);
      return false;
    }

    // Extract positions — include all, not just current
    const positions: EnrichedPosition[] = (intercepted.positions ?? []).map((p) => ({
      title: p.title ?? "",
      companyName: p.companyName ?? "",
      current: p.current ?? false,
      startedOn: p.startedOn,
      endedOn: p.endedOn,
      description: p.description ?? undefined,
    }));

    // Skills come from a separate decoration call — if not in intercept, skip for now
    // (the page-load intercept does not include skills; they'd need a second fetch)
    const skills: string[] = (intercepted.skills ?? [])
      .map((s) => s.name)
      .filter((n): n is string => !!n);

    db.prepare(`
      UPDATE targets SET
        headline            = COALESCE(?, headline),
        summary             = COALESCE(?, summary),
        positions_json      = ?,
        skills_json         = CASE WHEN ? IS NOT NULL THEN ? ELSE skills_json END,
        enriched_profile_at = datetime('now')
      WHERE id = ?
    `).run(
      intercepted.headline ?? null,
      intercepted.summary ?? null,
      positions.length > 0 ? JSON.stringify(positions) : null,
      skills.length > 0 ? "1" : null,
      skills.length > 0 ? JSON.stringify(skills) : null,
      target.id
    );

    console.log(`[enrich] ${target.full_name} — ${positions.length} positions, ${skills.length} skills, headline: ${!!intercepted.headline}`);
    return true;
  } catch (err) {
    console.error(`[enrich] Error enriching ${target.full_name}:`, err instanceof Error ? err.message : err);
    return false;
  } finally {
    await page.close();
  }
}

export async function enrichList(
  ctx: BrowserContext,
  listId: string,
  delayMs = 2000,
  onProgress?: (count: number, total: number) => void
): Promise<{ enriched: number; failed: number }> {
  const db = getDb();

  // Only targets with a sales_nav_url that haven't been enriched yet
  const targets = db.prepare(`
    SELECT t.id, t.sales_nav_url, t.full_name
    FROM targets t
    JOIN list_targets lt ON lt.target_id = t.id
    WHERE lt.list_id = ?
      AND t.sales_nav_url IS NOT NULL
      AND t.enriched_profile_at IS NULL
    ORDER BY t.created_at ASC
  `).all(listId) as Array<{ id: string; sales_nav_url: string; full_name: string }>;

  const total = targets.length;
  console.log(`[enrich] Starting enrichment for ${total} profiles in list ${listId}`);

  let enriched = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    console.log(`[enrich] ${i + 1}/${total} — ${target.full_name}`);
    const ok = await enrichProfile(ctx, target);
    if (ok) enriched++; else failed++;
    console.log(`[enrich] ${i + 1}/${total} done (${enriched} ok, ${failed} failed)`);
    onProgress?.(i + 1, total);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  console.log(`[enrich] Done — ${enriched} enriched, ${failed} failed`);
  return { enriched, failed };
}
