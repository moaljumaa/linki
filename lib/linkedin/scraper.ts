/**
 * Sales Navigator list scraper using the internal Sales API.
 * Uses Playwright's browser context request (inherits browser TLS fingerprint).
 *
 * Response format discovery (from capture scripts):
 * - ctx.request returns normalized JSON: { data: { metadata: { totalDisplayCount: "106" } }, included: [...] }
 * - Profiles are in `included` filtered by entityUrn containing "salesProfile"
 * - Browser-intercepted first page returns flat: { elements: [...], paging: { total } }
 * - Query format: parentheses/commas unencoded, colons in URN encoded as %3A
 *
 * IMPORTANT — vanityName is gone from salesApiPeopleSearch (dropped by LinkedIn ~March 2026):
 * The list API no longer returns vanityName. To get the real /in/ URL we call
 * salesApiProfiles per batch of 25 after scraping, using flagshipProfileUrl.
 * See docs/linkedin-api-learnings.md for the full investigation.
 */
import type { BrowserContext, Page } from "playwright";

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

// Flat response intercepted from browser
interface FlatResponse {
  elements?: SalesProfile[];
  paging?: { total: number; count: number; start: number };
}

// salesApiProfiles single-profile response
interface ProfileDetailResponse {
  entityUrn?: string;
  flagshipProfileUrl?: string;
  fullName?: string;
}

function extractListId(url: string): string | null {
  const match = url.match(/\/sales\/lists\/people\/(\d+)/);
  return match ? match[1] : null;
}

function extractSavedSearchId(url: string): string | null {
  const match = url.match(/[?&]savedSearchId=(\d+)/);
  return match ? match[1] : null;
}

function urnToSalesNavUrl(urn: string): string {
  const match = urn.match(/\(([^)]+)\)/);
  if (!match) return "";
  return `https://www.linkedin.com/sales/lead/${match[1]}`;
}

/**
 * Parse profileId, authType, authToken out of a salesProfile URN.
 * urn:li:fs_salesProfile:(ACwAAEIY-4YB25mKP6R5AKfkFjhO9isSbvsVlag,NAME_SEARCH,22wq)
 */
function parseUrn(entityUrn: string): { profileId: string; authType: string; authToken: string } | null {
  const match = entityUrn.match(/\(([^,]+),([^,]+),([^)]+)\)/);
  if (!match) return null;
  return { profileId: match[1], authType: match[2], authToken: match[3] };
}

function profileToResult(el: SalesProfile, linkedinUrl: string | null): ScrapedProfile {
  const currentPos = el.currentPositions?.find((p) => p.current) ?? el.currentPositions?.[0];
  return {
    salesNavUrn: el.entityUrn,
    salesNavUrl: urnToSalesNavUrl(el.entityUrn),
    linkedinUrl,
    fullName: el.fullName ?? null,
    firstName: el.firstName ?? null,
    lastName: el.lastName ?? null,
    title: currentPos?.title ?? null,
    company: el.leadAssociatedAccount?.name ?? currentPos?.companyName ?? null,
    location: el.geoRegion ?? null,
    degree: el.degree ?? null,
  };
}

/**
 * Enrich profiles with their real /in/ URL via salesApiProfiles (flagshipProfileUrl).
 *
 * Uses page.evaluate fetch with JSESSIONID csrf-token. On 429 (rate limit),
 * backs off for 30s and retries. Delay between calls: 2s normally, 30s after 429.
 *
 * For 100 profiles at 2s/call = ~3.5 minutes. Happens once at import time.
 */
async function enrichWithFlagshipUrls(
  page: Page,
  profiles: SalesProfile[]
): Promise<Map<string, string>> {
  const urlMap = new Map<string, string>(); // entityUrn → flagshipProfileUrl

  const cookies = await page.context().cookies("https://www.linkedin.com");
  const jsessionid = cookies.find(c => c.name === "JSESSIONID")?.value?.replace(/"/g, "") ?? "";
  if (!jsessionid) {
    console.log("[scraper] JSESSIONID not found — skipping flagshipProfileUrl enrichment");
    return urlMap;
  }

  for (const el of profiles) {
    const parts = parseUrn(el.entityUrn);
    if (!parts) continue;

    const { profileId, authType, authToken } = parts;
    const apiUrl = `https://www.linkedin.com/sales-api/salesApiProfiles/(profileId:${profileId},authType:${authType},authToken:${authToken})?decoration=%28entityUrn%2CflagshipProfileUrl%29`;

    let attempts = 0;
    while (attempts < 3) {
      const result = await page.evaluate(async ({ url, csrfToken }: { url: string; csrfToken: string }) => {
        try {
          const resp = await fetch(url, {
            credentials: "include",
            headers: {
              "csrf-token": csrfToken,
              "x-restli-protocol-version": "2.0.0",
              "accept": "application/json",
            },
          });
          return { status: resp.status, body: await resp.text() };
        } catch (e: unknown) {
          return { status: -1, body: (e as Error).message };
        }
      }, { url: apiUrl, csrfToken: jsessionid });

      if (result.status === 200) {
        try {
          const data = JSON.parse(result.body) as ProfileDetailResponse;
          if (data.flagshipProfileUrl) {
            const normalized = data.flagshipProfileUrl.endsWith("/")
              ? data.flagshipProfileUrl
              : data.flagshipProfileUrl + "/";
            urlMap.set(el.entityUrn, normalized);
          }
        } catch { /* ignore parse errors */ }
        break;
      } else if (result.status === 429) {
        attempts++;
        console.log(`[scraper] 429 rate limit — waiting 30s before retry (attempt ${attempts}/3)`);
        await page.waitForTimeout(30000);
      } else {
        console.log(`[scraper] enrichment ${result.status} for ${el.fullName ?? el.entityUrn.substring(0, 30)}`);
        break;
      }
    }

    // 2s between calls — slow enough to stay under rate limits
    await page.waitForTimeout(2000);
  }

  console.log(`[scraper] enrichment done: ${urlMap.size}/${profiles.length} profiles resolved`);
  return urlMap;
}

export async function scrapeNavigatorList(
  ctx: BrowserContext,
  salesNavUrl: string,
  maxPages = 50
): Promise<ScrapedProfile[]> {
  const listId = extractListId(salesNavUrl);
  if (!listId) throw new Error(`Invalid Sales Navigator URL: ${salesNavUrl}`);

  const allElements: SalesProfile[] = [];
  const seen = new Set<string>();
  const PAGE_SIZE = 25;
  const listPageUrl = `https://www.linkedin.com/sales/lists/people/${listId}?sortCriteria=CREATED_TIME&sortOrder=DESCENDING`;

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
    allElements.push(el);
  }
  console.log(`[scraper] page 1: ${allElements.length} elements, total=${knownTotal}`);

  const totalPages = Math.ceil(knownTotal / PAGE_SIZE);
  const pagesToFetch = Math.min(totalPages, maxPages);

  for (let pageNum = 2; pageNum <= pagesToFetch; pageNum++) {
    const pageUrl = `https://www.linkedin.com/sales/lists/people/${listId}?page=${pageNum}&sortCriteria=CREATED_TIME&sortOrder=DESCENDING`;
    let pageData = await waitForIntercept(pageUrl, 12000);
    if (!pageData || (pageData.elements?.length ?? 0) === 0) {
      console.log(`[scraper] page ${pageNum} empty on first try — retrying with 15s wait`);
      pageData = await waitForIntercept(pageUrl, 15000);
    }
    if (pageData) {
      for (const el of pageData.elements ?? []) {
        if (!el.entityUrn || seen.has(el.entityUrn)) continue;
        seen.add(el.entityUrn);
        allElements.push(el);
      }
    }
    console.log(`[scraper] page ${pageNum}/${pagesToFetch}: ${allElements.length}/${knownTotal}`);
    if (allElements.length >= knownTotal) break;
  }

  // Enrich all profiles with flagshipProfileUrl (real /in/ URL)
  console.log(`[scraper] enriching ${allElements.length} profiles with flagshipProfileUrl...`);
  const urlMap = await enrichWithFlagshipUrls(page, allElements);
  console.log(`[scraper] got flagshipProfileUrl for ${urlMap.size}/${allElements.length} profiles`);

  await page.close();

  return allElements.map(el => {
    const linkedinUrl = urlMap.get(el.entityUrn) ?? null;
    return profileToResult(el, linkedinUrl);
  });
}

export async function scrapeSavedSearch(
  ctx: BrowserContext,
  savedSearchUrl: string,
  maxPages = 50
): Promise<ScrapedProfile[]> {
  const savedSearchId = extractSavedSearchId(savedSearchUrl);
  if (!savedSearchId) throw new Error(`Invalid Sales Navigator saved search URL: ${savedSearchUrl}`);

  const allElements: SalesProfile[] = [];
  const seen = new Set<string>();

  const page = await ctx.newPage();
  let knownTotal = 0;

  const waitForIntercept = async (url: string, waitMs: number): Promise<FlatResponse | null> => {
    let intercepted: FlatResponse | null = null;
    page.removeAllListeners("response");
    page.on("response", async (response) => {
      if (intercepted) return;
      if (response.url().includes("salesApiLeadSearch") && response.status() === 200) {
        try { intercepted = await response.json() as FlatResponse; } catch { /* ignore */ }
      }
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(waitMs);
    return intercepted;
  };

  // Page 1
  const page1Url = `https://www.linkedin.com/sales/search/people?savedSearchId=${savedSearchId}`;
  const page1Data = await waitForIntercept(page1Url, 15000);

  if (!page1Data) {
    await page.close();
    throw new Error("No data intercepted from saved search — session may need re-authentication");
  }

  knownTotal = page1Data.paging?.total ?? 0;
  for (const el of page1Data.elements ?? []) {
    if (!el.entityUrn || seen.has(el.entityUrn)) continue;
    seen.add(el.entityUrn);
    allElements.push(el);
  }
  console.log(`[scraper:saved-search] page 1: ${allElements.length} elements, total=${knownTotal}`);

  const PAGE_SIZE = 25;
  const totalPages = Math.ceil(knownTotal / PAGE_SIZE);
  const pagesToFetch = Math.min(totalPages, maxPages);

  for (let pageNum = 2; pageNum <= pagesToFetch; pageNum++) {
    const pageUrl = `https://www.linkedin.com/sales/search/people?savedSearchId=${savedSearchId}&page=${pageNum}`;
    let pageData = await waitForIntercept(pageUrl, 12000);
    if (!pageData || (pageData.elements?.length ?? 0) === 0) {
      console.log(`[scraper:saved-search] page ${pageNum} empty on first try — retrying with 15s wait`);
      pageData = await waitForIntercept(pageUrl, 15000);
    }
    if (pageData) {
      for (const el of pageData.elements ?? []) {
        if (!el.entityUrn || seen.has(el.entityUrn)) continue;
        seen.add(el.entityUrn);
        allElements.push(el);
      }
    }
    console.log(`[scraper:saved-search] page ${pageNum}/${pagesToFetch}: ${allElements.length}/${knownTotal}`);
    if (allElements.length >= knownTotal) break;
  }

  // Enrich all profiles with flagshipProfileUrl (real /in/ URL)
  console.log(`[scraper:saved-search] enriching ${allElements.length} profiles with flagshipProfileUrl...`);
  const urlMap = await enrichWithFlagshipUrls(page, allElements);
  console.log(`[scraper:saved-search] got flagshipProfileUrl for ${urlMap.size}/${allElements.length} profiles`);

  await page.close();

  return allElements.map(el => {
    const linkedinUrl = urlMap.get(el.entityUrn) ?? null;
    return profileToResult(el, linkedinUrl);
  });
}

/**
 * Dispatcher — accepts either a lead list URL or a saved search URL.
 * Callers don't need to know which type they're dealing with.
 */
export async function scrapeNavigatorUrl(
  ctx: BrowserContext,
  url: string,
  maxPages = 50
): Promise<ScrapedProfile[]> {
  if (extractSavedSearchId(url)) {
    return scrapeSavedSearch(ctx, url, maxPages);
  }
  if (extractListId(url)) {
    return scrapeNavigatorList(ctx, url, maxPages);
  }
  throw new Error(`Unrecognized Sales Navigator URL. Expected a list URL (/sales/lists/people/...) or saved search URL (?savedSearchId=...)`);
}
