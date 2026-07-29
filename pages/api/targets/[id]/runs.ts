import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

// Which runs/campaigns a contact is enrolled in, with per-track (linkedin/email) state + step.
// Answers "is this person in a campaign, and where are they in it?" without scanning a whole run.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();

  const db = getDb();
  const targetId = req.query.id as string;

  const target = db.prepare("SELECT id FROM targets WHERE id = ?").get(targetId);
  if (!target) return res.status(404).json({ error: "Not found" });

  const rows = db.prepare(`
    SELECT
      rp.id AS run_profile_id,
      r.id AS run_id,
      r.status AS run_status,
      r.workflow_id,
      w.name AS workflow_name,
      l.id AS list_id,
      l.name AS list_name,
      rp.email_account_id,
      rt.track,
      rt.state,
      rt.current_step,
      rt.next_step_at,
      rt.error_message
    FROM run_profiles rp
    JOIN runs r ON r.id = rp.run_id
    LEFT JOIN workflows w ON w.id = r.workflow_id
    LEFT JOIN lists l ON l.id = r.list_id
    LEFT JOIN run_profile_tracks rt ON rt.run_profile_id = rp.id
    WHERE rp.target_id = ?
    ORDER BY r.created_at DESC, rt.track
  `).all(targetId) as Array<Record<string, unknown>>;

  // Group tracks under their run.
  const byRun = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const rid = row.run_id as string;
    if (!byRun.has(rid)) {
      byRun.set(rid, {
        run_id: rid,
        run_profile_id: row.run_profile_id,
        run_status: row.run_status,
        workflow_id: row.workflow_id,
        workflow_name: row.workflow_name,
        list_id: row.list_id,
        list_name: row.list_name,
        email_account_id: row.email_account_id,
        tracks: [],
      });
    }
    if (row.track) {
      (byRun.get(rid)!.tracks as unknown[]).push({
        track: row.track,
        state: row.state,
        current_step: row.current_step,
        next_step_at: row.next_step_at,
        error_message: row.error_message,
      });
    }
  }

  return res.json({ runs: Array.from(byRun.values()) });
}
