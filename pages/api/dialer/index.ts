import { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

const OUTCOMES: Record<string, string> = {
  reached: "Reached",
  no_answer: "Not reached",
  voicemail: "Left voicemail",
  callback: "Call back requested",
  not_interested: "Not interested",
  wrong_number: "Wrong number",
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();

  if (req.method === "GET") {
    const listId = req.query.list_id as string | undefined;
    const rows = db.prepare(`
      SELECT t.id, t.salutation, t.full_name, t.first_name, t.last_name, t.title, t.company, t.phone, t.timezone,
             t.call_status, t.call_attempts, t.last_called_at, t.call_callback_at
      FROM targets t
      WHERE t.phone IS NOT NULL AND TRIM(t.phone) <> ''
        ${listId ? "AND t.id IN (SELECT target_id FROM list_targets WHERE list_id = ?)" : ""}
      LIMIT 2000
    `).all(...(listId ? [listId] : [])) as { id: string }[];

    const slots = db.prepare("SELECT target_id, day, open_time, close_time FROM contact_opening_hours").all() as
      { target_id: string; day: number; open_time: string; close_time: string }[];
    const byTarget = new Map<string, { day: number; open_time: string; close_time: string }[]>();
    for (const { target_id, ...s } of slots) {
      if (!byTarget.has(target_id)) byTarget.set(target_id, []);
      byTarget.get(target_id)!.push(s);
    }
    const lists = db.prepare("SELECT id, name FROM lists ORDER BY name COLLATE NOCASE").all();
    return res.json({ contacts: rows.map((r) => ({ ...r, slots: byTarget.get(r.id) ?? [] })), lists });
  }

  // Close out a call: update outcome state on the contact and write it to the activity log.
  if (req.method === "POST") {
    const { target_id, outcome, note, callback_at, duration_sec, started_at, script_id, no_log } = req.body as {
      target_id?: string; outcome?: string; note?: string; callback_at?: string;
      duration_sec?: number; started_at?: string; script_id?: string; no_log?: boolean;
    };
    if (!target_id || !outcome) return res.status(400).json({ error: "target_id and outcome are required" });
    if (!db.prepare("SELECT 1 FROM targets WHERE id = ?").get(target_id)) return res.status(404).json({ error: "Not found" });

    if (outcome === "requeue") {
      db.prepare("UPDATE targets SET call_status = NULL, call_callback_at = NULL WHERE id = ?").run(target_id);
    } else {
      const label = OUTCOMES[outcome];
      if (!label) return res.status(400).json({ error: "Unknown outcome" });
      const now = new Date().toISOString();
      db.transaction(() => {
        db.prepare(`
          UPDATE targets SET call_status = ?, call_attempts = call_attempts + 1, last_called_at = ?, call_callback_at = ?
          WHERE id = ?
        `).run(outcome, now, outcome === "callback" ? callback_at ?? null : null, target_id);
        // The call wizard writes its own entry through the shared Log activity modal (no_log).
        if (!no_log) {
          db.prepare("INSERT INTO activity_logs (id, target_id, type, body, logged_at) VALUES (?, ?, 'call', ?, ?)")
            .run(randomUUID(), target_id, note?.trim() ? `${label} — ${note.trim()}` : label, now);
        }
        const dur = typeof duration_sec === "number" && duration_sec >= 0 ? Math.round(duration_sec) : null;
        const scriptOk = script_id && db.prepare("SELECT 1 FROM call_scripts WHERE id = ?").get(script_id);
        db.prepare("INSERT INTO call_sessions (id, target_id, script_id, outcome, started_at, duration_sec) VALUES (?, ?, ?, ?, ?, ?)")
          .run(randomUUID(), target_id, scriptOk ? script_id : null, outcome, started_at ?? new Date(Date.now() - (dur ?? 0) * 1000).toISOString(), dur);
      })();
    }
    return res.json(db.prepare(
      "SELECT id, call_status, call_attempts, last_called_at, call_callback_at FROM targets WHERE id = ?"
    ).get(target_id));
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end();
}
