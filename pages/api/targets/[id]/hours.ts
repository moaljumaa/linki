import { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();
  const id = req.query.id as string;

  const read = () => ({
    timezone: (db.prepare("SELECT timezone FROM targets WHERE id = ?").get(id) as { timezone: string | null } | undefined)?.timezone ?? null,
    slots: db.prepare(
      "SELECT day, open_time, close_time FROM contact_opening_hours WHERE target_id = ? ORDER BY open_time, day"
    ).all(id),
  });

  if (req.method === "GET") return res.json(read());

  if (req.method === "PUT") {
    if (!db.prepare("SELECT 1 FROM targets WHERE id = ?").get(id)) return res.status(404).json({ error: "Not found" });
    const { slots } = req.body as { slots?: { day: number; open_time: string; close_time: string }[] };
    if (!Array.isArray(slots)) return res.status(400).json({ error: "slots is required" });
    for (const s of slots) {
      if (!Number.isInteger(s.day) || s.day < 0 || s.day > 6 || !TIME.test(s.open_time) || !TIME.test(s.close_time) || s.open_time >= s.close_time) {
        return res.status(400).json({ error: "Invalid slot (day 0-6, HH:MM, open before close)" });
      }
    }
    const insert = db.prepare("INSERT INTO contact_opening_hours (id, target_id, day, open_time, close_time) VALUES (?, ?, ?, ?, ?)");
    db.transaction(() => {
      db.prepare("DELETE FROM contact_opening_hours WHERE target_id = ?").run(id);
      for (const s of slots) insert.run(randomUUID(), id, s.day, s.open_time, s.close_time);
    })();
    return res.json(read());
  }

  res.setHeader("Allow", ["GET", "PUT"]);
  return res.status(405).end();
}
