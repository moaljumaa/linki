import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();
  const id = req.query.id as string;

  if (req.method === "GET") {
    const run = db
      .prepare(
        `SELECT r.*,
                w.name as workflow_name,
                l.name as list_name,
                a.name as account_name
         FROM runs r
         LEFT JOIN workflows w ON w.id = r.workflow_id
         LEFT JOIN lists l ON l.id = r.list_id
         LEFT JOIN accounts a ON a.id = r.account_id
         WHERE r.id = ?`
      )
      .get(id);
    if (!run) return res.status(404).json({ error: "not found" });

    const profiles = db
      .prepare(
        `SELECT rp.*, t.full_name, t.linkedin_url, t.title, t.company
         FROM run_profiles rp
         LEFT JOIN targets t ON t.id = rp.target_id
         WHERE rp.run_id = ?
         ORDER BY rp.id`
      )
      .all(id);

    const logs = db
      .prepare(
        `SELECT lg.*, t.full_name as target_name
         FROM logs lg
         LEFT JOIN targets t ON t.id = lg.target_id
         WHERE lg.run_id = ?
         ORDER BY lg.created_at DESC
         LIMIT 100`
      )
      .all(id);

    return res.json({ ...run as object, profiles, logs });
  }

  if (req.method === "PATCH") {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "status required" });
    db.prepare("UPDATE runs SET status = ? WHERE id = ?").run(status, id);
    return res.json({ ok: true });
  }

  if (req.method === "DELETE") {
    db.prepare("DELETE FROM runs WHERE id = ?").run(id);
    return res.json({ ok: true });
  }

  res.status(405).end();
}
