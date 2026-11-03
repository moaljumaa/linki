import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { matchPerson, applyApolloMatchResult } from "@/lib/apollo";
import { decryptSecret } from "@/lib/crypto";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const db = getDb();
  const listId = req.query.id as string;

  const list = db.prepare("SELECT id FROM lists WHERE id = ?").get(listId);
  if (!list) return res.status(404).json({ error: "List not found" });

  const integration = db.prepare("SELECT api_key FROM integrations WHERE key = 'apollo'").get() as
    | { api_key: string }
    | undefined;
  if (!integration?.api_key) {
    return res.status(400).json({ error: "Apollo integration not configured" });
  }
  const apiKey = decryptSecret(integration.api_key)!;

  // Optional: target_ids in body to enrich specific contacts only
  const { target_ids } = req.body as { target_ids?: string[] };

  let targets: { id: string; linkedin_url: string | null; sales_nav_url: string | null }[];
  if (target_ids && target_ids.length > 0) {
    const placeholders = target_ids.map(() => "?").join(",");
    targets = db.prepare(`
      SELECT t.id, t.linkedin_url, t.sales_nav_url
      FROM targets t
      INNER JOIN list_targets lt ON lt.target_id = t.id
      WHERE lt.list_id = ? AND t.id IN (${placeholders}) AND t.positions_json IS NULL
        AND (t.linkedin_url IS NOT NULL OR t.sales_nav_url IS NOT NULL)
    `).all(listId, ...target_ids) as { id: string; linkedin_url: string | null; sales_nav_url: string | null }[];
  } else {
    targets = db.prepare(`
      SELECT t.id, t.linkedin_url, t.sales_nav_url
      FROM targets t
      INNER JOIN list_targets lt ON lt.target_id = t.id
      WHERE lt.list_id = ? AND t.positions_json IS NULL
        AND (t.linkedin_url IS NOT NULL OR t.sales_nav_url IS NOT NULL)
    `).all(listId) as { id: string; linkedin_url: string | null; sales_nav_url: string | null }[];
  }

  let enriched = 0;
  let notFound = 0;
  let skipped = 0;

  for (const target of targets) {
    // Prefer real /in/ URL, fall back to sales_nav_url (Apollo accepts both)
    const urlToUse = (target.linkedin_url && !target.linkedin_url.includes("/sales/lead/"))
      ? target.linkedin_url
      : target.sales_nav_url;
    if (!urlToUse) {
      skipped++;
      continue;
    }

    try {
      const result = await matchPerson(urlToUse, apiKey);

      if (!result) {
        notFound++;
        // Mark as attempted so we don't retry endlessly
        db.prepare("UPDATE targets SET apollo_enriched_at = datetime('now') WHERE id = ?").run(target.id);
        continue;
      }

      applyApolloMatchResult(db, target.id, result);

      enriched++;
    } catch {
      skipped++;
    }
  }

  return res.json({ enriched, notFound, skipped, total: targets.length });
}

export const config = {
  api: { responseLimit: false },
};
