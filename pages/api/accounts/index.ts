import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();

  if (req.method === "GET") {
    const accounts = db.prepare("SELECT * FROM accounts ORDER BY created_at DESC").all();
    return res.json(accounts);
  }

  if (req.method === "POST") {
    const { name, email, daily_connection_limit = 20, daily_message_limit = 50 } = req.body;
    if (!name || !email) return res.status(400).json({ error: "name and email required" });
    try {
      const id = randomUUID();
      db
        .prepare(
          "INSERT INTO accounts (id, name, email, daily_connection_limit, daily_message_limit) VALUES (?, ?, ?, ?, ?)"
        )
        .run(id, name, email, daily_connection_limit, daily_message_limit);
      const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id);
      return res.status(201).json(account);
    } catch {
      return res.status(409).json({ error: "Email already exists" });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  res.status(405).end();
}
