import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  try {
    const db = getDb();
    const workflowId = req.query.id as string;
    const stepFilter = req.query.step !== undefined ? Number(req.query.step) : null;
    const stateFilter = req.query.state as string | undefined;
    const page = req.query.page ? Number(req.query.page) : 0;
    const limit = 25;
    const offset = page * limit;

    // Only show profiles from active/recent runs (exclude stopped/orphaned runs)
    const conditions: string[] = ["r.workflow_id = ?", "r.status IN ('running', 'paused', 'completed')"];
    const params: unknown[] = [workflowId];

    // stepFilter is step_order (1-based from frontend); current_step is 0-based
    if (stepFilter !== null) {
      conditions.push("rp.current_step = ?");
      params.push(stepFilter - 1);
    }
    if (stateFilter) {
      conditions.push("rp.state = ?");
      params.push(stateFilter);
    }

    const where = conditions.join(" AND ");

    const total = (db.prepare(
      `SELECT COUNT(*) as c
       FROM run_profiles rp
       JOIN runs r ON r.id = rp.run_id
       WHERE ${where}`
    ).get(...params) as { c: number }).c;

    params.push(limit, offset);

    const prospects = db.prepare(
      `SELECT rp.id, rp.target_id, rp.state, rp.current_step, rp.next_step_at, rp.error_message,
              t.full_name, t.title, t.company, t.linkedin_url,
              t.degree, t.connection_requested_at, t.connected_at, t.message_sent_at,
              ws.step_type
       FROM run_profiles rp
       JOIN runs r ON r.id = rp.run_id
       JOIN targets t ON t.id = rp.target_id
       LEFT JOIN workflow_steps ws ON ws.workflow_id = r.workflow_id AND ws.step_order = rp.current_step + 1
       WHERE ${where}
       ORDER BY rp.state, t.full_name
       LIMIT ? OFFSET ?`
    ).all(...params);

    return res.json({ prospects, total });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
}
