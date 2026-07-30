import type { Page } from "playwright";
import { readTopCard, messagingUrnFrom } from "./top-card";

/**
 * Visits a LinkedIn profile page. This registers as a profile view on LinkedIn.
 * Navigates and waits, then reports whether the page shows a 1st-degree badge —
 * lets the runner backfill degree=1 for contacts that were already connected
 * before Linki ever sent them a connection request (e.g. manually added leads).
 *
 * Degree comes from the top card's badge only (see ./top-card). Two things make
 * a looser read dangerous, because whatever this returns is written straight to
 * targets.degree by the runner:
 *
 *  - The rest of the main column ("People also viewed", "More profiles for
 *    you") shows *other people's* degree badges, so a page-wide text scrape
 *    marks nearly every visited profile as 1st-degree.
 *  - A "Message" link is not evidence of a connection. Open Profile members
 *    show a Message button to everyone, and the overflow menu's "Send profile
 *    in a message" is itself a /messaging/compose link.
 *
 * Both produced the phantom degree=1 rows that lib/linkedin/sync-accepted.ts
 * exists to clean up.
 *
 * The Message link is still read for its messaging URN
 * (urn:li:fsd_profile:ACoAA...), which lets us message the person later without
 * a name-search typeahead — see lib/linkedin/message.ts. Only the compose links
 * that carry a profileUrn yield one; the rest return null.
 */
export async function visitProfile(page: Page, linkedinUrl: string): Promise<{ isFirstDegree: boolean; messagingUrn: string | null }> {
  await page.goto(linkedinUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000 + Math.random() * 2000);

  const card = await readTopCard(page);
  return {
    isFirstDegree: card.degree === 1,
    messagingUrn: messagingUrnFrom(card.messageHref),
  };
}
