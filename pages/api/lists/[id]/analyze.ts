import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

// Title + location breakdown for a list — used to spot irrelevant contacts before cleaning.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();

  const db = getDb();
  const list_id = req.query.id as string;

  const list = db.prepare("SELECT id, name FROM lists WHERE id = ?").get(list_id);
  if (!list) return res.status(404).json({ error: "List not found" });

  const total = (db.prepare("SELECT COUNT(*) as c FROM list_targets WHERE list_id = ?").get(list_id) as { c: number }).c;

  const titles = db.prepare(`
    SELECT t.title, COUNT(*) as count
    FROM list_targets lt
    JOIN targets t ON t.id = lt.target_id
    WHERE lt.list_id = ? AND t.title IS NOT NULL
    GROUP BY t.title
    ORDER BY count DESC
  `).all(list_id);

  const locations = db.prepare(`
    SELECT t.location, COUNT(*) as count
    FROM list_targets lt
    JOIN targets t ON t.id = lt.target_id
    WHERE lt.list_id = ? AND t.location IS NOT NULL
    GROUP BY t.location
    ORDER BY count DESC
  `).all(list_id);

  return res.json({ list, total, titles, locations });
}
