import type { Page } from "playwright";

/**
 * Visits a LinkedIn profile page. This registers as a profile view on LinkedIn.
 * Navigates and waits, then reports whether the page shows a 1st-degree badge —
 * lets the runner backfill degree=1 for contacts that were already connected
 * before Linki ever sent them a connection request (e.g. manually added leads).
 *
 * Primary-degree signal: presence of the profile's primary "Message" link
 * (a[href*="/messaging/compose"]) — only shown to 1st-degree connections, reads
 * an href attribute rather than a CSS class or translated text, so it survives
 * both LinkedIn's periodic class-name hashing and non-English UI languages.
 *
 * MUST be scoped to the visited person's own intro/top card — a page-wide
 * search also matches "Message" links belonging to OTHER people rendered
 * elsewhere on the page (sidebar modules like "People also viewed" / suggested
 * connections). For a non-connected target, THEIR page has no such link, but
 * the sidebar still does — a page-wide `.first()` silently grabbed a random
 * unrelated 1st-degree connection's link, wrongly marked the target degree=1,
 * and stored that stranger's messaging URN, causing messages to go to the
 * wrong person entirely (incident: Jul 2026, see CLAUDE.md/memory). The top
 * card is identified structurally as the section containing the page's own
 * <h1> name heading, which is robust to LinkedIn's class-name hashing.
 *
 * Falls back to the old text-scrape (/\b1st\b/ within that same top card)
 * when the link isn't found, in case the current account's profile layout
 * doesn't render it as a plain link (e.g. buried behind a click/menu).
 *
 * The same link's href carries the messaging URN (urn:li:fsd_profile:ACoAA...)
 * needed to message this person directly later without a name-search typeahead
 * — see lib/linkedin/message.ts. Returned as messagingUrn when found.
 */
export async function visitProfile(page: Page, linkedinUrl: string): Promise<{ isFirstDegree: boolean; messagingUrn: string | null }> {
  await page.goto(linkedinUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000 + Math.random() * 2000);

  const topCard = page.locator("main section").filter({ has: page.locator("h1") }).first();

  const messageLink = topCard.locator('a[href*="/messaging/compose"]').first();
  const messageHref = (await messageLink.count()) > 0 ? await messageLink.getAttribute("href").catch(() => null) : null;
  const urnMatch = messageHref?.match(/profileUrn=([^&]+)/);
  const messagingUrn = urnMatch ? decodeURIComponent(urnMatch[1]) : null;

  if (messageHref) return { isFirstDegree: true, messagingUrn };

  const pageText = await topCard.innerText().catch(() => "");
  return { isFirstDegree: /\b1st\b/.test(pageText), messagingUrn: null };
}
