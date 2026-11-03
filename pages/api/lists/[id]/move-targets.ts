import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

// POST /api/lists/[id]/move-targets
// body: { target_ids: string[], destination_list_id: string }
// Moves targets from source list to destination list (removes from source, adds to destination)
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const db = getDb();
  const sourceListId = req.query.id as string;
  const { target_ids, destination_list_id } = req.body as {
    target_ids: string[];
    destination_list_id: string;
  };

  if (!Array.isArray(target_ids) || target_ids.length === 0)
    return res.status(400).json({ error: "target_ids must be a non-empty array" });
  if (!destination_list_id)
    return res.status(400).json({ error: "destination_list_id required" });
  if (destination_list_id === sourceListId)
    return res.status(400).json({ error: "Source and destination list are the same" });

  const dest = db.prepare("SELECT id FROM lists WHERE id = ?").get(destination_list_id);
  if (!dest) return res.status(404).json({ error: "Destination list not found" });

  const placeholders = target_ids.map(() => "?").join(",");

  db.transaction(() => {
    db.prepare(
      `DELETE FROM list_targets WHERE list_id = ? AND target_id IN (${placeholders})`
    ).run(sourceListId, ...target_ids);

    for (const tid of target_ids) {
      db.prepare(
        `INSERT OR IGNORE INTO list_targets (list_id, target_id) VALUES (?, ?)`
      ).run(destination_list_id, tid);
    }
  })();

  return res.json({ moved: target_ids.length });
}
