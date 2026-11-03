import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const db = getDb();
  const runId = req.query.id as string;
  const { target_ids } = req.body as { target_ids: string[] };

  if (!target_ids?.length) return res.status(400).json({ error: "target_ids required" });

  const placeholders = target_ids.map(() => "?").join(",");
  // Retry: reset all failed track-runs for these profiles back to in_progress
  const rpRows = db.prepare(
    `SELECT id FROM run_profiles WHERE run_id = ? AND target_id IN (${placeholders})`
  ).all(runId, ...target_ids) as { id: string }[];

  let retried = 0;
  for (const rp of rpRows) {
    const r = db.prepare(
      `UPDATE run_profile_tracks SET state = 'in_progress', error_message = NULL, next_step_at = NULL
       WHERE run_profile_id = ? AND state = 'failed'`
    ).run(rp.id);
    retried += r.changes;
  }

  return res.json({ ok: true, retried });
}
