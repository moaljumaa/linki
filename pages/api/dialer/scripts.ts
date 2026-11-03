import { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

// Call scripts the caller reads from during a call. Body is markdown with {{variables}}.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();
  const id = req.query.id as string | undefined;

  if (req.method === "GET") {
    return res.json(db.prepare("SELECT * FROM call_scripts ORDER BY name COLLATE NOCASE").all());
  }

  if (req.method === "POST") {
    const { name, body } = req.body as { name?: string; body?: string };
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    const newId = randomUUID();
    db.prepare("INSERT INTO call_scripts (id, name, body) VALUES (?, ?, ?)").run(newId, name.trim(), body ?? "");
    return res.status(201).json(db.prepare("SELECT * FROM call_scripts WHERE id = ?").get(newId));
  }

  if (req.method === "PATCH") {
    if (!id) return res.status(400).json({ error: "id is required" });
    const { name, body } = req.body as { name?: string; body?: string };
    const fields: string[] = [];
    const params: unknown[] = [];
    if (name !== undefined) { if (!name.trim()) return res.status(400).json({ error: "name cannot be empty" }); fields.push("name = ?"); params.push(name.trim()); }
    if (body !== undefined) { fields.push("body = ?"); params.push(body); }
    if (!fields.length) return res.status(400).json({ error: "Nothing to update" });
    fields.push("updated_at = datetime('now')");
    params.push(id);
    db.prepare(`UPDATE call_scripts SET ${fields.join(", ")} WHERE id = ?`).run(...params);
    return res.json(db.prepare("SELECT * FROM call_scripts WHERE id = ?").get(id));
  }

  if (req.method === "DELETE") {
    if (!id) return res.status(400).json({ error: "id is required" });
    db.prepare("DELETE FROM call_scripts WHERE id = ?").run(id);
    return res.status(204).end();
  }

  res.setHeader("Allow", ["GET", "POST", "PATCH", "DELETE"]);
  return res.status(405).end();
}
