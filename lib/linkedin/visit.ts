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
 * Falls back to the old text-scrape (".pv-top-card"/".scaffold-layout__main" +
 * /\b1st\b/) when that link isn't found, in case the current account's profile
 * layout doesn't render it as a plain link (e.g. buried behind a click/menu).
 *
 * The same link's href carries the messaging URN (urn:li:fsd_profile:ACoAA...)
 * needed to message this person directly later without a name-search typeahead
 * — see lib/linkedin/message.ts. Returned as messagingUrn when found.
 */
export async function visitProfile(page: Page, linkedinUrl: string): Promise<{ isFirstDegree: boolean; messagingUrn: string | null }> {
  await page.goto(linkedinUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000 + Math.random() * 2000);

  const messageLink = page.locator('a[href*="/messaging/compose"]').first();
  const messageHref = (await messageLink.count()) > 0 ? await messageLink.getAttribute("href").catch(() => null) : null;
  const urnMatch = messageHref?.match(/profileUrn=([^&]+)/);
  const messagingUrn = urnMatch ? decodeURIComponent(urnMatch[1]) : null;

  if (messageHref) return { isFirstDegree: true, messagingUrn };

  const pageText = await page.locator(".pv-top-card, .scaffold-layout__main").first().innerText().catch(() => "");
  return { isFirstDegree: /\b1st\b/.test(pageText), messagingUrn: null };
}
