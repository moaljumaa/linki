/**
 * Sales Navigator list scraper using the internal Sales API.
 * Uses Playwright's browser context request (inherits browser TLS fingerprint).
 *
 * Response format discovery (from capture scripts):
 * - ctx.request returns normalized JSON: { data: { metadata: { totalDisplayCount: "106" } }, included: [...] }
 * - Profiles are in `included` filtered by entityUrn containing "salesProfile"
 * - Browser-intercepted first page returns flat: { elements: [...], paging: { total } }
 * - Query format: parentheses/commas unencoded, colons in URN encoded as %3A
 */
import type { BrowserContext } from "playwright";

export interface ScrapedProfile {
  salesNavUrn: string;
  salesNavUrl: string;
  linkedinUrl: string | null;  // regular /in/ URL
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  degree: number | null;
}

interface SalesProfile {
  entityUrn: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  vanityName?: string;
  geoRegion?: string;
  degree?: number;
  currentPositions?: Array<{ title?: string; companyName?: string; current?: boolean }>;
  leadAssociatedAccount?: { name?: string } | null;
}

// Normalized response from ctx.request
interface NormalizedResponse {
  data?: {
    metadata?: {
      totalDisplayCount?: string;
    };
  };
  included?: Array<SalesProfile & { $type?: string }>;
}

// Flat response intercepted from browser
interface FlatResponse {
  elements?: SalesProfile[];
  paging?: { total: number; count: number; start: number };
}

function extractListId(url: string): string | null {
  const match = url.match(/\/sales\/lists\/people\/(\d+)/);
  return match ? match[1] : null;
}

function urnToSalesNavUrl(urn: string): string {
  const match = urn.match(/\(([^)]+)\)/);
  if (!match) return "";
  return `https://www.linkedin.com/sales/lead/${match[1]}`;
}

function profileToResult(el: SalesProfile): ScrapedProfile {
  const currentPos = el.currentPositions?.find((p) => p.current) ?? el.currentPositions?.[0];
  return {
    salesNavUrn: el.entityUrn,
    salesNavUrl: urnToSalesNavUrl(el.entityUrn),
    linkedinUrl: el.vanityName ? `https://www.linkedin.com/in/${el.vanityName}/` : null,
    fullName: el.fullName ?? null,
    firstName: el.firstName ?? null,
    lastName: el.lastName ?? null,
    title: currentPos?.title ?? null,
    company: el.leadAssociatedAccount?.name ?? currentPos?.companyName ?? null,
    location: el.geoRegion ?? null,
    degree: el.degree ?? null,
  };
}

export async function scrapeNavigatorList(
  ctx: BrowserContext,
  salesNavUrl: string,
  maxPages = 50
): Promise<ScrapedProfile[]> {
  const listId = extractListId(salesNavUrl);
  if (!listId) throw new Error(`Invalid Sales Navigator URL: ${salesNavUrl}`);

  const results: ScrapedProfile[] = [];
  const seen = new Set<string>();
  const PAGE_SIZE = 25;
  const listPageUrl = `https://www.linkedin.com/sales/lists/people/${listId}?sortCriteria=CREATED_TIME&sortOrder=DESCENDING`;

  // Navigate to each page URL directly and intercept the salesApiPeopleSearch
  // response the browser fires automatically. Avoids programmatic HTTP calls
  // (ctx.request / page.evaluate fetch) that LinkedIn blocks on datacenter IPs.
  const page = await ctx.newPage();
  let knownTotal = 0;
  let intercepted: FlatResponse | null = null;

  const waitForIntercept = async (url: string, waitMs: number): Promise<FlatResponse | null> => {
    intercepted = null;
    page.removeAllListeners("response");
    page.on("response", async (response) => {
      if (intercepted) return;
      if (response.url().includes("salesApiPeopleSearch") && response.status() === 200) {
        try { intercepted = await response.json() as FlatResponse; } catch { /* ignore */ }
      }
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(waitMs);
    return intercepted;
  };

  // Page 1 — first navigation, auth dance takes ~10-15s on server
  const page1Data = await waitForIntercept(listPageUrl, 15000);

  if (!page1Data) {
    await page.close();
    throw new Error("No data intercepted from Sales Nav — session may need re-authentication");
  }

  knownTotal = page1Data.paging?.total ?? 0;
  for (const el of page1Data.elements ?? []) {
    if (!el.entityUrn || seen.has(el.entityUrn)) continue;
    seen.add(el.entityUrn);
    results.push(profileToResult(el));
  }
  console.log(`[scraper] page 1: ${results.length} results, total=${knownTotal}`);

  // Calculate total pages and navigate to each one
  const totalPages = Math.ceil(knownTotal / PAGE_SIZE);
  const pagesToFetch = Math.min(totalPages, maxPages);

  for (let pageNum = 2; pageNum <= pagesToFetch; pageNum++) {
    const pageUrl = `https://www.linkedin.com/sales/lists/people/${listId}?page=${pageNum}&sortCriteria=CREATED_TIME&sortOrder=DESCENDING`;
    // Subsequent pages: session already warm, 8s is enough
    const pageData = await waitForIntercept(pageUrl, 8000);
    if (pageData) {
      for (const el of pageData.elements ?? []) {
        if (!el.entityUrn || seen.has(el.entityUrn)) continue;
        seen.add(el.entityUrn);
        results.push(profileToResult(el));
      }
    }
    console.log(`[scraper] page ${pageNum}/${pagesToFetch}: ${results.length}/${knownTotal}`);
    if (results.length >= knownTotal) break;
  }

  await page.close();
  return results;
}
