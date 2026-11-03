import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { startApolloImport } from "@/lib/apollo-import";

/** POST — import an existing Apollo list into this Linki list. Additional source, doesn't replace Sales Nav import. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const db = getDb();
  const listId = req.query.id as string;

  const list = db.prepare("SELECT id FROM lists WHERE id = ?").get(listId);
  if (!list) return res.status(404).json({ error: "List not found" });

  const { apollo_list_id, enrich } = req.body as { apollo_list_id?: string; enrich?: boolean };
  if (!apollo_list_id) return res.status(400).json({ error: "apollo_list_id required" });

  const integration = db.prepare("SELECT api_key FROM integrations WHERE key = 'apollo'").get();
  if (!integration) return res.status(400).json({ error: "Apollo integration not configured" });

  const existing = db
    .prepare("SELECT id FROM list_imports WHERE list_id = ? AND status IN ('running','scheduled')")
    .get(listId);
  if (existing) {
    return res.status(409).json({ error: "An import is already queued or running for this list" });
  }

  const { importId } = startApolloImport(db, { listId, apolloListId: apollo_list_id, enrich: !!enrich });

  res.json({ started: true, importId });
}
