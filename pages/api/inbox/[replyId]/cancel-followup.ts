import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";

/**
 * Cancels a scheduled OOO follow-up: clears the email track's next_step_at +
 * pending_reply_context and stamps the contact's email_replied_at, so the runner
 * skips them on the next tick (treats the reply as bucket D retroactively).
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const db = getDb();
  const replyId = req.query.replyId as string;
  if (!replyId) return res.status(400).json({ error: "replyId required" });

  const reply = db
    .prepare("SELECT target_id, run_id FROM email_replies WHERE id = ?")
    .get(replyId) as { target_id: string; run_id: string | null } | undefined;
  if (!reply) return res.status(404).json({ error: "reply_not_found" });

  if (reply.run_id) {
    db.prepare(
      `UPDATE run_profile_tracks SET state = 'skipped', next_step_at = NULL, pending_reply_context = NULL,
         error_message = 'Follow-up cancelled from inbox'
       WHERE track = 'email' AND state IN ('pending', 'in_progress')
         AND run_profile_id IN (
           SELECT id FROM run_profiles WHERE run_id = ? AND target_id = ?
         )`,
    ).run(reply.run_id, reply.target_id);
  }

  db.prepare("UPDATE targets SET email_replied_at = datetime('now') WHERE id = ?").run(reply.target_id);
  db.prepare(
    "INSERT INTO activity_logs (id, target_id, type, body) VALUES (?, ?, 'email', 'Scheduled follow-up cancelled from inbox.')",
  ).run(randomUUID(), reply.target_id);

  db.prepare(
    "UPDATE email_replies SET dispatch_result_json = ? WHERE id = ?",
  ).run(JSON.stringify({ kind: "cancelled", notes: "Follow-up cancelled from inbox" }), replyId);

  return res.json({ ok: true });
}
