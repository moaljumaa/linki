/**
 * Dry-run test: visits profiles and prints exactly what the DOM check sees.
 * Includes one known 1st-degree contact to verify the "connected" path works.
 *
 * Run from /app inside container:
 *   node /app/test-dom-check.js
 */

const Database = require("better-sqlite3");
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

chromium.use(StealthPlugin());

const ACCOUNT_ID = "de7f1de6-442c-48dc-9659-fb779a842937";
const DB_PATH = "/data/linki.db";
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

const TEST_PROFILES = [
  { name: "Abdul Bari (KNOWN 1st degree)", url: "https://www.linkedin.com/in/abdulbari-alwerfeli/", expected: "connected" },
  { name: "Omid Shabab (pending)",         url: "https://www.linkedin.com/in/omid-shabab/",         expected: "pending" },
  { name: "Vasu Zadafia (pending)",        url: "https://www.linkedin.com/in/vasu-zadafia-268a45264/", expected: "pending" },
  { name: "Michael Hollmann (pending)",    url: "https://www.linkedin.com/in/michael-hollmann/",    expected: "pending" },
];

async function checkProfile(page, profile) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Profile: ${profile.name}`);
  console.log(`URL:     ${profile.url}`);
  console.log(`Expected: ${profile.expected}`);

  await page.goto(profile.url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Open ... More menu
  let menuOpened = false;
  try {
    const moreBtn = page.locator('button[aria-label="More"]').last();
    if (await moreBtn.isVisible({ timeout: 2000 })) {
      await moreBtn.click();
      await page.waitForTimeout(800);
      menuOpened = true;
    }
  } catch { /* ignore */ }
  console.log(`... menu opened: ${menuOpened}`);

  const result = await page.evaluate(() => {
    const bodyText = document.body.innerText;

    // The actual checks used in runner.ts
    const is1st = /·\s*1st(\s+degree)?\s*[·|\n]/i.test(bodyText) || /·\s*1º\s*[·|\n]/i.test(bodyText);
    const hasPending = /\bPending\b/i.test(bodyText);

    // Raw snippets around key terms for verification
    const degreeSnippets = [];
    const regex1st = /·\s*(1st|2nd|3rd)(\s+degree)?\s*·/gi;
    let m;
    while ((m = regex1st.exec(bodyText)) !== null) {
      const start = Math.max(0, m.index - 40);
      const end = Math.min(bodyText.length, m.index + m[0].length + 40);
      degreeSnippets.push(bodyText.slice(start, end).replace(/\n/g, " ").trim());
    }

    const pendingSnippets = [];
    const regexPending = /\bPending\b/gi;
    while ((m = regexPending.exec(bodyText)) !== null) {
      const start = Math.max(0, m.index - 40);
      const end = Math.min(bodyText.length, m.index + m[0].length + 40);
      pendingSnippets.push(bodyText.slice(start, end).replace(/\n/g, " ").trim());
    }

    // First 300 chars of body text for orientation
    const bodyPreview = bodyText.slice(0, 300).replace(/\n+/g, " | ").trim();

    return { is1st, hasPending, degreeSnippets, pendingSnippets, bodyPreview };
  });

  console.log(`\nRAW bodyText preview (first 300 chars):`);
  console.log(`  "${result.bodyPreview}"`);

  console.log(`\nDegree snippets (·1st/2nd/3rd· occurrences):`);
  if (result.degreeSnippets.length === 0) {
    console.log("  (none found)");
  } else {
    result.degreeSnippets.forEach((s, i) => console.log(`  [${i}] "${s}"`));
  }

  console.log(`\nPending snippets (\\bPending\\b occurrences):`);
  if (result.pendingSnippets.length === 0) {
    console.log("  (none found)");
  } else {
    result.pendingSnippets.forEach((s, i) => console.log(`  [${i}] "${s}"`));
  }

  console.log(`\nFINAL FLAGS:`);
  console.log(`  is1st:      ${result.is1st}`);
  console.log(`  hasPending: ${result.hasPending}`);

  let verdict;
  if (result.is1st && !result.hasPending) {
    verdict = "✅ CONNECTED";
  } else if (result.hasPending) {
    verdict = "⏳ PENDING";
  } else {
    verdict = "❓ UNKNOWN";
  }

  const correct = verdict.toLowerCase().includes(profile.expected);
  console.log(`\nVERDICT:  ${verdict}`);
  console.log(`CORRECT?: ${correct ? "✅ YES" : "❌ NO — MISMATCH!"}`);
}

async function main() {
  const db = new Database(DB_PATH, { readonly: true });
  const account = db.prepare("SELECT cookies_json FROM accounts WHERE id = ?").get(ACCOUNT_ID);
  if (!account?.cookies_json) throw new Error("No cookies for account");

  const storageState = JSON.parse(account.cookies_json);
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROMIUM_PATH,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  const ctx = await browser.newContext({
    storageState,
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "America/New_York",
  });

  const page = await ctx.newPage();

  for (const profile of TEST_PROFILES) {
    try {
      await checkProfile(page, profile);
    } catch (e) {
      console.log(`  ERROR: ${e.message}`);
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("Done. No DB data was modified.");
  await browser.close();
  db.close();
}

main().catch(err => { console.error(err); process.exit(1); });
