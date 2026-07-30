import type { Page } from "playwright";

/** Marker stamped on the top card by readTopCard so locators can scope to it. */
export const TOP_CARD = '[data-linki-topcard="1"]';

export type TopCard = {
  /** innerText of the profile's top card only — never the rest of the column. */
  text: string;
  /** The profile owner's name, as shown in the top card <h1>. */
  name: string;
  /** Network distance from the top card's degree badge: 1, 2, 3 — null if absent. */
  degree: number | null;
  /**
   * href of the top card's "Message" link, if one is shown. NOT a proxy for
   * being connected: Open Profile members show Message to everyone.
   */
  messageHref: string | null;
  /**
   * href of the top card's own Connect affordance, when it is an <a> carrying a
   * custom-invite URL. Null does NOT mean there is no Connect — see
   * hasConnectControl.
   */
  connectHref: string | null;
  /**
   * true when a Connect affordance is visible in the top card at all, whether
   * or not it has an href. A hrefless one is a <button> that opens the invite
   * modal in place, so it has to be clicked rather than navigated to.
   */
  hasConnectControl: boolean;
  /** true when the top card shows a "Pending" invitation button. */
  hasPendingButton: boolean;
};

/**
 * Reads the profile's top card — the section holding the person's <h1> name,
 * degree badge, and the Connect/Message/Pending actions — and stamps it with
 * TOP_CARD so callers can scope further Playwright locators to it.
 *
 * Scoping matters: the rest of the main column ("People also viewed", "More
 * profiles for you", mutual-connection modules) renders degree badges, Message
 * links and Connect links for *other people*. A page-wide read reports "1st"
 * for nearly every profile opened, and a page-wide Connect lookup invites the
 * wrong person entirely.
 *
 * Anchoring on the <h1> rather than a class name keeps this working through
 * LinkedIn's periodic class-name hashing; ".pv-top-card" is a fallback for
 * older layouts.
 */
export async function readTopCard(page: Page): Promise<TopCard> {
  return page.evaluate(() => {
    const empty = {
      text: "", name: "", degree: null, messageHref: null,
      connectHref: null, hasConnectControl: false, hasPendingButton: false,
    };
    const h1 = document.querySelector("main h1") ?? document.querySelector("h1");
    if (!h1) return empty;

    // Find the top card by walking out from the name until an ancestor also
    // contains one of the profile's action controls. Anchoring on "the smallest
    // box holding both the name and the actions" is what makes the result
    // usable: closest("section") can land on a wrapper around the name alone,
    // which silently excludes the "..." overflow button and makes Connect
    // unreachable. Innermost match wins, so this can't widen to the whole
    // column. Capped so a layout without action controls degrades to the old
    // guesses instead of selecting <body>.
    const markers = 'svg[id*="overflow"], [aria-label*="to connect" i], a[href*="custom-invite"], a[href*="/messaging/compose"]';
    let found: HTMLElement | null = null;
    let node: HTMLElement | null = h1.parentElement;
    for (let i = 0; i < 12 && node && node !== document.body; i++) {
      if (node.querySelector(markers)) { found = node; break; }
      node = node.parentElement;
    }

    const card =
      found ??
      (h1.closest("section") as HTMLElement | null) ??
      (document.querySelector(".pv-top-card") as HTMLElement | null) ??
      (h1.parentElement as HTMLElement | null);
    if (!card) return empty;
    card.setAttribute("data-linki-topcard", "1");

    // getClientRects().length > 0 below is a stand-in for Playwright's :visible
    // — a rendered box, not display:none. Inlined rather than hoisted into a
    // named helper: a bundler with keepNames would wrap that in __name(), which
    // doesn't exist in the page context.
    const text = card.innerText ?? "";
    const name = (h1 as HTMLElement | null)?.innerText?.trim() ?? "";

    // Degree badge. Preferred source is the dedicated element; otherwise the
    // badge sits right after the name as "· 3rd". Only fall back to a bare
    // token match on the name line, so a headline like "1st place winner"
    // further down the card can't be mistaken for a degree.
    const badge = card.querySelector(".dist-value, .distance-badge")?.textContent ?? "";
    const nameLine = text.split("\n")[0] ?? "";
    const match =
      badge.match(/\b([123])(?:st|nd|rd)\b/) ??
      text.match(/[·•]\s*([123])(?:st|nd|rd)\b/) ??
      nameLine.match(/\b([123])(?:st|nd|rd)\b/);

    const message = Array.from(card.querySelectorAll('a[href*="/messaging/compose"]'))
      .find(el => el.getClientRects().length > 0);

    // The Connect affordance appears in two shapes: an <a> carrying a
    // custom-invite href, or a <button> that opens the invite modal in place.
    // Either may hold its aria-label on an inner <div>, so match the label
    // anywhere and walk out to the anchor — absence of one means "click it"
    // rather than "no Connect here". The connect-* icon id is matched too, as
    // the aria-label is translated on non-English accounts. Closed overflow
    // menus stay in the DOM with no layout box, which the visibility filter
    // drops.
    const connectEl = Array.from(
      card.querySelectorAll('a[href*="custom-invite"], [aria-label*="to connect" i], svg[id^="connect"]')
    ).find(el => el.getClientRects().length > 0);
    const connect = connectEl?.closest("a") ?? connectEl?.querySelector("a") ?? null;

    const pending = Array.from(card.querySelectorAll("button")).some(
      b => b.getClientRects().length > 0 && /Pending/i.test(b.getAttribute("aria-label") ?? b.textContent ?? "")
    );

    return {
      text,
      name,
      degree: match ? Number(match[1]) : null,
      messageHref: message?.getAttribute("href") ?? null,
      connectHref: connect?.getAttribute("href") ?? null,
      hasConnectControl: !!connectEl,
      hasPendingButton: pending,
    };
  });
}

/** Pulls the messaging URN (urn:li:fsd_profile:ACoAA…) out of a Message link href. */
export function messagingUrnFrom(messageHref: string | null): string | null {
  const match = messageHref?.match(/profileUrn=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Extracts the vanity slug identifying whose profile a URL refers to — the
 * "charvimakker" in both https://www.linkedin.com/in/charvimakker/ and
 * /preload/custom-invite/?vanityName=charvimakker. Returns null when the URL
 * names nobody (company pages, invite overlays keyed only by member URN).
 */
export function vanityFrom(url: string): string | null {
  const param = url.match(/[?&]vanityName=([^&#]+)/i);
  if (param) return decodeURIComponent(param[1]).toLowerCase();
  const path = url.match(/\/in\/([^/?#]+)/);
  return path ? decodeURIComponent(path[1]).toLowerCase() : null;
}
