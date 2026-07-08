import type { Page } from "playwright";

export interface LinkedInStats {
  connections: number;
  pending: number;
  profile_views: number;
}

function parseNum(str: string): number {
  return parseInt(str.replace(/[^0-9]/g, ""), 10) || 0;
}

export async function scrapeLinkedInStats(page: Page): Promise<LinkedInStats> {
  // ── Connections ───────────────────────────────────────────
  await page.goto("https://www.linkedin.com/mynetwork/invite-connect/connections/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(2500);

  const connectionsTexts = await page.evaluate(() =>
    [...document.querySelectorAll("h1,h2,h3,span,p")]
      .map(el => ((el as HTMLElement).innerText ?? "").trim())
      .filter(t => /\d.*connection/i.test(t))
  );
  const connections = parseNum(connectionsTexts[0] ?? "0");

  // ── Pending sent ──────────────────────────────────────────
  await page.goto("https://www.linkedin.com/mynetwork/invitation-manager/sent/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(2500);

  const pendingTexts = await page.evaluate(() =>
    [...document.querySelectorAll("button,a,span,h1,h2,h3")]
      .map(el => ((el as HTMLElement).innerText ?? "").trim())
      .filter(t => /People\s*\(\d+\)/i.test(t))
  );
  const pendingMatch = (pendingTexts[0] ?? "").match(/\((\d+)\)/);
  const pending = pendingMatch ? parseInt(pendingMatch[1], 10) : 0;

  // ── Profile views ─────────────────────────────────────────
  await page.goto("https://www.linkedin.com/analytics/profile-views/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(3000);

  const profileViewsTexts = await page.evaluate(() =>
    [...document.querySelectorAll("*")]
      .map(el => ((el as HTMLElement).innerText ?? "").trim())
      .filter(t => /Profile viewers/i.test(t) && t.length < 100)
  );
  // The block looks like "185\n\nProfile viewers\n\n30% previous week"
  const pvBlock = profileViewsTexts[0] ?? "";
  const profile_views = parseNum(pvBlock.split("\n")[0]);

  return { connections, pending, profile_views };
}
