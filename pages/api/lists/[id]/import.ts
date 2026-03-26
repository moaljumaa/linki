import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const db = getDb();
  const listId = req.query.id as string;

  const list = db.prepare("SELECT * FROM lists WHERE id = ?").get(listId);
  if (!list) return res.status(404).json({ error: "List not found" });

  const { sales_nav_url, account_id } = req.body;
  if (!sales_nav_url) return res.status(400).json({ error: "sales_nav_url required" });
  if (!account_id) return res.status(400).json({ error: "account_id required" });

  const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(account_id) as
    | { cookies_json: string | null; is_authenticated: number }
    | undefined;
  if (!account) return res.status(400).json({ error: "Account not found" });
  if (!account.is_authenticated || !account.cookies_json) {
    return res.status(400).json({ error: "Account not authenticated. Please authenticate first." });
  }

  const { getSessionContext } = await import("@/lib/linkedin/session");
  const { scrapeNavigatorUrl } = await import("@/lib/linkedin/scraper");

  try {
    // Save the Sales Nav URL on the list for future sync/reimport without re-asking
    db.prepare("UPDATE lists SET sales_nav_url = ? WHERE id = ?").run(sales_nav_url, listId);

    const ctx = await getSessionContext(account_id);
    const profiles = await scrapeNavigatorUrl(ctx, sales_nav_url);

    const insertTarget = db.prepare(
      `INSERT INTO targets (id, linkedin_url, sales_nav_url, first_name, last_name, full_name, title, company, location, degree)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(linkedin_url) DO UPDATE SET
         sales_nav_url = excluded.sales_nav_url,
         first_name = excluded.first_name,
         last_name = excluded.last_name,
         full_name = excluded.full_name,
         title = excluded.title,
         company = excluded.company,
         location = excluded.location,
         degree = excluded.degree`
    );
    const insertLink = db.prepare(
      "INSERT OR IGNORE INTO list_targets (list_id, target_id) VALUES (?, ?)"
    );
    const findTarget = db.prepare("SELECT id FROM targets WHERE linkedin_url = ?");

    let imported = 0;
    let skipped = 0;

    const upsertAll = db.transaction(() => {
      for (const p of profiles) {
        // Prefer real /in/ URL as the unique key; fall back to salesNavUrl if vanityName wasn't returned
        const url = p.linkedinUrl ?? p.salesNavUrl;
        insertTarget.run(randomUUID(), url, p.salesNavUrl, p.firstName, p.lastName, p.fullName, p.title, p.company, p.location, p.degree);
        const target = findTarget.get(url) as { id: string };
        const result = insertLink.run(listId, target.id);
        if (result.changes > 0) imported++;
        else skipped++;
      }
    });

    upsertAll();

    return res.json({ imported, skipped, total: profiles.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
}

export const config = {
  api: { responseLimit: false, bodyParser: { sizeLimit: "1mb" } },
};
