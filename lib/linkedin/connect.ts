import type { Page } from "playwright";

export class WeeklyLimitError extends Error {}
export class AlreadyConnectedError extends Error {}
export class PendingInviteError extends Error {}

/**
 * Sends a LinkedIn connection request without a note.
 * Navigates to the profile page and clicks the Connect button.
 * Throws WeeklyLimitError if the weekly limit popup appears.
 * Throws AlreadyConnectedError / PendingInviteError if already in that state.
 */
export async function sendConnectionRequest(page: Page, linkedinUrl: string): Promise<void> {
  await page.goto(linkedinUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000 + Math.random() * 1000);

  // Already connected? Primary signal: presence of the profile's "Message" link
  // (only shown to 1st-degree connections) — an href attribute, not a CSS class
  // or translated text, so it survives LinkedIn's class-name hashing and non-
  // English UI languages. Falls back to the old text-scrape for accounts/layouts
  // where that link isn't found as a plain <a href>.
  //
  // MUST be scoped to the visited person's own intro/top card — a page-wide
  // search also matches "Message" links / "1st" badges belonging to OTHER
  // people rendered elsewhere on the page (sidebar modules like "People also
  // viewed"). For a non-connected target this false-positived AlreadyConnected,
  // which skipped the real invite AND (via the message step that follows) sent
  // a message to a random unrelated 1st-degree connection instead of the
  // target — see CLAUDE.md / memory for the Jul 2026 incident. The top card is
  // identified structurally as the section containing the page's own <h1> name
  // heading, robust to class-name hashing. Mirrors the same fix in visit.ts.
  const topCard = page.locator("main section").filter({ has: page.locator("h1") }).first();
  const hasMessageLink = await topCard.locator('a[href*="/messaging/compose"]').first().count() > 0;
  if (hasMessageLink) throw new AlreadyConnectedError("Already connected");
  const pageText = await topCard.innerText().catch(() => "");
  if (/\b1st\b/.test(pageText)) throw new AlreadyConnectedError("Already connected");

  // Pending?
  if (/\bPending\b/.test(pageText)) throw new PendingInviteError("Invitation already pending");
  const pendingBtn = page.locator('button[aria-label*="Pending"]:visible');
  if (await pendingBtn.count() > 0) throw new PendingInviteError("Invitation already pending");

  // Case 1: Connect is a primary CTA on the profile card (button or invite link).
  // If it's a link, goto the href — clicking can miss because overlay SVGs intercept pointer events.
  // MUST stay inside topCard: sidebar "More profiles for you" also has Connect buttons.
  // :visible so a Connect row sitting in a closed overflow menu does not steal this path.
  const directConnect = topCard.locator(
    'a[aria-label*="Invite"][aria-label*="to connect"]:visible, button[aria-label*="Invite"][aria-label*="to connect"]:visible, a[href*="custom-invite"]:visible, button:has-text("Connect"):visible, a:has-text("Connect"):visible'
  ).first();
  if (await directConnect.count() > 0) {
    const href = await directConnect.getAttribute("href");
    if (href) {
      const inviteUrl = href.startsWith("http") ? href : `https://www.linkedin.com${href}`;
      await page.goto(inviteUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    } else {
      await directConnect.click({ timeout: 5000 });
    }
    await page.waitForTimeout(1000);
  } else {
    // Case 2: Connect is inside an overflow menu.
    // Flagship /in/ profiles: pill with visible "More" text (or aria-label More / More actions).
    // Sales Nav /sales/lead/ profiles: icon-only ••• with aria-label "Open actions overflow menu"
    // and data-x--lead-actions-bar-overflow-menu — no "More" text, so the old locator timed out.
    // Do not use page-wide .nth(1) — LinkedIn's nav no longer has a More button,
    // so the second match never appears and the click times out (Sep 2026).
    const overflowSelector = [
      'button[aria-label="Open actions overflow menu"]',
      "button[data-x--lead-actions-bar-overflow-menu]",
      'button[aria-label="More"]',
      'button[aria-label*="More"]',
      'button:has-text("More")',
    ].join(", ");
    let moreBtn = topCard.locator(overflowSelector).first();
    if (await moreBtn.count() === 0) {
      // Action bar can sit outside the h1 <section> (new flagship card / Sales Nav lead page).
      moreBtn = page.locator("main").locator(overflowSelector).first();
    }
    await moreBtn.click({ timeout: 8000 });
    await page.waitForTimeout(800);

    const pendingMenuItem = page.locator('[role="menuitem"]:has-text("Pending"):visible, [role="option"]:has-text("Pending"):visible');
    if (await pendingMenuItem.count() > 0) throw new PendingInviteError("Invitation already pending (found in More menu)");

    // Sales Nav Hue menus often omit role="menuitem"; match visible Connect rows too.
    const connectOption = page.locator(
      '[role="menuitem"]:has-text("Connect"):visible, [role="option"]:has-text("Connect"):visible, [role="button"]:has-text("Connect"):visible, button:has-text("Connect"):visible'
    ).first();
    if (await connectOption.count() === 0) throw new Error("Connect option not found in More menu");
    await connectOption.click({ timeout: 5000 });
  }

  await page.waitForTimeout(1000);

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
