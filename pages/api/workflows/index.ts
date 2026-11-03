import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();

  if (req.method === "GET") {
    const workflows = db
      .prepare(
        `SELECT w.*, COUNT(ws.id) as step_count
         FROM workflows w
         LEFT JOIN workflow_steps ws ON ws.workflow_id = w.id
         GROUP BY w.id
         ORDER BY w.created_at DESC`
      )
      .all();
    return res.json(workflows);
  }

  if (req.method === "POST") {
    const { name, description, prompt } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    const id = randomUUID();
    db.prepare("INSERT INTO workflows (id, name, description, prompt) VALUES (?, ?, ?, ?)").run(id, name, description ?? null, prompt ?? null);
    return res.status(201).json(db.prepare("SELECT * FROM workflows WHERE id = ?").get(id));
  }

  res.status(405).end();
}
