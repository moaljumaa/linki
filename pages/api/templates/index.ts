import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();

  if (req.method === "GET") {
    const templates = db.prepare("SELECT * FROM templates ORDER BY created_at DESC").all();
    return res.json(templates);
  }

  if (req.method === "POST") {
    const { name, body } = req.body;
    if (!name || !body) return res.status(400).json({ error: "name and body required" });
    const id = randomUUID();
    db.prepare("INSERT INTO templates (id, name, body) VALUES (?, ?, ?)").run(id, name, body);
    return res.status(201).json(db.prepare("SELECT * FROM templates WHERE id = ?").get(id));
  }

  res.setHeader("Allow", ["GET", "POST"]);
  res.status(405).end();
}
