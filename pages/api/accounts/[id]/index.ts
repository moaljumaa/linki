import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();
  const id = req.query.id as string;

  if (req.method === "GET") {
    const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id);
    if (!account) return res.status(404).json({ error: "Not found" });
    return res.json(account);
  }

  if (req.method === "PUT") {
    const { name, email, daily_connection_limit, daily_message_limit, active_hours_start, active_hours_end, timezone, working_days } = req.body;
    db.prepare(
      `UPDATE accounts SET
        name = COALESCE(?, name),
        email = COALESCE(?, email),
        daily_connection_limit = COALESCE(?, daily_connection_limit),
        daily_message_limit = COALESCE(?, daily_message_limit),
        active_hours_start = COALESCE(?, active_hours_start),
        active_hours_end = COALESCE(?, active_hours_end),
        timezone = COALESCE(?, timezone),
        working_days = COALESCE(?, working_days)
       WHERE id = ?`
    ).run(name, email, daily_connection_limit, daily_message_limit, active_hours_start, active_hours_end, timezone, working_days, id);
    return res.json(db.prepare("SELECT * FROM accounts WHERE id = ?").get(id));
  }

  if (req.method === "DELETE") {
    db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
    return res.status(204).end();
  }

  res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
  res.status(405).end();
}
