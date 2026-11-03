import { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

// Raw call sessions since `since` (client aggregates in its own timezone) + lifetime totals
// and the current daily streak (needs the client's tz offset to know where "a day" ends).
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", ["GET"]); return res.status(405).end(); }
  const db = getDb();
  const since = (req.query.since as string) || new Date(Date.now() - 30 * 86400000).toISOString();
  const offsetMin = Number(req.query.tz_offset ?? 0) || 0; // Date#getTimezoneOffset(): minutes behind UTC

  const sessions = db.prepare(`
    SELECT cs.id, cs.started_at, cs.outcome, cs.duration_sec, cs.script_id, s.name AS script_name
    FROM call_sessions cs LEFT JOIN call_scripts s ON s.id = cs.script_id
    WHERE cs.started_at >= ? ORDER BY cs.started_at
  `).all(since);

  const lifetime = db.prepare(`
    SELECT COUNT(*) AS calls,
           COALESCE(SUM(outcome = 'reached'), 0) AS reached,
           COALESCE(SUM(duration_sec), 0) AS talk_sec
    FROM call_sessions
  `).get() as { calls: number; reached: number; talk_sec: number };

  const dayKey = (iso: string) => new Date(new Date(iso).getTime() - offsetMin * 60000).toISOString().slice(0, 10);
  const recent = db.prepare("SELECT started_at FROM call_sessions WHERE started_at >= ?")
    .all(new Date(Date.now() - 200 * 86400000).toISOString()) as { started_at: string }[];
  const days = new Set(recent.map((r) => dayKey(r.started_at)));
  let streak = 0;
  const cursor = new Date(Date.now() - offsetMin * 60000);
  if (!days.has(cursor.toISOString().slice(0, 10))) cursor.setUTCDate(cursor.getUTCDate() - 1); // today not started yet doesn't break it
  while (days.has(cursor.toISOString().slice(0, 10))) { streak++; cursor.setUTCDate(cursor.getUTCDate() - 1); }

  return res.json({ sessions, lifetime, streak });
}
