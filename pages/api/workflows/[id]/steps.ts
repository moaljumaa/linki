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
         ORDER BY ws.track, ws.step_order`
      )
      .all(workflowId);

    // Attach multi-template ids to each step
    const getTemplateIds = db.prepare(
      `SELECT wst.template_id, t.name
       FROM workflow_step_templates wst
       JOIN templates t ON t.id = wst.template_id
       WHERE wst.step_id = ?`
    );
    const stepsWithTemplates = (steps as Array<Record<string, unknown>>).map((s) => ({
      ...s,
      template_ids: (getTemplateIds.all(s.id) as Array<{ template_id: string; name: string }>).map((r) => r.template_id),
      template_names: (getTemplateIds.all(s.id) as Array<{ template_id: string; name: string }>).map((r) => r.name),
    }));

    return res.json(stepsWithTemplates);
  }

  if (req.method === "POST") {
    const { step_type, track: trackIn, template_id, template_ids, delay_seconds, connect_note, message_body, email_subject, email_body, email_signature, email_position, message_position, ai_enabled, ai_model, ai_prompt, ai_max_words, ai_language } = req.body;
    if (!step_type) return res.status(400).json({ error: "step_type required" });

    // Auto-assign track: email step_type always goes on the email track; everything else linkedin
    const track: "linkedin" | "email" = trackIn === "email" || step_type === "email" ? "email" : "linkedin";

    const maxRow = db
      .prepare("SELECT MAX(step_order) as max_order FROM workflow_steps WHERE workflow_id = ? AND track = ?")
      .get(workflowId, track) as { max_order: number | null };
    const nextOrder = (maxRow.max_order ?? 0) + 1;

    const id = randomUUID();
    db.prepare(
      "INSERT INTO workflow_steps (id, workflow_id, step_order, track, step_type, template_id, delay_seconds, connect_note, message_body, email_subject, email_body, email_signature, email_position, message_position, ai_enabled, ai_model, ai_prompt, ai_max_words, ai_language) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, workflowId, nextOrder, track, step_type, template_id ?? null, delay_seconds ?? 0, connect_note ?? null, message_body ?? null, email_subject ?? null, email_body ?? null, email_signature !== undefined ? email_signature : null, email_position ?? 1, message_position ?? 1, ai_enabled ?? 0, ai_model ?? null, ai_prompt ?? null, ai_max_words ?? null, ai_language ?? null);

    // Insert multi-template associations
    if (Array.isArray(template_ids) && template_ids.length > 0) {
      const insertLink = db.prepare(
        "INSERT OR IGNORE INTO workflow_step_templates (step_id, template_id) VALUES (?, ?)"
      );
      for (const tid of template_ids) {
        insertLink.run(id, tid);
      }
    }

    return res.status(201).json({ id });
  }

  res.status(405).end();
}
