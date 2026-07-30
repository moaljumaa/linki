import type { Page } from "playwright";
import { readTopCard, vanityFrom, TOP_CARD } from "./top-card";

export class WeeklyLimitError extends Error {}
export class AlreadyConnectedError extends Error {}
export class PendingInviteError extends Error {}

/**
 * The top card's "..." overflow trigger. It carries no aria-label and its
 * classes are hashed, so it's identified by the icon it wraps
 * (<svg id="overflow-web-ios-small">). Ancestors come first in document order,
 * so .first() prefers a real button over the inner span when both exist.
 */
const OVERFLOW_TRIGGER = [
  'button[aria-label*="More" i]',
  '[role="button"][aria-label*="More" i]',
  'button:has(svg[id*="overflow"])',
  '[role="button"]:has(svg[id*="overflow"])',
  'span:has(> svg[id*="overflow"])',
];

const MORE_BUTTON = OVERFLOW_TRIGGER.map(s => `${TOP_CARD} ${s}:visible`).join(", ");

/**
 * Same trigger, searched across the main column. Used only when the top card
 * couldn't be pinned down: the profile's own "..." precedes any in suggestion
 * cards further down, and opening the wrong menu has no side effect — the
 * vanity check on the invite URL is what actually keeps us from inviting a
 * stranger. Excludes the nav bar, which has its own "More".
 */
const MORE_BUTTON_ANYWHERE = OVERFLOW_TRIGGER.map(s => `main ${s}:visible`).join(", ");

/**
 * The Connect control itself, for the layouts that render it as a hrefless
 * <button> opening the invite modal in place. Ancestors sort first in document
 * order, so .first() lands on the button rather than the inner label/icon.
 */
const CONNECT_CONTROL = [
  `${TOP_CARD} a[href*="custom-invite"]`,
  `${TOP_CARD} button[aria-label*="to connect" i]`,
  `${TOP_CARD} [role="button"][aria-label*="to connect" i]`,
  `${TOP_CARD} button:has(svg[id^="connect"])`,
  `${TOP_CARD} [role="button"]:has(svg[id^="connect"])`,
  `${TOP_CARD} [aria-label*="to connect" i]`,
].map(s => `${s}:visible`).join(", ");

/**
 * Navigates to a custom-invite URL, refusing first if it names anyone other
 * than the profile we were asked to connect with — the last line of defence
 * against inviting a "More profiles for you" suggestion by mistake. The check
 * is skipped when the URL names nobody (some overlays are keyed only by member
 * URN); scoping the lookup to the top card is what makes that case safe.
 *
 * Navigating beats clicking here because the Sales Nav overlay SVG intercepts
 * pointer events on the profile page.
 */
async function gotoInvite(page: Page, href: string, linkedinUrl: string): Promise<void> {
  const inviteUrl = href.startsWith("http") ? href : `https://www.linkedin.com${href}`;
  const wanted = vanityFrom(linkedinUrl);
  const inviting = vanityFrom(inviteUrl);
  if (wanted && inviting && wanted !== inviting) {
    throw new Error(`Connect link targets "${inviting}", expected "${wanted}" — refusing to invite`);
  }
  await page.goto(inviteUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1000);
}

/**
 * Sends a LinkedIn connection request without a note.
 * Navigates to the profile page and clicks the Connect button.
 * Throws WeeklyLimitError if the weekly limit popup appears.
 * Throws AlreadyConnectedError / PendingInviteError if already in that state.
 */
export async function sendConnectionRequest(page: Page, linkedinUrl: string): Promise<void> {
  await page.goto(linkedinUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000 + Math.random() * 1000);

  // Profile state is read from the top card only (see ./top-card). The rest of
  // the page — "People also viewed", "More profiles for you" — carries Connect
  // links, Message links and degree badges belonging to *other people*; a
  // page-wide locator reads those and invites the wrong person.
  const card = await readTopCard(page);

  // The degree badge is the authoritative connected/not-connected signal. A
  // "Message" button is NOT: Open Profile members show one to everyone, and the
  // overflow menu's "Send profile in a message" is itself a /messaging/compose
  // link. Treating either as proof of 1st-degree cancels legitimate invites to
  // 2nd/3rd-degree profiles.
  if (card.degree === 1) throw new AlreadyConnectedError("Already connected");

  if (card.hasPendingButton || /\bPending\b/.test(card.text)) {
    throw new PendingInviteError("Invitation already pending");
  }

  // LinkedIn puts Connect in the top card on some profiles and behind the "..."
  // overflow menu on others, so both are handled. Within each, the control is
  // either an <a> carrying a custom-invite URL (navigate to it) or a hrefless
  // <button> that opens the invite modal in place (click it).
  if (card.connectHref) {
    await gotoInvite(page, card.connectHref, linkedinUrl);
  } else if (card.hasConnectControl) {
    await page.locator(CONNECT_CONTROL).first().click({ force: true });
    await page.waitForTimeout(1000);
  } else {
    let moreBtn = page.locator(MORE_BUTTON).first();
    if (await moreBtn.count() === 0) moreBtn = page.locator(MORE_BUTTON_ANYWHERE).first();
    if (await moreBtn.count() === 0) {
      throw new Error(`No Connect action and no overflow menu on profile for ${card.name || linkedinUrl}`);
    }
    await moreBtn.click();
    await page.waitForTimeout(800);

    // The menu is portaled out of the top card (popover, position:fixed), so it
    // has to be located page-level rather than scoped to TOP_CARD.
    const menu = page.locator('[role="menu"]:visible').first();
    if (await menu.count() === 0) throw new Error("Overflow menu did not open");

    const menuText = await menu.innerText().catch(() => "");
    if (/\bPending\b/.test(menuText)) {
      throw new PendingInviteError("Invitation already pending (found in More menu)");
    }

    // Matched by href and icon id rather than the "Connect" label, which is
    // translated on non-English accounts.
    const menuConnect = menu.locator(
      'a[href*="custom-invite"], [aria-label*="to connect" i], [role="menuitem"]:has(svg[id^="connect"])'
    ).first();
    if (await menuConnect.count() === 0) throw new Error("Connect option not found in More menu");

    const href = await menuConnect.getAttribute("href").catch(() => null);
    if (href) {
      await gotoInvite(page, href, linkedinUrl);
    } else {
      await menuConnect.click({ force: true });
      await page.waitForTimeout(1000);
    }
  }

  // Click "Send without a note" / "Send now"
  const sendBtn = page.locator(
    'button:has-text("Send now"), button[aria-label*="Send without"], button[aria-label*="Send invitation"]:not([aria-label*="note"])'
  );
  if (await sendBtn.count() > 0) {
    await sendBtn.first().click({ force: true });
    await page.waitForTimeout(1500);
  }

  // Check for weekly limit popup
  const limitPopup = page.locator('div[class*="ip-fuse-limit-alert__warning"]');
  if (await limitPopup.count() > 0) throw new WeeklyLimitError("Weekly connection limit reached");

  // Check for error toast
  const errorToast = page.locator('div[data-test-artdeco-toast-item-type="error"]:visible');
  if (await errorToast.count() > 0) {
    const msg = await errorToast.innerText();
    throw new Error(`Connection error: ${msg.trim()}`);
  }
}
