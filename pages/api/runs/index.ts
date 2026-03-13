import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();

  if (req.method === "GET") {
    const runs = db
      .prepare(
        `SELECT r.*,
                w.name as workflow_name,
                l.name as list_name,
                a.name as account_name,
                COUNT(rp.id) as total_profiles,
                SUM(CASE WHEN rp.state = 'completed' THEN 1 ELSE 0 END) as completed_profiles
         FROM runs r
         LEFT JOIN workflows w ON w.id = r.workflow_id
         LEFT JOIN lists l ON l.id = r.list_id
         LEFT JOIN accounts a ON a.id = r.account_id
         LEFT JOIN run_profiles rp ON rp.run_id = r.id
         GROUP BY r.id
         ORDER BY r.created_at DESC`
      )
      .all();
    return res.json(runs);
  }

  if (req.method === "POST") {
    const { workflow_id, list_id, account_id, target_ids } = req.body;
    if (!workflow_id || !list_id || !account_id)
      return res.status(400).json({ error: "workflow_id, list_id, account_id required" });

    // Check 1: only one active run per workflow
    const activeRun = db.prepare(
      "SELECT id FROM runs WHERE workflow_id = ? AND status IN ('running', 'paused') LIMIT 1"
    ).get(workflow_id) as { id: string } | undefined;
    if (activeRun) {
      return res.status(400).json({
        error: "workflow_already_active",
        message: "This workflow is already running. Stop or pause it before enrolling a new list.",
      });
    }

    // Check 2: block duplicate prospects already active in any workflow
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
    ).get(list_id) as { blocked: number }).blocked;

    const total = (db.prepare(
      "SELECT COUNT(*) as c FROM list_targets WHERE list_id = ?"
    ).get(list_id) as { c: number }).c;

    if (blocked > 0) {
      return res.status(400).json({
        error: "prospects_blocked",
        blocked,
        total,
        message: `${blocked} of ${total} prospects in this list are already active in another workflow. Resolve conflicts before enrolling.`,
      });
    }

    const runId = randomUUID();
    db
      .prepare("INSERT INTO runs (id, workflow_id, list_id, account_id) VALUES (?, ?, ?, ?)")
      .run(runId, workflow_id, list_id, account_id);

    // Create run_profiles — either for selected targets or all targets in the list
    const targets: { target_id: string }[] = Array.isArray(target_ids) && target_ids.length > 0
      ? (target_ids as string[]).map((id) => ({ target_id: id }))
      : db.prepare("SELECT target_id FROM list_targets WHERE list_id = ?").all(list_id) as { target_id: string }[];

    const insertProfile = db.prepare(
      "INSERT INTO run_profiles (id, run_id, target_id) VALUES (?, ?, ?)"
    );
    const insertMany = db.transaction((ts: { target_id: string }[]) => {
      for (const t of ts) insertProfile.run(randomUUID(), runId, t.target_id);
    });
    insertMany(targets);

    return res.status(201).json({ id: runId });
  }

  res.status(405).end();
}
