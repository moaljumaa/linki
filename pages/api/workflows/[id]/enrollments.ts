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
            COUNT(DISTINCT rp.id) as total_profiles,
            COUNT(DISTINCT CASE WHEN NOT EXISTS (
              SELECT 1 FROM run_profile_tracks rt2
              WHERE rt2.run_profile_id = rp.id AND rt2.state NOT IN ('completed','failed','skipped')
            ) AND EXISTS (
              SELECT 1 FROM run_profile_tracks rt3
              WHERE rt3.run_profile_id = rp.id AND rt3.state = 'completed'
            ) THEN rp.id END) as completed_profiles,
            COUNT(DISTINCT CASE WHEN EXISTS (
              SELECT 1 FROM run_profile_tracks rt4
              WHERE rt4.run_profile_id = rp.id AND rt4.state = 'failed'
            ) AND NOT EXISTS (
              SELECT 1 FROM run_profile_tracks rt5
              WHERE rt5.run_profile_id = rp.id AND rt5.state NOT IN ('completed','failed','skipped')
            ) THEN rp.id END) as failed_profiles,
            COUNT(DISTINCT CASE WHEN NOT EXISTS (
              SELECT 1 FROM run_profile_tracks rt6
              WHERE rt6.run_profile_id = rp.id AND rt6.state NOT IN ('skipped','completed','failed')
            ) AND EXISTS (
              SELECT 1 FROM run_profile_tracks rt7
              WHERE rt7.run_profile_id = rp.id AND rt7.state = 'skipped'
            ) AND NOT EXISTS (
              SELECT 1 FROM run_profile_tracks rt8
              WHERE rt8.run_profile_id = rp.id AND rt8.state IN ('completed','failed')
            ) THEN rp.id END) as skipped_profiles
     FROM runs r
     LEFT JOIN lists l ON l.id = r.list_id
     LEFT JOIN accounts a ON a.id = r.account_id
     LEFT JOIN run_profiles rp ON rp.run_id = r.id
     WHERE r.workflow_id = ? GROUP BY r.id ORDER BY r.created_at DESC`
  ).all(workflowId);

  // Step groups: use the linkedin track-run current_step for display (most representative)
  const stepGroups = db.prepare(
    `SELECT rt.current_step as step_order, ws.step_type, t.name as template_name, COUNT(*) as count
     FROM run_profile_tracks rt
     JOIN run_profiles rp ON rp.id = rt.run_profile_id
     JOIN runs r ON r.id = rp.run_id
     JOIN workflow_steps ws ON ws.workflow_id = r.workflow_id AND ws.track = rt.track AND ws.step_order = rt.current_step + 1
     LEFT JOIN templates t ON t.id = ws.template_id
     WHERE r.workflow_id = ? AND rt.state NOT IN ('completed', 'failed', 'skipped')
     GROUP BY rt.current_step, rt.track ORDER BY rt.current_step`
  ).all(workflowId);

  return res.json({ enrollments, stepGroups });
}
