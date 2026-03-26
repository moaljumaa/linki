import type { Page } from "playwright";

/**
 * Sends a message to a LinkedIn 1st-degree connection.
 * Strategy: navigate to /messaging/thread/new/, search by full name,
 * select the first result, paste message, click send.
 * This works regardless of whether the linkedin_url is a Sales Nav or /in/ URL.
 */
export async function sendMessage(page: Page, fullName: string, text: string): Promise<void> {
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
