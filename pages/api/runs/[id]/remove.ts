import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const db = getDb();
  const runId = req.query.id as string;
  const { target_ids } = req.body as { target_ids: string[] };

  if (!target_ids?.length) return res.status(400).json({ error: "target_ids required" });

  const placeholders = target_ids.map(() => "?").join(",");
  const result = db
    .prepare(
      `DELETE FROM run_profiles
       WHERE run_id = ? AND target_id IN (${placeholders})`
    )
    .run(runId, ...target_ids);

  return res.json({ ok: true, removed: result.changes });
}
