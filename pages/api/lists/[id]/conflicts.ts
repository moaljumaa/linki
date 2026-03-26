import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

// GET /api/lists/[id]/conflicts
// Returns how many prospects in this list are already active in a running/paused workflow
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  const db = getDb();
  const listId = req.query.id as string;

  const total = (db.prepare(
    "SELECT COUNT(*) as c FROM list_targets WHERE list_id = ?"
  ).get(listId) as { c: number }).c;

  const blocked = (db.prepare(
    `SELECT COUNT(DISTINCT lt.target_id) as blocked
     FROM list_targets lt
     WHERE lt.list_id = ?
     AND lt.target_id IN (
       SELECT rp.target_id FROM run_profiles rp
       JOIN runs r ON r.id = rp.run_id
       WHERE r.status IN ('running', 'paused')
       AND rp.state NOT IN ('completed', 'failed', 'skipped')
     )`
  ).get(listId) as { blocked: number }).blocked;

  return res.json({ total, blocked });
}
