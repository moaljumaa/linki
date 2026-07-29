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

    const RUNS = `SELECT id FROM runs WHERE workflow_id = ? AND status IN ('running','paused','completed')`;

    const counts = db.prepare(`
      SELECT
        COUNT(DISTINCT rp.id) AS total_prospects,
        COUNT(DISTINCT CASE WHEN EXISTS (
          SELECT 1 FROM run_profile_tracks rt
          WHERE rt.run_profile_id = rp.id AND rt.state IN ('pending','in_progress')
        ) THEN rp.id END) AS active_prospects,
        COUNT(DISTINCT CASE WHEN NOT EXISTS (
          SELECT 1 FROM run_profile_tracks rt
          WHERE rt.run_profile_id = rp.id AND rt.state NOT IN ('completed','failed','skipped')
        ) AND EXISTS (
          SELECT 1 FROM run_profile_tracks rt2
          WHERE rt2.run_profile_id = rp.id AND rt2.state = 'completed'
        ) THEN rp.id END) AS completed_prospects,
        COUNT(DISTINCT CASE WHEN NOT EXISTS (
          SELECT 1 FROM run_profile_tracks rt
          WHERE rt.run_profile_id = rp.id AND rt.state NOT IN ('failed','skipped')
        ) THEN rp.id END) AS failed_prospects,
        -- Log-based counts scoped to this workflow's runs only
        (SELECT COUNT(DISTINCT target_id) FROM logs
          WHERE run_id IN (${RUNS}) AND message LIKE 'Connection request sent%') AS connections_sent,
        (SELECT COUNT(DISTINCT target_id) FROM logs
          WHERE run_id IN (${RUNS}) AND message LIKE 'Connection request sent%'
            AND target_id IN (SELECT id FROM targets WHERE connected_at IS NOT NULL)) AS connections_accepted,
        (SELECT COUNT(DISTINCT target_id) FROM logs
          WHERE run_id IN (${RUNS}) AND message LIKE 'Message sent%') AS messages_sent,
        (SELECT COUNT(DISTINCT target_id) FROM logs
          WHERE run_id IN (${RUNS}) AND message LIKE 'InMail sent%') AS inmails_sent,
        (SELECT COUNT(DISTINCT target_id) FROM logs
          WHERE run_id IN (${RUNS}) AND message LIKE 'Email sent%') AS emails_sent
      FROM run_profiles rp
      JOIN runs r ON r.id = rp.run_id
      WHERE r.workflow_id = ? AND r.status IN ('running','paused','completed')
    `).get(workflowId, workflowId, workflowId, workflowId, workflowId, workflowId) as {
      total_prospects: number;
      active_prospects: number;
      completed_prospects: number;
      failed_prospects: number;
      connections_sent: number;
      connections_accepted: number;
      messages_sent: number;
      inmails_sent: number;
      emails_sent: number;
    };

    const connections_sent = counts.connections_sent ?? 0;
    const connections_accepted = counts.connections_accepted ?? 0;
    const acceptance_rate = connections_sent > 0
      ? Math.round((connections_accepted / connections_sent) * 100)
      : 0;

    const activeRun = db.prepare(
      `SELECT r.id, r.status, r.list_id, l.name as list_name, a.name as account_name
       FROM runs r
       LEFT JOIN lists l ON l.id = r.list_id
       LEFT JOIN accounts a ON a.id = r.account_id
       WHERE r.workflow_id = ? AND r.status IN ('running', 'paused')
       LIMIT 1`
    ).get(workflowId) as { id: string; status: string; list_id: string; list_name: string; account_name: string } | undefined;

    return res.json({
      total_prospects: counts.total_prospects ?? 0,
      active_prospects: counts.active_prospects ?? 0,
      completed_prospects: counts.completed_prospects ?? 0,
      failed_prospects: counts.failed_prospects ?? 0,
      connections_sent,
      connections_accepted,
      acceptance_rate,
      messages_sent: counts.messages_sent ?? 0,
      inmails_sent: counts.inmails_sent ?? 0,
      emails_sent: counts.emails_sent ?? 0,
      active_run: activeRun ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
}
