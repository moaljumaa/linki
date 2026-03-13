import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();
  const stepId = req.query.stepId as string;

  if (req.method === "PUT") {
    const { step_type, template_id, delay_seconds, step_order, connect_note, message_body } = req.body;
    db.prepare(
      `UPDATE workflow_steps SET
        step_type = COALESCE(?, step_type),
        template_id = COALESCE(?, template_id),
        delay_seconds = COALESCE(?, delay_seconds),
        step_order = COALESCE(?, step_order),
        connect_note = ?,
        message_body = ?
       WHERE id = ?`
    ).run(step_type ?? null, template_id ?? null, delay_seconds ?? null, step_order ?? null, connect_note ?? null, message_body ?? null, stepId);
    return res.json({ ok: true });
  }

  if (req.method === "DELETE") {
    db.prepare("DELETE FROM workflow_steps WHERE id = ?").run(stepId);
    return res.json({ ok: true });
  }

  res.status(405).end();
}
