import type { Page } from "playwright";

/**
 * Scrapes the full list of vanity names from the sent invitations page.
 * Returns a Set of lowercase vanity names that are STILL pending on LinkedIn.
 *
 * Strategy: navigate to invitation-manager/sent/, scroll the #workspace container
 * until the count stabilises, then extract all /in/ links.
 *
 * Works headless — the scrollable element is <main id="workspace">, not window.
 */
export async function scrapePendingInvitationVanityNames(page: Page): Promise<Set<string>> {
  await page.goto("https://www.linkedin.com/mynetwork/invitation-manager/sent/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(3000);

  // Scroll #workspace until link count stabilises
  let lastCount = 0;
  let stableRounds = 0;

  for (let round = 0; round < 40; round++) {
    await page.evaluate(() => {
      const workspace = document.getElementById("workspace");
      if (workspace) {
        workspace.scrollTop = workspace.scrollHeight;
      } else {
        // Fallback: scroll window + body
        window.scrollTo(0, document.body.scrollHeight);
        document.documentElement.scrollTop = document.documentElement.scrollHeight;
      }
    });
    await page.waitForTimeout(1200);

    const currentCount = await page.evaluate(() =>
      document.querySelectorAll("a[href*='/in/']").length
    );

    if (currentCount === lastCount) {
      stableRounds++;
      if (stableRounds >= 3) break;
    } else {
      stableRounds = 0;
      lastCount = currentCount;
    }
  }

  // Extract unique vanity names from all /in/ links
  const vanityNames = await page.evaluate(() => {
    const seen = new Set<string>();
    for (const link of document.querySelectorAll<HTMLAnchorElement>("a[href*='/in/']")) {
      const href = link.getAttribute("href") ?? "";
      const match = href.match(/\/in\/([^/?#]+)/);
      if (match) seen.add(match[1].toLowerCase());
    }
    return [...seen];
  });

  return new Set(vanityNames);
}
