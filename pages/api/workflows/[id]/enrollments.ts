import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

// GET /api/workflows/[id]/enrollments
// Returns current enrollment list + step groups for live polling
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  const db = getDb();
  const workflowId = req.query.id as string;

  const enrollments = db.prepare(
    `SELECT r.id, r.list_id, r.status, r.created_at,
            l.name as list_name, a.name as account_name,
            COUNT(rp.id) as total_profiles,
            SUM(CASE WHEN rp.state = 'completed' THEN 1 ELSE 0 END) as completed_profiles,
            SUM(CASE WHEN rp.state = 'failed' THEN 1 ELSE 0 END) as failed_profiles,
            SUM(CASE WHEN rp.state = 'skipped' THEN 1 ELSE 0 END) as skipped_profiles
     FROM runs r
     LEFT JOIN lists l ON l.id = r.list_id
     LEFT JOIN accounts a ON a.id = r.account_id
     LEFT JOIN run_profiles rp ON rp.run_id = r.id
     WHERE r.workflow_id = ? GROUP BY r.id ORDER BY r.created_at DESC`
  ).all(workflowId);

  const stepGroups = db.prepare(
    `SELECT rp.current_step as step_order, ws.step_type, t.name as template_name, COUNT(*) as count
     FROM run_profiles rp
     JOIN runs r ON r.id = rp.run_id
     JOIN workflow_steps ws ON ws.workflow_id = r.workflow_id AND ws.step_order = rp.current_step
     LEFT JOIN templates t ON t.id = ws.template_id
     WHERE r.workflow_id = ? AND rp.state NOT IN ('completed', 'failed', 'skipped')
     GROUP BY rp.current_step ORDER BY rp.current_step`
  ).all(workflowId);

  return res.json({ enrollments, stepGroups });
}
