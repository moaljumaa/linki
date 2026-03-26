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

    const counts = db.prepare(
      `SELECT
        COUNT(rp.id) as total_prospects,
        SUM(CASE WHEN rp.state IN ('pending','in_progress') THEN 1 ELSE 0 END) as active_prospects,
        SUM(CASE WHEN rp.state = 'completed' THEN 1 ELSE 0 END) as completed_prospects,
        SUM(CASE WHEN rp.state IN ('failed','skipped') THEN 1 ELSE 0 END) as failed_prospects,
        COUNT(DISTINCT CASE WHEN t.connection_requested_at IS NOT NULL THEN rp.target_id END) as connections_sent,
        COUNT(DISTINCT CASE WHEN t.connected_at IS NOT NULL THEN rp.target_id END) as connections_accepted,
        COUNT(DISTINCT CASE WHEN t.message_sent_at IS NOT NULL THEN rp.target_id END) as messages_sent
       FROM run_profiles rp
       JOIN runs r ON r.id = rp.run_id
       JOIN targets t ON t.id = rp.target_id
       WHERE r.workflow_id = ? AND r.status IN ('running', 'paused', 'completed')`
    ).get(workflowId) as {
      total_prospects: number;
      active_prospects: number;
      completed_prospects: number;
      failed_prospects: number;
      connections_sent: number;
      connections_accepted: number;
      messages_sent: number;
    };

    const connections_sent = counts.connections_sent ?? 0;
    const connections_accepted = counts.connections_accepted ?? 0;
    const acceptance_rate = connections_sent > 0
      ? Math.round((connections_accepted / connections_sent) * 100)
      : 0;

    const activeRun = db.prepare(
      `SELECT r.id, r.status, l.name as list_name, a.name as account_name
       FROM runs r
       LEFT JOIN lists l ON l.id = r.list_id
       LEFT JOIN accounts a ON a.id = r.account_id
       WHERE r.workflow_id = ? AND r.status IN ('running', 'paused')
       LIMIT 1`
    ).get(workflowId) as { id: string; status: string; list_name: string; account_name: string } | undefined;

    return res.json({
      total_prospects: counts.total_prospects ?? 0,
      active_prospects: counts.active_prospects ?? 0,
      completed_prospects: counts.completed_prospects ?? 0,
      failed_prospects: counts.failed_prospects ?? 0,
      connections_sent,
      connections_accepted,
      acceptance_rate,
      messages_sent: counts.messages_sent ?? 0,
      active_run: activeRun ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
}
