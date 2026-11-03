import type { Page } from "playwright";
import { visitProfile } from "./visit";

export class NotConnectedError extends Error {}

export interface SendMessageResult {
  messagingUrn: string | null;
  isFirstDegree: boolean;
}

/**
 * Sends a message to a LinkedIn 1st-degree connection.
 *
 * Self-contained URN resolution — does NOT depend on a prior 'visit' workflow
 * step. If messagingUrn is already cached, it's used directly (no extra page
 * load). Otherwise this does its own live profile check (the same top-card-
 * scoped logic as the 'visit' step, see visit.ts) to fetch a fresh URN and
 * verify the target is still actually connected, immediately before sending.
 * Only if that live check finds no URN despite confirming 1st-degree does it
 * fall back to the connections-only name-search typeahead — a rare last
 * resort now, not the default path for every contact that lacks a cached URN.
 *
 * Throws NotConnectedError if the live check finds the target is NOT 1st-
 * degree, instead of guessing via typeahead search (which can silently hit
 * an unrelated connection with a similar/truncated name — see CLAUDE.md /
 * memory for the Jul 2026 incident this replaced).
 *
 * Returns the resolved { messagingUrn, isFirstDegree } so the caller can
 * persist it to the target record, same as the 'visit' step does.
 */
export async function sendMessage(
  page: Page,
  fullName: string,
  text: string,
  linkedinUrl: string,
  messagingUrn?: string | null
): Promise<SendMessageResult> {
  if (messagingUrn) {
    const opened = await openComposeByUrn(page, messagingUrn);
    if (opened) {
      await sendFromComposeBox(page, text);
      return { messagingUrn, isFirstDegree: true };
    }
  }

  const resolved = await visitProfile(page, linkedinUrl);
  if (resolved.messagingUrn) {
    const opened = await openComposeByUrn(page, resolved.messagingUrn);
    if (opened) {
      await sendFromComposeBox(page, text);
      return resolved;
    }
  }
  if (!resolved.isFirstDegree) {
    throw new NotConnectedError(`${fullName} is not a 1st-degree connection — refusing to message`);
  }

  // Connected, but no message link could be resolved live (unusual layout) —
  // last-resort fallback to name search.
  await sendMessageViaTypeahead(page, fullName, text);
  return resolved;
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

  // Select first result — but verify it's actually the intended person first.
  // This search only returns 1st-degree connections; if the real target isn't
  // connected, LinkedIn will still happily return a same/similar-named
  // connection as the top result, and we'd silently message a stranger.
  const firstResult = page.locator('div[class*="msg-connections-typeahead__search-result-row"]').first();
  await firstResult.waitFor({ timeout: 8000 });
  const resultText = (await firstResult.innerText().catch(() => "")).trim();
  if (!resultNameMatches(resultText, fullName)) {
    throw new Error(
      `Typeahead search for "${fullName}" returned a non-matching result ("${resultText.replace(/\s+/g, " ")}") — refusing to send to avoid messaging the wrong person`
    );
  }
  await firstResult.click({ delay: 100 });
  await page.waitForTimeout(800);

  await sendFromComposeBox(page, text);
}

function resultNameMatches(resultText: string, fullName: string): boolean {
  const normalize = (s: string) =>
    s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  const target = normalize(fullName);
  if (!target) return false;
  return normalize(resultText).includes(target);
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
