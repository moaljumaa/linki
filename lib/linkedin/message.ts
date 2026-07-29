import type { Page } from "playwright";

/**
 * Sends a message to a LinkedIn 1st-degree connection.
 *
 * If messagingUrn is available (captured by visitProfile from the target's
 * profile page — see lib/linkedin/visit.ts), navigates straight to the
 * pre-addressed compose URL, skipping the profile page's button/menu layout
 * entirely. Falls back to the name-search typeahead flow (navigate to
 * /messaging/thread/new/, search by full name, select first result) when no
 * URN is stored yet, or if the direct-compose path doesn't produce a working
 * compose box for any reason — keeps existing behavior for every contact that
 * predates this feature.
 */
export async function sendMessage(page: Page, fullName: string, text: string, messagingUrn?: string | null): Promise<void> {
  if (messagingUrn) {
    const opened = await openComposeByUrn(page, messagingUrn);
    if (opened) {
      await sendFromComposeBox(page, text);
      return;
    }
  }
  await sendMessageViaTypeahead(page, fullName, text);
}

async function openComposeByUrn(page: Page, messagingUrn: string): Promise<boolean> {
  try {
    const recipientId = messagingUrn.split(":").pop();
    const composeUrl = `https://www.linkedin.com/messaging/compose/?profileUrn=${encodeURIComponent(messagingUrn)}&recipient=${recipientId}`;
    await page.goto(composeUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500 + Math.random() * 1000);
    const msgInput = page.locator("div.msg-form__contenteditable").first();
    await msgInput.waitFor({ timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

async function sendMessageViaTypeahead(page: Page, fullName: string, text: string): Promise<void> {
  await page.goto("https://www.linkedin.com/messaging/thread/new/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(1500 + Math.random() * 1000);

  // Search for recipient by name
  const searchField = page.locator("input.msg-connections-typeahead__search-field").first();
  await searchField.waitFor({ timeout: 10000 });
  await searchField.click();
  await searchField.type(fullName, { delay: 60 + Math.random() * 40 });
  await page.waitForTimeout(1500);

  // Select first result
  const firstResult = page.locator('div[class*="msg-connections-typeahead__search-result-row"]').first();
  await firstResult.waitFor({ timeout: 8000 });
  await firstResult.click({ delay: 100 });
  await page.waitForTimeout(800);

  await sendFromComposeBox(page, text);
}

async function sendFromComposeBox(page: Page, text: string): Promise<void> {
  // Paste message into compose area
  const msgInput = page.locator("div.msg-form__contenteditable").first();
  await msgInput.waitFor({ timeout: 8000 });
  await msgInput.click();
  try {
    await page.evaluate((t) => navigator.clipboard.writeText(t), text);
    await page.waitForTimeout(300);
    await msgInput.press("Control+V");
  } catch {
    // Clipboard blocked in headless — fall back to keyboard typing
    await msgInput.pressSequentially(text, { delay: 20 });
  }
  await page.waitForTimeout(500);

  // Send
  const sendBtn = page.locator("button.msg-form__send-button:visible").first();
  await sendBtn.waitFor({ timeout: 5000 });
  await sendBtn.click({ delay: 100 });
  await page.waitForTimeout(2000);
}
