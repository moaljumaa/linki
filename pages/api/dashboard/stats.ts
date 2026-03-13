import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();

  try {
    const db = getDb();

    // "Active" targets = targets still in at least one list (not removed)
    const ACTIVE = `id IN (SELECT DISTINCT target_id FROM list_targets)`;

    // --- Top-level counts (active targets only) ---
    const totals = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM targets WHERE ${ACTIVE}) AS total_targets,
        (SELECT COUNT(*) FROM targets WHERE ${ACTIVE} AND connection_requested_at IS NOT NULL) AS connections_requested,
        (SELECT COUNT(*) FROM targets WHERE ${ACTIVE} AND connected_at IS NOT NULL) AS connected,
        (SELECT COUNT(*) FROM targets WHERE ${ACTIVE} AND message_sent_at IS NOT NULL) AS messages_sent,
        (SELECT COUNT(*) FROM targets WHERE ${ACTIVE} AND last_replied_at IS NOT NULL) AS replies_received,
        (SELECT COUNT(*) FROM runs WHERE status = 'running') AS active_runs,
        (SELECT COUNT(*) FROM lists) AS total_lists,
        (SELECT COUNT(*) FROM workflows) AS total_workflows
    `).get() as Record<string, number>;

    // --- Today's actions from logs ---
    const today = db.prepare(`
      SELECT
        COUNT(CASE WHEN message LIKE 'Visited%' THEN 1 END) AS visits_today,
        COUNT(CASE WHEN message LIKE 'Connection request sent%' THEN 1 END) AS connections_today,
        COUNT(CASE WHEN message LIKE 'Message sent%' THEN 1 END) AS messages_today
      FROM logs
      WHERE date(created_at) = date('now')
    `).get() as Record<string, number>;

    // --- Activity chart: supports variable day range via ?days= query param ---
    const days = Math.min(Math.max(Number(req.query.days) || 7, 7), 90);

    const activity = db.prepare(`
      SELECT
        date(created_at) AS day,
        COUNT(CASE WHEN message LIKE 'Visited%' THEN 1 END) AS visits,
        COUNT(CASE WHEN message LIKE 'Connection request sent%' THEN 1 END) AS connections,
        COUNT(CASE WHEN message LIKE 'Message sent%' THEN 1 END) AS messages
      FROM logs
      WHERE created_at >= datetime('now', '-${days} days')
      GROUP BY date(created_at)
      ORDER BY day ASC
    `).all() as { day: string; visits: number; connections: number; messages: number }[];

    // Fill in missing days with zeros
    const filled: typeof activity = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const found = activity.find(r => r.day === key);
      filled.push(found ?? { day: key, visits: 0, connections: 0, messages: 0 });
    }

    res.json({ totals, today, activity: filled });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load dashboard stats" });
  }
}
