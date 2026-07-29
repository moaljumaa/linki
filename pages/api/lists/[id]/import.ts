import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { startImport, getDailyImportCap } from "@/lib/import-jobs";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const db = getDb();
  const listId = req.query.id as string;

  const list = db.prepare("SELECT * FROM lists WHERE id = ?").get(listId);
  if (!list) return res.status(404).json({ error: "List not found" });

  const { sales_nav_url, account_id, enrich } = req.body as {
    sales_nav_url?: string;
    account_id?: string;
    enrich?: boolean;
  };
  if (!sales_nav_url) return res.status(400).json({ error: "sales_nav_url required" });
  if (!account_id) return res.status(400).json({ error: "account_id required" });

  const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(account_id) as
    | { cookies_json: string | null; is_authenticated: number }
    | undefined;
  if (!account) return res.status(400).json({ error: "Account not found" });
  if (!account.is_authenticated || !account.cookies_json) {
    return res.status(400).json({ error: "Account not authenticated. Please authenticate first." });
  }

  // Already an active import for this list?
  const existing = db
    .prepare("SELECT id FROM list_imports WHERE list_id = ? AND status IN ('running','scheduled')")
    .get(listId);
  if (existing) {
    return res.status(409).json({ error: "An import is already queued or running for this list" });
  }

  // Save the Sales Nav URL on the list for reference
  db.prepare("UPDATE lists SET sales_nav_url = ? WHERE id = ?").run(sales_nav_url, listId);

  // Queue the first batch — the runner scheduler picks it up (one import at a time)
  const { importId } = startImport(db, { listId, accountId: account_id, salesNavUrl: sales_nav_url, enrich });

  res.json({ started: true, importId, dailyCap: getDailyImportCap(db) });
}
