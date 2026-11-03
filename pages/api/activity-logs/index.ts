import { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();

  if (req.method === "GET") {
    const { target_id } = req.query;
    if (!target_id) return res.status(400).json({ error: "target_id is required" });
    const logs = db.prepare(
      "SELECT * FROM activity_logs WHERE target_id = ? ORDER BY logged_at DESC"
    ).all(target_id);
    return res.json(logs);
  }

  if (req.method === "POST") {
    const { target_id, type, body, logged_at } = req.body as {
      target_id: string;
      type?: string;
      body: string;
      logged_at?: string;
    };
    if (!target_id || !body?.trim()) {
      return res.status(400).json({ error: "target_id and body are required" });
    }
    const id = randomUUID();
    db.prepare(
      "INSERT INTO activity_logs (id, target_id, type, body, logged_at) VALUES (?, ?, ?, ?, ?)"
    ).run(
      id,
      target_id,
      type ?? "note",
      body.trim(),
      logged_at ?? new Date().toISOString()
    );
    const log = db.prepare("SELECT * FROM activity_logs WHERE id = ?").get(id);
    return res.status(201).json(log);
  }

  if (req.method === "PATCH") {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "id is required" });
    const { type, body } = req.body as { type?: string; body?: string };
    const fields: string[] = [];
    const params: unknown[] = [];
    if (type !== undefined) { fields.push("type = ?"); params.push(type); }
    if (body !== undefined) { fields.push("body = ?"); params.push(body.trim()); }
    if (!fields.length) return res.status(400).json({ error: "Nothing to update" });
    params.push(id);
    db.prepare(`UPDATE activity_logs SET ${fields.join(", ")} WHERE id = ?`).run(...params);
    return res.json(db.prepare("SELECT * FROM activity_logs WHERE id = ?").get(id));
  }

  if (req.method === "DELETE") {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "id is required" });
    db.prepare("DELETE FROM activity_logs WHERE id = ?").run(id);
    return res.status(204).end();
  }

  res.setHeader("Allow", ["GET", "POST", "PATCH", "DELETE"]);
  return res.status(405).end();
}
