/**
 * Test script: intercept RSC pagination responses from invitation manager
 * and extract vanity names from them.
 *
 * Run from /app inside container:
 *   node /app/test-rsc-invitations.js
 */

const Database = require("better-sqlite3");
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

chromium.use(StealthPlugin());

const ACCOUNT_ID = "de7f1de6-442c-48dc-9659-fb779a842937";
const DB_PATH = "/data/linki.db";
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

async function main() {
  const db = new Database(DB_PATH, { readonly: true });
  const account = db.prepare("SELECT cookies_json FROM accounts WHERE id = ?").get(ACCOUNT_ID);
  if (!account?.cookies_json) throw new Error("No cookies for account");

  let storageState;
  try {
    storageState = JSON.parse(account.cookies_json);
  } catch {
    throw new Error("Invalid cookies_json");
  }

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

  // Accumulate all vanity names found across RSC pagination responses
  const allVanityNames = new Set();
  let paginationCallCount = 0;

  // Intercept RSC pagination responses
  await page.route("**/flagship-web/rsc-action/actions/pagination*invitationsList*", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    paginationCallCount++;

    // Extract /in/ vanity names from the RSC wire format
    // Match both encoded (%xx) and plain vanity names
    const matches = body.match(/\/in\/([a-zA-Z0-9\-_%]+)/g) ?? [];
    for (const m of matches) {
      const raw = m.replace("/in/", "");
      // Store both the raw form and the decoded form for matching
      const decoded = decodeURIComponent(raw).toLowerCase();
      const encoded = raw.toLowerCase();
      if (decoded.length > 2) allVanityNames.add(decoded);
      if (encoded.length > 2) allVanityNames.add(encoded);
    }

    console.log(`[pagination #${paginationCallCount}] RSC response length: ${body.length}, /in/ matches: ${matches.length}, total unique: ${allVanityNames.size}`);

    // On first call, dump a snippet to inspect structure
    if (paginationCallCount === 1) {
      console.log("\n--- RSC BODY SAMPLE (first 1000 chars) ---");
      console.log(body.substring(0, 1000));
      console.log("--- END SAMPLE ---\n");
      // Look for cursor/pagination tokens
      const cursorMatches = body.match(/"cursor":"[^"]+"/g) ?? [];
      const startMatches = body.match(/"start":\d+/g) ?? [];
      const countMatches = body.match(/"count":\d+/g) ?? [];
      const totalMatches = body.match(/"total":\d+/g) ?? [];
      console.log("Cursors:", cursorMatches.slice(0, 3));
      console.log("Starts:", startMatches.slice(0, 3));
      console.log("Counts:", countMatches.slice(0, 3));
      console.log("Totals:", totalMatches.slice(0, 3));
    }

    await route.fulfill({ response });
  });

  console.log("Navigating to invitation manager...");
  await page.goto("https://www.linkedin.com/mynetwork/invitation-manager/sent/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(3000);

  // Scroll to trigger pagination
  console.log("Scrolling to load all invitations...");
  let lastPaginationCount = 0;
  let stableRounds = 0;

  for (let round = 0; round < 100; round++) {
    await page.evaluate(() => {
      // Try scrolling the main content area and window
      const workspace = document.getElementById("workspace");
      const main = document.querySelector("main");
      const scrollable = workspace || main;
      if (scrollable) {
        scrollable.scrollTop = scrollable.scrollHeight;
      }
      window.scrollTo(0, document.body.scrollHeight);
      document.documentElement.scrollTop = document.documentElement.scrollHeight;
    });
    await page.waitForTimeout(2000);

    if (paginationCallCount === lastPaginationCount) {
      stableRounds++;
      if (stableRounds >= 5) {
        console.log(`\nNo new pagination after ${round + 1} scroll rounds — stopping`);
        break;
      }
    } else {
      stableRounds = 0;
      lastPaginationCount = paginationCallCount;
    }

    process.stdout.write(`\r  round ${round + 1}, pagination calls: ${paginationCallCount}, unique names: ${allVanityNames.size}  `);
  }
  console.log();

  console.log(`\n=== RESULTS ===`);
  console.log(`Total RSC pagination calls intercepted: ${paginationCallCount}`);
  console.log(`Total unique vanity names captured: ${allVanityNames.size}`);
  console.log(`\nVanity names:`);
  for (const name of [...allVanityNames].sort()) {
    console.log(`  ${name}`);
  }

  // Cross-check against DB: how many pending targets do we have?
  const dbPending = db.prepare(`
    SELECT t.linkedin_url FROM targets t
    WHERE t.connection_requested_at IS NOT NULL
    AND (t.degree IS NULL OR t.degree != 1)
    AND t.connected_at IS NULL
  `).all();

  console.log(`\nDB pending targets: ${dbPending.length}`);

  let matchCount = 0;
  let wouldMarkAccepted = 0;
  for (const row of dbPending) {
    const match = row.linkedin_url?.match(/\/in\/([^/?#]+)/);
    if (!match) continue;
    const vanityRaw = match[1].toLowerCase();
    let vanityDecoded = vanityRaw;
    try { vanityDecoded = decodeURIComponent(vanityRaw).toLowerCase(); } catch {}
    // Match against both forms stored in allVanityNames
    if (allVanityNames.has(vanityRaw) || allVanityNames.has(vanityDecoded)) {
      matchCount++;
    } else {
      wouldMarkAccepted++;
      console.log(`  Would mark ACCEPTED: ${vanityRaw} (decoded: ${vanityDecoded})`);
    }
  }
  console.log(`\nStill pending (found in RSC): ${matchCount}`);
  console.log(`Would mark accepted (NOT in RSC): ${wouldMarkAccepted}`);
  console.log(`\nNote: if 'would mark accepted' is much higher than expected, RSC parsing is incomplete.`);

  await browser.close();
  db.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
