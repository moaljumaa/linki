import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();
  const id = req.query.id as string;

  if (req.method === "GET") {
    const workflow = db.prepare("SELECT * FROM workflows WHERE id = ?").get(id);
    if (!workflow) return res.status(404).json({ error: "not found" });
    const steps = db
      .prepare(
        `SELECT ws.*, t.name as template_name
         FROM workflow_steps ws
         LEFT JOIN templates t ON t.id = ws.template_id
         WHERE ws.workflow_id = ?
         ORDER BY ws.step_order`
      )
      .all(id);
    return res.json({ ...workflow as object, steps });
  }

  if (req.method === "PUT") {
    const { name, description } = req.body;
    db.prepare(
      "UPDATE workflows SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?"
    ).run(name ?? null, description ?? null, id);
    return res.json({ ok: true });
  }

  if (req.method === "DELETE") {
    db.prepare("DELETE FROM runs WHERE workflow_id = ?").run(id);
    db.prepare("DELETE FROM workflows WHERE id = ?").run(id);
    return res.json({ ok: true });
  }

  res.status(405).end();
}
