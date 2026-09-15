import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const db = getDb();
  const runId = req.query.id as string;
  const { target_ids } = req.body as { target_ids: string[] };

  if (!target_ids?.length) return res.status(400).json({ error: "target_ids required" });

  const placeholders = target_ids.map(() => "?").join(",");
  const rpRows = db.prepare(
    `SELECT rp.id, rp.target_id, t.full_name, t.linkedin_url
     FROM run_profiles rp
     JOIN targets t ON t.id = rp.target_id
     WHERE rp.run_id = ? AND rp.target_id IN (${placeholders})`
  ).all(runId, ...target_ids) as { id: string; target_id: string; full_name: string | null; linkedin_url: string }[];

  let queued = 0;
  const insertLog = db.prepare(
    "INSERT INTO logs (id, run_id, target_id, level, message) VALUES (?, ?, ?, ?, ?)"
  );
  const updateTrack = db.prepare(
    `UPDATE run_profile_tracks
     SET next_step_at = NULL, force_next = 1
     WHERE run_profile_id = ? AND state IN ('pending', 'in_progress')`
  );

  for (const rp of rpRows) {
    const result = updateTrack.run(rp.id);
    if (result.changes === 0) continue;
    queued += result.changes;
    const name = rp.full_name ?? rp.linkedin_url;
    insertLog.run(randomUUID(), runId, rp.target_id, "info", `Manual run now — skipping schedule/limits for ${name}`);
  }

  return res.json({ ok: true, queued });
}
