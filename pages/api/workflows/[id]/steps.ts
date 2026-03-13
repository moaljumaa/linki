import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();
  const workflowId = req.query.id as string;

  if (req.method === "GET") {
    const steps = db
      .prepare(
        `SELECT ws.*, t.name as template_name
         FROM workflow_steps ws
         LEFT JOIN templates t ON t.id = ws.template_id
         WHERE ws.workflow_id = ?
         ORDER BY ws.step_order`
      )
      .all(workflowId);
    return res.json(steps);
  }

  if (req.method === "POST") {
    const { step_type, template_id, delay_seconds, connect_note, message_body } = req.body;
    if (!step_type) return res.status(400).json({ error: "step_type required" });

    const maxRow = db
      .prepare("SELECT MAX(step_order) as max_order FROM workflow_steps WHERE workflow_id = ?")
      .get(workflowId) as { max_order: number | null };
    const nextOrder = (maxRow.max_order ?? 0) + 1;

    const id = randomUUID();
    db.prepare(
      "INSERT INTO workflow_steps (id, workflow_id, step_order, step_type, template_id, delay_seconds, connect_note, message_body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, workflowId, nextOrder, step_type, template_id ?? null, delay_seconds ?? 0, connect_note ?? null, message_body ?? null);
    return res.status(201).json({ id });
  }

  res.status(405).end();
}
