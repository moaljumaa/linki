/**
 * Live profile scrape → clean structured JSON for an LLM.
 *
 * Two confirmed sources (probed against prod, Jun 2026 — see docs §18):
 *   1. Sales Nav `salesApiProfiles` intercept (navigate the lead's sales_nav_url):
 *      two flat responses give headline, summary, positions, educations, skills,
 *      languages, connections, contactInfo, inmailRestriction, memberBadges, degree.
 *   2. Voyager `feed/updates?q=memberShareFeed` on the /in/ publicId:
 *      the 10 most recent authored posts (text + media type + engagement counts)
 *      plus the comments left on those posts. (q=memberComments → 400, not used.)
 *
 * Read-only. ~10-12s per profile (one Sales Nav page load + one Voyager fetch).
 */
import type { BrowserContext } from "playwright";

export interface ProfilePost {
  activityUrn: string;
  text: string;
  postedAt: string | null;       // ISO, when derivable from the activity id
  mediaType: "video" | "image" | "article" | "text";
  reactions: number;
  comments: number;
  shares: number;
}

export interface ProfileScrape {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  headline: string | null;
  summary: string | null;
  location: string | null;
  degree: number | null;          // network distance (1/2/3)
  linkedin_url: string | null;    // real /in/ URL
  num_connections: number | null;
  num_shared_connections: number | null;
  is_premium: boolean;
  is_open_profile: boolean;       // openLink — can be messaged free (note: API often under-reports)
  can_inmail: boolean;            // inmailRestriction === NO_RESTRICTION
  pending_invitation: boolean;
  websites: string[];
  positions: Array<{
    title: string;
    company: string;
    current: boolean;
    started: { year?: number; month?: number } | null;
    ended: { year?: number; month?: number } | null;
    description: string | null;
  }>;
  educations: Array<{ school: string | null; degree: string | null; field: string | null }>;
  skills: string[];
  languages: string[];
  recent_posts: ProfilePost[];    // up to 10, most recent first
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function textOf(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "text" in v && typeof (v as { text: unknown }).text === "string") {
    return (v as { text: string }).text;
  }
  return null;
}

// LinkedIn activity/ugcPost ids encode the creation epoch-ms in the high 41 bits
// (the low 22 bits are a sequence). Shift right 22 = divide by 2^22, via float
// math to avoid BigInt (tsconfig targets < ES2020).
const SHIFT_22 = 4194304; // 2^22
function timeFromActivityUrn(urn: string): string | null {
  const m = urn.match(/(\d{18,})/);
  if (!m) return null;
  const ms = Math.floor(Number(m[1]) / SHIFT_22);
  return ms > 1_000_000_000_000 ? new Date(ms).toISOString() : null;
}

interface SalesPosition {
  title?: string; companyName?: string; current?: boolean;
  startedOn?: { year?: number; month?: number };
  endedOn?: { year?: number; month?: number };
  description?: string;
}
interface SalesProfileFlat {
  entityUrn?: string; firstName?: string; lastName?: string; fullName?: string;
  headline?: string; summary?: string; location?: string; degree?: number;
  flagshipProfileUrl?: string; pendingInvitation?: boolean;
  positions?: SalesPosition[];
  contactInfo?: { websites?: Array<{ url?: string }> };
  educations?: Array<{ schoolName?: string; degreeName?: string; fieldOfStudy?: string }>;
  skills?: Array<{ name?: string }>;
  languages?: Array<{ name?: string }>;
  numOfConnections?: number; numOfSharedConnections?: number;
  inmailRestriction?: string;
  memberBadges?: { premium?: boolean; openLink?: boolean };
}

// ─── Sales Nav career ─────────────────────────────────────────────────────────

async function scrapeSalesCareer(
  ctx: BrowserContext,
  salesNavUrl: string
): Promise<Partial<ProfileScrape>> {
  const page = await ctx.newPage();
  const responses: SalesProfileFlat[] = [];
  page.on("response", async (resp) => {
    if (!resp.url().includes("salesApiProfiles") || resp.status() !== 200) return;
    try {
      const j = (await resp.json()) as Record<string, unknown>;
      // Only the two flat profile responses (have entityUrn); ignore the data/included one.
      if ("entityUrn" in j && ("firstName" in j || "educations" in j || "skills" in j)) {
        responses.push(j as unknown as SalesProfileFlat);
      }
    } catch { /* ignore */ }
  });

  try {
    await page.goto(salesNavUrl, { waitUntil: "domcontentloaded", timeout: 35000 });
    await page.waitForTimeout(9000);
  } finally {
    await page.close();
  }

  // Merge the (typically two) flat responses — first carries the core profile,
  // second carries educations/skills/languages/connections/inmailRestriction.
  const core = responses.find((r) => r.firstName || r.positions) ?? {};
  const extra = responses.find((r) => r.educations || r.skills || r.numOfConnections != null) ?? {};

  const positions = (core.positions ?? []).map((p) => ({
    title: p.title ?? "",
    company: p.companyName ?? "",
    current: p.current ?? false,
    started: p.startedOn ?? null,
    ended: p.endedOn ?? null,
    description: p.description?.trim() ? p.description : null,
  }));

  return {
    full_name: core.fullName ?? null,
    first_name: core.firstName ?? null,
    last_name: core.lastName ?? null,
    headline: core.headline ?? null,
    summary: core.summary ?? null,
    location: core.location ?? null,
    degree: core.degree ?? null,
    linkedin_url: core.flagshipProfileUrl ?? null,
    pending_invitation: core.pendingInvitation ?? false,
    websites: (core.contactInfo?.websites ?? []).map((w) => w.url).filter((u): u is string => !!u),
    positions,
    num_connections: extra.numOfConnections ?? null,
    num_shared_connections: extra.numOfSharedConnections ?? null,
    is_premium: extra.memberBadges?.premium ?? false,
    is_open_profile: extra.memberBadges?.openLink ?? false,
    can_inmail: (extra.inmailRestriction ?? core.inmailRestriction) === "NO_RESTRICTION",
    educations: (extra.educations ?? []).map((e) => ({
      school: e.schoolName ?? null, degree: e.degreeName ?? null, field: e.fieldOfStudy ?? null,
    })),
    skills: (extra.skills ?? []).map((s) => s.name).filter((n): n is string => !!n),
    languages: (extra.languages ?? []).map((l) => l.name).filter((n): n is string => !!n),
  };
}

// ─── Voyager posts ────────────────────────────────────────────────────────────

function publicIdFromUrl(url: string | null | undefined): string | null {
  const m = url && url.match(/\/in\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function scrapePosts(
  ctx: BrowserContext,
  publicId: string
): Promise<ProfilePost[]> {
  const page = await ctx.newPage();
  try {
    await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 25000 });
    const cookies = await ctx.cookies();
    const csrf = (cookies.find((c) => c.name === "JSESSIONID")?.value || "").replace(/"/g, "");
    if (!csrf) return [];

    const url =
      `https://www.linkedin.com/voyager/api/feed/updates` +
      `?profileId=${encodeURIComponent(publicId)}&q=memberShareFeed&count=10&start=0`;
    const raw = await page.evaluate(
      async ({ url, csrf }: { url: string; csrf: string }) => {
        const r = await fetch(url, {
          headers: {
            accept: "application/vnd.linkedin.normalized+json+2.1",
            "csrf-token": csrf,
            "x-restli-protocol-version": "2.0.0",
          },
          credentials: "include",
        });
        return r.status === 200 ? r.text() : "";
      },
      { url, csrf }
    );
    if (!raw) return [];

    const j = JSON.parse(raw) as { included?: Array<Record<string, unknown>> };
    const inc = j.included ?? [];

    // Engagement counts keyed by the post's ugcPost/share urn.
    const countsByUrn = new Map<string, { reactions: number; comments: number; shares: number }>();
    for (const x of inc) {
      if (!String(x["$type"]).endsWith("SocialActivityCounts")) continue;
      const urn = String(x.urn ?? "");
      if (!urn.includes("ugcPost") && !urn.includes("activity")) continue;
      countsByUrn.set(urn, {
        reactions: Number(x.numLikes ?? 0),
        comments: Number(x.numComments ?? 0),
        shares: Number(x.numShares ?? 0),
      });
    }

    const posts: ProfilePost[] = [];
    for (const x of inc) {
      if (!String(x["$type"]).endsWith("UpdateV2")) continue;
      const commentary = x.commentary as { text?: unknown } | undefined;
      const text = commentary ? textOf(commentary.text) : null;
      if (!text) continue;
      const meta = x.updateMetadata as { urn?: string } | undefined;
      const activityUrn = meta?.urn ?? "";

      // Find the matching counts (the SocialActivityCounts urn references the backing ugcPost).
      let counts = { reactions: 0, comments: 0, shares: 0 };
      for (const [urn, c] of countsByUrn) {
        const idActivity = activityUrn.match(/(\d{18,})/)?.[1];
        if (idActivity && urn.includes(idActivity)) { counts = c; break; }
      }

      const content = x.content as Record<string, unknown> | undefined;
      const ctype = content ? String(Object.keys(content)[0] ?? "").toLowerCase() : "";
      const mediaType: ProfilePost["mediaType"] =
        ctype.includes("video") ? "video" :
        ctype.includes("image") ? "image" :
        ctype.includes("article") ? "article" : "text";

      posts.push({
        activityUrn,
        text,
        postedAt: timeFromActivityUrn(activityUrn),
        mediaType,
        reactions: counts.reactions,
        comments: counts.comments,
        shares: counts.shares,
      });
    }

    // Most recent first (by encoded time when available).
    posts.sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
    return posts.slice(0, 10);
  } catch {
    return [];
  } finally {
    await page.close();
  }
}

// ─── public ───────────────────────────────────────────────────────────────────

export async function scrapeProfile(
  ctx: BrowserContext,
  target: { sales_nav_url: string | null; linkedin_url: string | null }
): Promise<ProfileScrape> {
  if (!target.sales_nav_url) {
    throw new Error("Contact has no sales_nav_url — cannot scrape the Sales Nav profile.");
  }

  const career = await scrapeSalesCareer(ctx, target.sales_nav_url);

  // Prefer the flagship /in/ URL from the career scrape; fall back to the stored one.
  const inUrl = career.linkedin_url ?? target.linkedin_url ?? null;
  const publicId = publicIdFromUrl(inUrl);
  const recent_posts = publicId ? await scrapePosts(ctx, publicId) : [];

  return {
    full_name: career.full_name ?? null,
    first_name: career.first_name ?? null,
    last_name: career.last_name ?? null,
    headline: career.headline ?? null,
    summary: career.summary ?? null,
    location: career.location ?? null,
    degree: career.degree ?? null,
    linkedin_url: inUrl,
    num_connections: career.num_connections ?? null,
    num_shared_connections: career.num_shared_connections ?? null,
    is_premium: career.is_premium ?? false,
    is_open_profile: career.is_open_profile ?? false,
    can_inmail: career.can_inmail ?? false,
    pending_invitation: career.pending_invitation ?? false,
    websites: career.websites ?? [],
    positions: career.positions ?? [],
    educations: career.educations ?? [],
    skills: career.skills ?? [],
    languages: career.languages ?? [],
    recent_posts,
  };
}
