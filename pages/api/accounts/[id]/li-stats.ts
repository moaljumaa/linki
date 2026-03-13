import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { getSessionPage, saveSessionState } from "@/lib/linkedin/session";
import { scrapeLinkedInStats } from "@/lib/linkedin/li-stats";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const accountId = req.query.id as string;
  const db = getDb();
  const account = db.prepare("SELECT id, is_authenticated FROM accounts WHERE id = ?").get(accountId) as
    | { id: string; is_authenticated: number }
    | undefined;

  if (!account) return res.status(404).json({ error: "Account not found" });
  if (!account.is_authenticated) return res.status(400).json({ error: "Account not authenticated" });

  let page;
  try {
    page = await getSessionPage(accountId);
    const stats = await scrapeLinkedInStats(page);
    await saveSessionState(accountId);
    return res.json(stats);
  } catch (err) {
    console.error("[li-stats]", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "Scrape failed" });
  } finally {
    await page?.close().catch(() => {});
  }
}
